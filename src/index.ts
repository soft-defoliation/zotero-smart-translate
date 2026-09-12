/**
 * Smart Translate for Zotero — Bootstrap entry
 *
 * Wired by addon/bootstrap.js: exposes Zotero.SmartTranslate.hooks.
 * Pattern follows zotero-plugin-template (bootstrap.js loads the bundle
 * then calls hooks.onStartup()).
 */

import hooks from "./hooks";
import { data, initData } from "./data";

// 挂到全局供 bootstrap.js 调用; 用 globalThis 而非 window——
// Zotero 的 bootstrap 沙箱没有 window, 但 globalThis 与 bare Zotero 都可达
(globalThis as any).Zotero ??= {};
(globalThis as any).Zotero.SmartTranslate ??= { hooks, data };
