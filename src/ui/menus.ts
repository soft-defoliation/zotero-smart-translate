/**
 * Menus, toolbar entry and keyboard shortcut.
 * Uses stable XUL DOM hooks (popupshowing on #zotero-itemmenu) plus
 * window keydown listener — no dependency on toolkit menu helpers,
 * verified pattern across Zotero 7–10 plugin ecosystem.
 */

import { translateText } from "../data";
import { zhErrorMessage } from "../engine/errors";
import { setExtraField } from "../engine/extra-fields";
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
 * 注册条目右键菜单(标题翻译/摘要翻译/阅读助手/批量翻译导出四项)。
 * 返回卸载函数: 移除 popupshowing 监听并清掉已动态创建的菜单项 —
 * 插件停用/重载时若不清理, 残留菜单项点击会触发已卸载代码(僵尸入口)。
 */
export function registerItemMenu(Zotero: any): () => void {
  const unloads: Array<() => void> = [];
  try {
    for (const win of Zotero.getMainWindows?.() ?? []) {
      const menu = win.document?.getElementById("zotero-itemmenu");
      if (!menu || menu.querySelector?.(".smarttranslate-title-menuitem")) continue;
      const onPopupShowing = () => {
        // 第一/二项: 标题/摘要翻译(译文写入条目 Extra 字段, 供自定义列展示)。
        // 注: 本模块已静态 import data.ts 的 translateText, 翻译链路随主 bundle
        // 启动即加载; 此处动态 import 本模块仅复用模块缓存, 无额外懒加载效果
        let titleItem = menu.querySelector?.(".smarttranslate-title-menuitem") as any;
        if (!titleItem) {
          titleItem = win.document.createXULElement?.("menuitem") ?? win.document.createElement("menuitem");
          titleItem.className = "smarttranslate-title-menuitem";
          titleItem.setAttribute("label", "SmartTranslate: 翻译标题（写入条目）");
          titleItem.addEventListener("command", () => {
            void import("./menus").then((m) => m.translateItemField(Zotero, "title"));
          });
          menu.appendChild(titleItem);
        }
        let abstractItem = menu.querySelector?.(".smarttranslate-abstract-menuitem") as any;
        if (!abstractItem) {
          abstractItem = win.document.createXULElement?.("menuitem") ?? win.document.createElement("menuitem");
          abstractItem.className = "smarttranslate-abstract-menuitem";
          abstractItem.setAttribute("label", "SmartTranslate: 翻译摘要（写入条目）");
          abstractItem.addEventListener("command", () => {
            void import("./menus").then((m) => m.translateItemField(Zotero, "abstract"));
          });
          menu.appendChild(abstractItem);
        }
        // 第三项: 阅读助手(全文摘要/创新点/方法结构化, 结果写子笔记)。
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
        // 第四项: 批量翻译导出(多选条目 -> 双语 Markdown 落盘到选定文件夹)。
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
        menu.querySelector?.(".smarttranslate-title-menuitem")?.remove?.();
        menu.querySelector?.(".smarttranslate-abstract-menuitem")?.remove?.();
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
 * 导出模块(batch-export.ts)经动态 import 延迟到首次调用才加载; 翻译基础
 * 链路(data.ts)已随主 bundle 静态加载, 此处动态 import 不产生额外懒加载收益。
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
 * headline 默认为批量翻译导出口径, 翻译字段入口可传入自己的标题。
 */
function showMenuTip(
  Zotero: any,
  message: string,
  headline = "SmartTranslate: 批量翻译导出",
): void {
  try {
    const pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.show();
    pw.changeHeadline(headline);
    pw.addLines(`⚠ ${message}`);
    pw.startCloseTimer(6000);
  } catch {
    /* 进度窗不可用时静默, 不阻断主流程 */
  }
}

/**
 * 单字段翻译入口(标题或摘要): 取第一个选中的普通条目, 翻译后把译文写入
 * 条目 Extra 字段(key titleTranslation/abstractTranslation), 供条目列表
 * 自定义列(见 ui/item-columns.ts)展示, 亦与 T4Z 的 Extra 用法互通。
 * - 无选中条目/非普通条目 -> showMenuTip 提示后返回 null;
 * - 字段为空 -> 提示无可翻译内容, 不发请求;
 * - 翻译失败 -> 错误结果面板(文案可复制), 不写条目;
 * - 写回失败 -> 不影响结果展示, 面板正文追加一行警示, 译文仍可复制。
 */
export async function translateItemField(
  Zotero: any,
  field: "title" | "abstract",
): Promise<{ src: string; translation: string } | null> {
  try {
    const items = Zotero.getActiveZoteroPane?.()?.getSelectedItems?.() ?? [];
    const item = items[0];
    if (
      !item ||
      typeof item.isRegularItem !== "function" ||
      !item.isRegularItem()
    ) {
      showMenuTip(Zotero, "请先选中一个普通条目", "SmartTranslate");
      return null;
    }
    const src: string = item.getField(field) ?? "";
    if (!src.trim()) {
      showMenuTip(
        Zotero,
        field === "title" ? "该条目没有标题可翻译" : "该条目没有摘要可翻译",
        "SmartTranslate",
      );
      return null;
    }
    // 翻译失败走右下角结果面板(错误文案可复制), 不用不可复制的阻塞式系统弹窗
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
    // 译文持久化到 Extra 字段; 写回失败只追加警示行, 不吞掉已拿到的译文
    let warning = "";
    try {
      await setExtraField(
        item,
        field === "title" ? "titleTranslation" : "abstractTranslation",
        translation,
      );
    } catch (e) {
      Zotero?.logError?.(e);
      warning = "\n⚠ 译文未能写入条目";
    }
    // 成功结果以面板呈现: 原文/译文用 ---- 分隔, 同 T4Z Both 格式
    showResultPanel(
      Zotero,
      field === "title"
        ? "SmartTranslate: 标题翻译"
        : "SmartTranslate: 摘要翻译",
      `${src}\n----\n${translation}${warning}`,
    );
    return { src, translation };
  } catch {
    return null;
  }
}
