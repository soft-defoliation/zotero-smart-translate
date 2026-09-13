/**
 * Lifecycle hooks — dispatch only, no business logic here.
 * Pattern: zotero-plugin-template src/hooks.ts
 */

declare const Zotero: any;

import { registerReaderUI, unregisterReaderUI } from "./ui/reader";
import { registerItemMenu, registerShortcut } from "./ui/menus";
import { registerSidebarShortcut } from "./ui/shortcuts";
import { registerItemColumns } from "./ui/item-columns";
import { data, initData } from "./data";
import { bindPrefs, getSettings } from "./engine/settings";
import {
  createPanelRegistry,
  createTranslateStore,
} from "./engine/translate-store";
import { registerSidebarSection } from "./ui/panel/register";

/** 各 UI 入口的卸载函数(onStartup 登记, onShutdown 依序调用) */
let unregisterReader: () => void = () => {};
let unregisterMenu: () => void = () => {};
let unregisterShortcut: () => void = () => {};
let unregisterSidebarShortcut: () => void = () => {};
let unregisterColumns: () => void = () => {};

export default {
  async onStartup() {
    // 持久化地基: 启动时绑定 Zotero.Prefs, 缺失则保持内存态
    if (Zotero?.Prefs) bindPrefs(Zotero.Prefs);
    initData(getSettings());
    // 双 bundle 共享桥: 主 bundle 启动时把 store/panels 挂到 Zotero 全局
    // 对象, panel bundle(主窗口作用域)经 getSharedStore/getSharedPanels
    // 代理到同一实例, 规避两份 bundle 各自模块态导致划词与侧栏数据不同步
    // (决策详见 engine/translate-store.ts 头注释)
    const bridge = (globalThis as any).Zotero?.SmartTranslate;
    if (bridge) {
      bridge.store ??= createTranslateStore();
      bridge.panels ??= createPanelRegistry();
    }
    const addonID = Zotero.SmartTranslate?.id ?? "smarttranslate@fengqiu.dev";
    // 五个 UI 入口都登记卸载函数(reader 为模块级导出函数, 其余为返回值),
    // 停用/重载时在 onShutdown 逐项回收; 菜单含标题/摘要两项, 快捷键触发标题翻译,
    // Alt+B 切换双语侧栏(仅 reader 标签生效)
    registerReaderUI(Zotero, addonID);
    unregisterReader = unregisterReaderUI;
    unregisterMenu = registerItemMenu(Zotero);
    unregisterShortcut = registerShortcut(Zotero, () => {
      void import("./ui/menus").then((m) =>
        m.translateItemField(Zotero, "title"),
      );
    });
    // Alt+B 侧栏快捷键: 注册失败只记录不阻断启动(同 registerItemColumns 接线风格)
    try {
      unregisterSidebarShortcut = registerSidebarShortcut(Zotero);
    } catch (e) {
      Zotero?.logError?.(e);
    }
    // 条目面板侧栏 section: ItemPaneManager 缺失(老版本)时内部跳过,
    // 异常只记录不阻断启动
    try {
      registerSidebarSection(Zotero, addonID);
    } catch (e) {
      Zotero?.logError?.(e);
    }
    // 条目列表自定义列(标题译文/摘要译文): ItemTreeManager 缺失(老版本)
    // 时内部静默跳过, 异常只记录不阻断启动
    try {
      unregisterColumns = registerItemColumns(Zotero, addonID);
    } catch (e) {
      Zotero?.logError?.(e);
    }
    data.initialized = true;
  },

  async onMainWindowLoad(_window: any) {
    // defer until main window DOM is ready
  },

  async onMainWindowUnload(_window: any) {
    // no-op
  },

  async onShutdown() {
    // UI 卸载: reader 监听/菜单/快捷键/侧栏快捷键/条目列逐项回收,
    // 各自 try/catch 兜底, 单个失败不阻断其余清理, 也不阻断下方 alive 置位
    for (const unload of [
      unregisterReader,
      unregisterMenu,
      unregisterShortcut,
      unregisterSidebarShortcut,
      unregisterColumns,
    ]) {
      try {
        unload();
      } catch (e) {
        Zotero?.logError?.(e);
      }
    }
    data.alive = false;
    data.initialized = false;
  },

  // 首选项面板保存后触发: 重新从 Zotero.Prefs 加载设置, 免重启生效;
  // bindPrefs 幂等且自带解析容错, 守卫 Prefs 缺失时静默跳过保持内存态
  async onPrefsChanged() {
    if (Zotero?.Prefs) bindPrefs(Zotero.Prefs);
  },
};
