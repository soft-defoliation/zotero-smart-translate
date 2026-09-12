/**
 * Menus, toolbar entry and keyboard shortcut.
 * Uses stable XUL DOM hooks (popupshowing on #zotero-itemmenu) plus
 * window keydown listener — no dependency on toolkit menu helpers,
 * verified pattern across Zotero 7–10 plugin ecosystem.
 */

import { translateText } from "../data";
import { zhErrorMessage } from "../engine/errors";
import { showResultPanel } from "./result-panel";

const SHORTCUT = { ctrl: true, shift: true, key: "T" };

/** 聚合一组窗口级卸载步骤为一个总卸载函数, 单个失败不阻断其余 */
function combineUnloads(unloads: Array<() => void>): () => void {
  return () => {
    for (const unload of unloads) {
      try {
        unload();
      } catch {
        /* 窗口可能已销毁, 单个清理失败不影响其余 */
      }
    }
  };
}

/**
 * 注册条目右键菜单(翻译标题/摘要 + 阅读助手 + 批量翻译导出三项)。
 * 返回卸载函数: 移除 popupshowing 监听并清掉已动态创建的菜单项 —
 * 插件停用/重载时若不清理, 残留菜单项点击会触发已卸载代码(僵尸入口)。
 */
export function registerItemMenu(
  Zotero: any,
  onTranslateTitle: () => void,
): () => void {
  const unloads: Array<() => void> = [];
  try {
    for (const win of Zotero.getMainWindows?.() ?? []) {
      const menu = win.document?.getElementById("zotero-itemmenu");
      if (!menu || menu.querySelector?.(".smarttranslate-menuitem")) continue;
      const onPopupShowing = () => {
        let item = menu.querySelector?.(".smarttranslate-menuitem") as any;
        if (!item) {
          item = win.document.createXULElement?.("menuitem") ?? win.document.createElement("menuitem");
          item.className = "smarttranslate-menuitem";
          item.setAttribute("label", "SmartTranslate: 翻译标题/摘要");
          item.addEventListener("command", () => void onTranslateTitle());
          menu.appendChild(item);
        }
        // 第二项: 阅读助手(全文摘要/创新点/方法结构化, 结果写子笔记)。
        // 动态 import 与 hooks.ts 的回调风格一致, 菜单注册时不加载分析链路
        let reading = menu.querySelector?.(".smarttranslate-reading-menuitem") as any;
        if (!reading) {
          reading = win.document.createXULElement?.("menuitem") ?? win.document.createElement("menuitem");
          reading.className = "smarttranslate-reading-menuitem";
          reading.setAttribute("label", "SmartTranslate: 阅读助手（摘要/创新点/方法）");
          reading.addEventListener("command", () => {
            void import("../reading/assistant").then((m) =>
              m.runReadingAssistantForItem(Zotero),
            );
          });
          menu.appendChild(reading);
        }
        // 第三项: 批量翻译导出(多选条目 -> 双语 Markdown 落盘到选定文件夹)。
        // 同阅读助手做动态 import: 菜单注册时不加载导出链路
        let batchExport = menu.querySelector?.(".smarttranslate-batch-export-menuitem") as any;
        if (!batchExport) {
          batchExport = win.document.createXULElement?.("menuitem") ?? win.document.createElement("menuitem");
          batchExport.className = "smarttranslate-batch-export-menuitem";
          batchExport.setAttribute("label", "SmartTranslate: 批量翻译导出（双语 Markdown）");
          batchExport.addEventListener("command", () => {
            void runBatchExportForSelection(Zotero).catch((e) => {
              // 兜底: 动态 import 失效等极早期异常, 避免出现未处理的 Promise 拒绝
              showMenuTip(Zotero, zhErrorMessage(e));
            });
          });
          menu.appendChild(batchExport);
        }
      };
      menu.addEventListener("popupshowing", onPopupShowing);
      unloads.push(() => {
        menu.removeEventListener("popupshowing", onPopupShowing);
        // 动态创建的菜单项可能已存在(弹开过菜单), 一并移除
        menu.querySelector?.(".smarttranslate-menuitem")?.remove?.();
        menu.querySelector?.(".smarttranslate-reading-menuitem")?.remove?.();
        menu.querySelector?.(".smarttranslate-batch-export-menuitem")?.remove?.();
      });
    }
  } catch {
    /* main window not ready */
  }
  return combineUnloads(unloads);
}

/**
 * 注册全局快捷键 Ctrl+Shift+T。返回卸载函数: 按窗口移除 keydown 监听,
 * 监听引用需保存(匿名函数无法 removeEventListener)。
 */
export function registerShortcut(Zotero: any, onTrigger: () => void): () => void {
  const unloads: Array<() => void> = [];
  try {
    for (const win of Zotero.getMainWindows?.() ?? []) {
      const onKeyDown = (ev: any) => {
        const key = (ev.key ?? "").toUpperCase();
        if (ev.ctrlKey && ev.shiftKey && key === SHORTCUT.key) {
          // Don't steal the shortcut when the original translate plugin handles it:
          // ours only fires when focus is NOT in a reader selection popup owned by them.
          if ((ev.target as any)?.closest?.("[data-smarttranslate]")) return;
          ev.preventDefault();
          onTrigger();
        }
      };
      win.addEventListener("keydown", onKeyDown);
      unloads.push(() => win.removeEventListener("keydown", onKeyDown));
    }
  } catch {
    /* ignore */
  }
  return combineUnloads(unloads);
}

/**
 * 批量翻译导出菜单入口: 收集当前选中的条目(普通条目与 PDF 附件都算,
 * 附件由 runBatchExport 内部向上归一取父条目), 空选给进度窗提示后返回。
 * 动态 import 与阅读助手一致, 菜单注册时不加载导出/翻译链路。
 */
export async function runBatchExportForSelection(Zotero: any): Promise<void> {
  const selected = Zotero.getActiveZoteroPane?.()?.getSelectedItems?.() ?? [];
  const items = selected.filter(
    (it: any) => it?.isRegularItem?.() || it?.isAttachment?.(),
  );
  if (!items.length) {
    showMenuTip(Zotero, "请先在条目列表中选中一个或多个条目(可多选)");
    return;
  }
  const { runBatchExport } = await import("../reading/batch-export");
  await runBatchExport(Zotero, items);
}

/**
 * 菜单早期失败的轻量提示窗: 与 assistant.ts 的 showTip 同一 ProgressWindow
 * 用法, 在菜单模块内单独实现以免静态依赖导出链路(导出模块只动态 import)。
 */
function showMenuTip(Zotero: any, message: string): void {
  try {
    const pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.show();
    pw.changeHeadline("SmartTranslate: 批量翻译导出");
    pw.addLines(`⚠ ${message}`);
    pw.startCloseTimer(6000);
  } catch {
    /* 进度窗不可用时静默, 不阻断主流程 */
  }
}

export async function translateTitleAbstract(
  Zotero: any,
): Promise<{ title: string; translation: string } | null> {
  try {
    const items = Zotero.getActiveZoteroPane?.()?.getSelectedItems?.() ?? [];
    const item = items[0];
    if (!item || typeof item.getField !== "function") return null;
    const title: string = item.getField("title") ?? "";
    const abstract: string = item.getField("abstractNote") ?? "";
    const src = abstract ? `${title}\n${abstract}` : title;
    if (!src.trim()) return null;
    // 翻译失败改走右下角结果面板(错误文案可复制), 不再用不可复制的阻塞式系统弹窗
    let translation: string;
    try {
      translation = await translateText(src);
    } catch (e) {
      showResultPanel(
        Zotero,
        "SmartTranslate: 翻译失败",
        zhErrorMessage(e),
        true,
      );
      return null;
    }
    // 成功结果以面板呈现: 原文/译文用 ---- 分隔, 同 T4Z Both 格式
    showResultPanel(
      Zotero,
      "SmartTranslate: 标题翻译",
      `${src}\n----\n${translation}`,
    );
    return { title, translation };
  } catch {
    return null;
  }
}
