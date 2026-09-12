/**
 * panel bundle 唯一入口 — 由 zotero-plugin.config.ts 的第二份 esbuild 配置
 * 打包为 content/scripts/panel.js, 由 addon/bootstrap.js 的 onMainWindowLoad
 * 用 loadSubScript 注入每个主窗口作用域。
 *
 * 为什么 customElements.define 放这里而不是 smart-panel.ts:
 * 主 bundle(bootstrap 沙箱)里没有 customElements, define 若写在
 * smart-panel.ts 模块顶层, 任何一处主 bundle 的误 import 都会在沙箱里执行
 * define 而抛错; 拆出独立入口后, define 只随 panel.js 在主窗口执行,
 * 主 bundle 物理上不会 import 到本文件。
 *
 * [双 bundle 模块双实例] 本 bundle 经 import 树自带 translate-store/
 * settings/data 的独立模块实例(契约已接受这一代价):
 * - store: smart-panel 经 getSharedStore() 代理到 Zotero.SmartTranslate.store,
 *   与主 bundle 共享同一实例, 划词与侧栏数据同步(见 engine/translate-store.ts)
 * - settings: 两 bundle 各一份, smart-panel 在每次 render/翻译前 bindPrefs
 *   重读, 与设置页写入最终一致(v1 取舍, 代价一次 JSON 读)
 * - glossary: 同样双实例, 在下方入口初始化块中播种术语种子(幂等)
 */

import { SmartTranslatePanel } from "./smart-panel";
import { bindPrefs, getSettings } from "../../engine/settings";
import { data, initData } from "../../data";

// panel bundle 与主 bundle 的 data 是双实例(见文件头"双实例"说明):
// settings/secrets 由 smart-panel 每次 render/翻译前 bindPrefs 从
// Zotero.Prefs 重读同步, 唯一的非 prefs 状态是 data.glossary 术语种子 —
// 不在此播种, 侧栏/面板入口发起的翻译拿不到术语锁定(主 bundle 的
// hooks.onStartup 只播种自己的实例)。幂等: 词条表非空即视为已播,
// 防同一窗口重复 loadSubScript 时种子翻倍; 初始化任何异常只记录,
// 不阻断 customElements.define(否则侧栏整个不可用)
try {
  const zotero = (globalThis as any).Zotero;
  if (zotero?.Prefs) bindPrefs(zotero.Prefs);
  if (data.glossary.getTerms().length === 0) initData(getSettings());
} catch (e) {
  (globalThis as any).Zotero?.logError?.(e);
}

// 防重复 define: customElements.define 对同名元素重复注册会抛错
if (!customElements.get("smarttranslate-panel")) {
  customElements.define("smarttranslate-panel", SmartTranslatePanel);
}
