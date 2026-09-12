/**
 * Most of this code is from Zotero team's official Make It Red example[1]
 * or the Zotero 7 documentation[2].
 * [1] https://github.com/zotero/make-it-red
 * [2] https://www.zotero.org/support/dev/zotero_7_for_developers
 */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "smarttranslate", rootURI + "content/"],
  ]);

  const ctx = { rootURI };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/smarttranslate.js`,
    ctx,
  );
  // 注入真实插件 ID, 供 hooks 内回退值之外的正常路径使用;
  // bundle 加载失败时 Zotero.SmartTranslate 为 undefined:
  // if 守卫保护下方赋值, onStartup 可选链避免抛 TypeError
  if (Zotero.SmartTranslate) {
    Zotero.SmartTranslate.id = id;
  }
  // 注册首选项面板: 路径对齐官方 make-it-red, 用 rootURI 拼绝对 URI;
  // 必须提前到 onStartup 之前, 否则 onStartup 抛错会吞掉注册;
  // rootURI 以 / 结尾, 直接拼接不补双斜杠
  if (Zotero.PreferencePanes) {
    try {
      Zotero.PreferencePanes.register({
        pluginID: id,
        src: rootURI + "prefs.xhtml",
        scripts: [rootURI + "prefs-pane.js"],
      });
    } catch (e) {
      Zotero.logError(e);
    }
  }

  // hooks 的任何异常不得阻断 startup 完成, 记录后继续
  try {
    await Zotero.SmartTranslate?.hooks.onStartup?.();
  } catch (e) {
    Zotero.logError(e);
  }

  // 补加载已开窗口: 插件安装/更新/中途启用时主窗口早已存在, 之后不会再有
  // onMainWindowLoad 触发, 侧栏自定义元素将一直缺失(中途启用侧栏空白)。
  // 参照 make-it-red 的 addToAllWindows 先例逐窗口注入; 判重依据是窗口
  // customElements 里是否已注册 smarttranslate-panel, 已关窗口跳过
  for (const win of Zotero.getMainWindows?.() ?? []) {
    if (win.closed) continue;
    if (win.customElements?.get("smarttranslate-panel")) continue;
    try {
      Services.scriptloader.loadSubScript(
        "chrome://smarttranslate/content/scripts/panel.js",
        win,
      );
    } catch (e) {
      Zotero.logError(e);
    }
  }
}

async function onMainWindowLoad({ window }, reason) {
  // 侧栏自定义元素 bundle: customElements 只存在于各主窗口, 必须在窗口
  // 作用域内执行注册; Services 只在 bootstrap 沙箱可用(主 bundle 里没有),
  // 因此 loadSubScript 放这里而不是 hooks.onMainWindowLoad。
  // chrome content 已在 startup 注册, 直接用 chrome URL, 避免 rootURI
  // 拼接歧义(现有 smarttranslate.js 的双斜杠写法是历史先例, 新代码写对)
  try {
    Services.scriptloader.loadSubScript(
      "chrome://smarttranslate/content/scripts/panel.js",
      window,
    );
  } catch (e) {
    Zotero.logError(e);
  }
  await Zotero.SmartTranslate?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.SmartTranslate?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  await Zotero.SmartTranslate?.hooks.onShutdown();

  // 解除全局桥引用: index.ts 用 ??= 挂载, 全局对象不清理时升级/重启用
  // 会一直保留旧 bundle 对象跑旧代码; 置 undefined 让下次 startup 挂新 bundle
  Zotero.SmartTranslate = undefined;

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall(data, reason) {}
