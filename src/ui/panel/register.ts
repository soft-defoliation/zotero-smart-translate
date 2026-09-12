/**
 * 条目面板"SmartTranslate 翻译"侧栏 section 注册(主 bundle 侧)。
 * API 事实见 .fleet/design/20260909-sidebar-tech.md:
 * - registerSection 自 Zotero 7 存在; 传 pluginID 后插件禁用/卸载自动清理,
 *   无需 unregisterSection
 * - onRender 类型标可选但核心 JSDoc 必选, 必须提供
 * - onItemChange 仅阅读器标签页启用(T4Z 同款, 返回 true 照抄)
 *
 * [严禁 import smart-panel/custom-elements] 本文件随主 bundle 在 bootstrap
 * 沙箱执行, 沙箱没有 customElements; 自定义元素由 panel bundle
 * (content/scripts/panel.js)在主窗口 loadSubScript 时注册。这里只按标签名
 * querySelector, 经结构化类型调用 render, 不产生 import 依赖。
 *
 * l10nID 指向不存在的 ftl 条目(本插件无 locale 体系): header 标签可能显示
 * 为空或显示 id 本身, 未真机验证 — 风险已记录于技术文档, 必要时再补最小 ftl。
 */

import { getSharedPanels } from "../../engine/translate-store";

/** 侧栏自定义元素的结构化视图(本文件不 import 实现, 只认这个形状) */
interface PanelElementLike {
  render?: () => void;
}

export function registerSidebarSection(Zotero: any, pluginID: string): void {
  // 老版本 Zotero 无 ItemPaneManager: 静默跳过, 其余功能不受影响
  if (!Zotero?.ItemPaneManager?.registerSection) return;
  try {
    Zotero.ItemPaneManager.registerSection({
      paneID: "smarttranslate",
      pluginID,
      header: {
        icon: "chrome://smarttranslate/content/icons/section-16.svg",
        l10nID: "smarttranslate-section-header",
      },
      sidenav: {
        icon: "chrome://smarttranslate/content/icons/section-20.svg",
        l10nID: "smarttranslate-section-sidenav",
      },
      // 声明式 DOM, 解析于主窗口文档; 元素定义由 panel.js 提供
      bodyXHTML: "<smarttranslate-panel />",
      onInit: (props: any) => {
        // 随机 UID 把核心给的 refresh 挂进共享面板表(T4Z 同款机制),
        // UID 存 body.dataset, onDestroy 时据此移除, 无需闭包配对
        const uid = `st-panel-${Math.random().toString(36).slice(2)}`;
        if (props.body) props.body.dataset.stPanelUid = uid;
        getSharedPanels().add(uid, props.refresh);
      },
      onDestroy: (props: any) => {
        const uid = props.body?.dataset?.stPanelUid;
        if (uid) getSharedPanels().remove(uid);
      },
      onRender: (props: any) => {
        // 元素可能尚未 upgrade(panel.js 晚于首次渲染加载): render 可选调用
        const el = props.body?.querySelector?.(
          "smarttranslate-panel",
        ) as PanelElementLike | null;
        el?.render?.();
      },
      onItemChange: (props: any) => {
        // 仅阅读器标签页启用; item.id 写 body.dataset 供后续扩展取用
        if (props.tabType !== "reader") props.setEnabled(false);
        if (props.body && props.item != null) {
          props.body.dataset.itemId = String(props.item.id ?? "");
        }
        return true;
      },
    });
  } catch (e) {
    Zotero?.logError?.(e);
  }
}
