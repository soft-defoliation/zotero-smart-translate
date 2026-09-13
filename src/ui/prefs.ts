/**
 * "打开设置"入口(划词弹窗错误文案旁/侧栏错误状态行共用):
 * 打开本插件的首选项面板。
 *
 * paneID 事实(Zotero 10 源码 chrome/content/zotero/xpcom/preferencePanes.js):
 * - bootstrap.js 经 Zotero.PreferencePanes.register 注册本插件 pane, 未传
 *   显式 id 时 Zotero 自动生成 "plugin-pane-<随机串>-<pluginID>", 每次启动
 *   都不同, 无法硬编码;
 * - 因此运行时从公开数组 Zotero.PreferencePanes.pluginPanes 按 pluginID
 *   反查实际 paneID, 再交 Zotero.Utilities.Internal.openPreferences(paneID)
 *   打开(签名见 zotero-types utilities_internal.d.ts);
 * - 任一环节 API 缺失(老版本 Zotero / pane 未注册)时返回 false, UI 层据此
 *   不渲染"打开设置"按钮。
 */

/** 本插件 ID 回落值: 正常路径由 bootstrap.js 注入 Zotero.SmartTranslate.id */
const PLUGIN_ID_FALLBACK = "smarttranslate@fengqiu.dev";

/** 从 pluginPanes 反查本插件 paneID; 找不到返回 undefined */
function resolvePluginPaneID(): string | undefined {
  const zotero = (globalThis as any).Zotero;
  const pluginID: string = zotero?.SmartTranslate?.id ?? PLUGIN_ID_FALLBACK;
  const pane = zotero?.PreferencePanes?.pluginPanes?.find?.(
    (p: any) => p?.pluginID === pluginID && !!p?.id,
  );
  return pane?.id;
}

/**
 * 当前环境是否具备"打开设置"的全部前置 API(UI 层据此决定是否渲染按钮):
 * openPreferences 存在且本插件 pane 已注册。
 */
export function canOpenPrefs(): boolean {
  try {
    const zotero = (globalThis as any).Zotero;
    if (typeof zotero?.Utilities?.Internal?.openPreferences !== "function") {
      return false;
    }
    return !!resolvePluginPaneID();
  } catch {
    return false;
  }
}

/**
 * 打开本插件设置面板; 打不开(API 缺失/pane 未注册)时返回 false 且绝不抛错 —
 * "打开设置"只是引导入口, 失败不能影响错误文案的展示。
 */
export function openPluginPrefs(): boolean {
  try {
    const zotero = (globalThis as any).Zotero;
    const open = zotero?.Utilities?.Internal?.openPreferences;
    if (typeof open !== "function") return false;
    const paneID = resolvePluginPaneID();
    if (!paneID) return false;
    open.call(zotero.Utilities.Internal, paneID);
    return true;
  } catch {
    return false;
  }
}
