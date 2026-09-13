/**
 * Menus, toolbar entry and keyboard shortcut.
 * Uses stable XUL DOM hooks (popupshowing on #zotero-itemmenu) plus
 * window keydown listener — no dependency on toolkit menu helpers,
 * verified pattern across Zotero 7–10 plugin ecosystem.
 */

import { translateText } from "../data";
import { zhErrorMessage } from "../engine/errors";
import { setExtraField } from "../engine/extra-fields";
import { createProgressLine } from "../reading/progress-line";
import { showResultPanel } from "./result-panel";
import { translateItemsField } from "./field-batch";

const SHORTCUT = { ctrl: true, shift: true, key: "T" };

/**
 * 本会话菜单项的归属戳: 插件重载后, 上次会话残留的菜单项 command 监听指向
 * 旧闭包(旧 bundle 已卸载), 点击无效 — 僵尸入口。本会话新建的项都打上该戳,
 * popupshowing 时发现无戳/旧戳的项先移除再重建。
 * 注: 存属性用 setAttribute("data-st-owner") 而非 dataset.stOwner —
 * XUL menuitem 不保证实现 HTMLElement 的 dataset API, setAttribute 对任何
 * Element 都可用。
 */
const MENU_OWNER = "st-" + Date.now();

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
      if (!menu) continue;
      // 防重复挂监听: 仅当已存在带"本会话 owner 戳"的项时跳过 —
      // 无戳旧项(上次插件会话残留)不阻止注册, 交给 onPopupShowing 清理重建
      if (
        menu.querySelector?.(
          `.smarttranslate-title-menuitem[data-st-owner="${MENU_OWNER}"]`,
        )
      ) {
        continue;
      }
      const onPopupShowing = () => {
        /**
         * 菜单项"查漏补缺"工厂: 已存在且带本会话戳的项原样保留;
         * 无戳/旧戳的项(上次插件会话残留, command 指向已死的旧闭包, 点击无效)
         * 先移除再新建, 新建项一律打上 MENU_OWNER 戳。
         */
        const ensureItem = (
          cls: string,
          label: string,
          onCommand: () => void,
        ): void => {
          let item = menu.querySelector?.(`.${cls}`) as any;
          if (item && item.getAttribute?.("data-st-owner") !== MENU_OWNER) {
            // 僵尸项: 上次会话的闭包已死, 留着只会误导用户, 先移除
            item.remove?.();
            item = null;
          }
          if (item) return;
          item =
            win.document.createXULElement?.("menuitem") ??
            win.document.createElement("menuitem");
          item.className = cls;
          item.setAttribute("label", label);
          item.setAttribute("data-st-owner", MENU_OWNER);
          item.addEventListener("command", onCommand);
          menu.appendChild(item);
        };
        // 第一/二项: 标题/摘要翻译(译文写入条目 Extra 字段, 供自定义列展示)。
        // 注: 本模块已静态 import data.ts 的 translateText, 翻译链路随主 bundle
        // 启动即加载; 此处动态 import 本模块仅复用模块缓存, 无额外懒加载效果
        // popupshowing 事件路径整体兜底: 单个菜单项构建/事件异常只记日志,
        // 不向 Zotero 菜单事件分发抛错, 保住整个右键菜单与其余监听
        try {
          ensureItem(
            "smarttranslate-title-menuitem",
            "SmartTranslate: 翻译标题（写入条目）",
            () => {
              void import("./menus").then((m) =>
                m.translateItemField(Zotero, "title"),
              );
            },
          );
          ensureItem(
            "smarttranslate-abstract-menuitem",
            "SmartTranslate: 翻译摘要（写入条目）",
            () => {
              void import("./menus").then((m) =>
                m.translateItemField(Zotero, "abstract"),
              );
            },
          );
          // 第三项: 阅读助手(全文摘要/创新点/方法结构化, 结果写子笔记)。
          // 动态 import 与 hooks.ts 的回调风格一致, 菜单注册时不加载分析链路
          ensureItem(
            "smarttranslate-reading-menuitem",
            "SmartTranslate: 阅读助手（摘要/创新点/方法）",
            () => {
              void import("../reading/assistant").then((m) =>
                m.runReadingAssistantForItem(Zotero),
              );
            },
          );
          // 第四项: 批量翻译导出(多选条目 -> 双语 Markdown 落盘到选定文件夹)。
          // 同阅读助手做动态 import: 菜单注册时不加载导出链路
          ensureItem(
            "smarttranslate-batch-export-menuitem",
            "SmartTranslate: 批量翻译导出（双语 Markdown）",
            () => {
              void runBatchExportForSelection(Zotero).catch((e) => {
                // 兜底: 动态 import 失效等极早期异常, 避免出现未处理的 Promise 拒绝
                showMenuTip(Zotero, zhErrorMessage(e));
              });
            },
          );
        } catch (e) {
          Zotero?.logError?.(e);
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
 * 单字段翻译入口(标题或摘要): 单选走逐条流程(翻译后把译文写入条目 Extra
 * 字段, key titleTranslation/abstractTranslation), 供条目列表自定义列
 * (见 ui/item-columns.ts)与 Info 区译文行(见 ui/info-rows.ts)展示,
 * 亦与 T4Z 的 Extra 用法互通; 多选(>1)走批量链路(T4Z 同款, 全量处理,
 * 见 ui/field-batch.ts), 配进度窗汇总, 不返回单条结果面板。
 * - 单选: 无选中条目/非普通条目 -> showMenuTip 提示后返回 null;
 * - 单选: 字段为空 -> 提示无可翻译内容, 不发请求;
 * - 单选: 翻译失败 -> 错误结果面板(文案可复制), 不写条目;
 * - 单选: 写回失败 -> 不影响结果展示, 面板正文追加一行警示, 译文仍可复制;
 * - 多选: 进度窗不可用(无窗口环境)时只跑批量不显示进度。
 */
export async function translateItemField(
  Zotero: any,
  field: "title" | "abstract",
): Promise<{ src: string; translation: string } | null> {
  try {
    const items = Zotero.getActiveZoteroPane?.()?.getSelectedItems?.() ?? [];
    // 多选: 批量链路(含非普通条目, field-batch 内按空字段跳过兜底),
    // 返回 null 与"无选中条目"同语义, 调用方(快捷键/菜单)不区分
    if (items.length > 1) {
      await runBatchFieldTranslation(Zotero, items, field);
      return null;
    }
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
  } catch (e) {
    // 原为静默吞错: 至少记一行日志, 便于排查"点了菜单没反应"类问题;
    // 返回 null 的既有语义不变
    Zotero?.logError?.(e);
    return null;
  }
}

/**
 * 多选批量翻译的进度窗封装: 逐条回调经可更新进度行汇总(setText/setProgress,
 * progress-line 工厂兜底为 null 时可选链静默), 结束后 headline 更新为结果
 * 摘要并定时关闭。进度窗构建整体包 try/catch: 无窗口环境(测试/窗口已销毁)
 * 只跑批量不显示进度, 不阻断翻译主流程。
 */
async function runBatchFieldTranslation(
  Zotero: any,
  items: any[],
  field: "title" | "abstract",
): Promise<void> {
  const headline =
    field === "title"
      ? "SmartTranslate: 批量翻译标题"
      : "SmartTranslate: 批量翻译摘要";
  let pw: any = null;
  try {
    pw = new Zotero.ProgressWindow({ closeOnClick: false });
    pw.show();
    pw.changeHeadline(headline);
  } catch {
    pw = null;
  }

  // 汇总行: createProgressLine 自带兜底(失败返回 null), pw 为 null 时跳过;
  // 引用提升到回调外, 回调里 ?. 静默降级(进度显示缺失但不阻断)
  const summaryLine = pw ? createProgressLine(pw, `0/${items.length}`) : null;
  const total = items.length;
  let doneN = 0;
  const result = await translateItemsField(items, field, {
    onItemDone: (_index, status) => {
      if (status === "done") doneN += 1;
      summaryLine?.setText?.(`${doneN}/${total}`);
      summaryLine?.setProgress?.(Math.round((doneN / total) * 100));
    },
  });

  try {
    pw?.changeHeadline?.(
      `${headline} 完成 ${result.done}/${result.total} · 跳过 ${result.skipped} · 失败 ${result.failed}`,
    );
    pw?.startCloseTimer?.(4000);
  } catch {
    /* 进度窗可能已销毁, 收尾失败静默 */
  }
}
