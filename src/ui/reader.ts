/**
 * Reader UI — selection popup, concat buffer, collect-note write-back.
 *
 * Event wiring verified against Translate for Zotero v2.4.7 bundle
 * (Zotero 10.0.1, first-hand):
 * - Zotero.Reader.registerEventListener("renderTextSelectionPopup",
 *     ({reader, doc, params, append}) => ..., addonID)
 *   with text at params.annotation.text
 * - Zotero.Reader.registerEventListener("renderSidebarAnnotationHeader", ...)
 * - selection fallback: reader?._internalReader._lastView?._selectionPopup?.annotation?.text
 * - 写回: settings.writebackMode !== "off" 时把译文/对照追加到父条目的
 *   "SmartTranslate 收集"子笔记(见 reading/notes.ts appendToCollectNote)。
 *   旧的批注评论写回(annotation.comment + reader._addToNote)依赖阅读器
 *   私有 API 且从未真机验证, 已删除, 待专项验证后再议。
 *
 * 弹窗交互(可复制/可调尺寸/可重试)参照 T4Z src/modules/popup.ts 的成熟机制:
 * 译文放真 <textarea>, pointerup/dragstart/keydown 三处 stopPropagation 是
 * "能复制"的命门(阻断冒泡, 防止 Zotero 原生弹窗被点选动作关闭);
 * 复制统一走 copyText 三级 fallback, 关键路径延迟 10ms 绕过 Zotero 拦截。
 */

import { translateText } from "../data";
import {
  getActiveEngine,
  getSettings,
  setPopupSize,
  resolveFontFamily,
} from "../engine/settings";
import { getSharedStore, refreshAllPanels } from "../engine/translate-store";
import { isMostlyChinese } from "../engine/lang-detect";
import {
  CancelledError,
  CANCELLED_MESSAGE,
  NoKeyError,
  zhErrorMessage,
} from "../engine/errors";
import { canOpenPrefs, openPluginPrefs } from "./prefs";
import { appendToCollectNote, buildCollectEntry } from "../reading/notes";
import type { Settings } from "../types";

let concatBuffer = "";
// 段数独立计数: 拼接串以换行相连, 按空白切分无法区分"一段多词"与"多段",
// 只有拼接次数本身才准(reset 于 take/clear)
let concatSegments = 0;

export function concatAppend(text: string): string {
  // 空串并入只会污染缓冲与段数, 直接忽略(选空白不算一段)
  if (!text.trim()) return concatBuffer;
  // 拼接块以换行分隔, 让句子级缓存能按行还原边界:
  // 空格连接会把两块粘成一句, splitSentences 拿不到行边界, 拼串自然吃不到句子记忆
  concatBuffer = concatBuffer ? `${concatBuffer}\n${text}` : text;
  concatSegments += 1;
  return concatBuffer;
}

export function concatTake(): string {
  const out = concatBuffer;
  concatBuffer = "";
  concatSegments = 0;
  return out;
}

export function concatClear(): void {
  concatBuffer = "";
  concatSegments = 0;
}

/**
 * 拼接缓冲快照(纯内存, 无 IO): 供弹窗渲染缓冲内容与段数。
 * count 为拼接过的段数, 缓冲为空时恒为 0。
 */
export function getConcatState(): { text: string; count: number } {
  return { text: concatBuffer, count: concatSegments };
}

/** Best-effort selected text from a reader instance. */
export function getSelectedText(reader: any): string {
  try {
    const t =
      reader?._internalReader?._lastView?._selectionPopup?.annotation?.text;
    if (typeof t === "string" && t.trim()) return t.trim();
  } catch {
    /* fall through */
  }
  return "";
}

/**
 * 原文/译文拆分对(纯函数, 有既有单测)。
 * 历史来源是"双语批注写回"的 payload, 批注路线已废弃, 本函数保留:
 * 双语收集条目的语义与之一致(原文 + 译文成对), 侧栏/导出侧也按此形态组织文本。
 */
export function buildBilingualAnnotation(
  original: string,
  translation: string,
): { text: string; comment: string } {
  return { text: original, comment: translation };
}

// renderTextSelectionPopup 事件 handler 引用: 卸载时需原样传给
// unregisterEventListener 配对移除, Zotero 侧以函数引用为键
let popupHandler: ((event: any) => void) | null = null;
let popupZotero: any = null;

export function registerReaderUI(Zotero: any, addonID: string): void {
  if (!Zotero?.Reader?.registerEventListener) return;
  const handler = (event: any) => {
    void onReaderPopupShow(Zotero, event);
  };
  try {
    Zotero.Reader.registerEventListener(
      "renderTextSelectionPopup",
      handler,
      addonID,
    );
    // 仅注册成功才登记引用, 避免卸载时对未注册 handler 调 unregister
    popupHandler = handler;
    popupZotero = Zotero;
  } catch {
    /* older Zotero without this event — popup disabled, sidebar/menu still work */
  }
}

/**
 * 卸载划词弹窗监听: 插件停用/重载时移除 renderTextSelectionPopup handler,
 * 防止残留监听在插件已死的状态下继续拉起翻译(僵尸入口)。
 * unregisterEventListener(type, handler) 签名见 Zotero reader.js。
 */
export function unregisterReaderUI(): void {
  if (!popupHandler) return;
  try {
    popupZotero?.Reader?.unregisterEventListener?.(
      "renderTextSelectionPopup",
      popupHandler,
    );
  } catch {
    /* 老 Zotero 无此 API 或 reader 已销毁, 忽略 */
  }
  popupHandler = null;
  popupZotero = null;
}

/** 弹窗一行 UI 的句柄: root 为容器, textarea 为译文区, retryButton 供重试逻辑防堆积 */
interface PopupRow {
  doc: any;
  root: any;
  textarea: any;
  retryButton: any;
  /** 停止按钮(仅翻译进行中存在): 点击中止当前代际的在途请求 */
  stopButton?: any;
  /** 拼接按钮行容器: 状态变化时整行重建(缓冲空/非空的按钮集不同) */
  concatRow?: any;
  /** 非拼接态的基础 placeholder(按 autoTranslate 生成), 缓冲清空后恢复用 */
  basePlaceholder: string;
}

async function onReaderPopupShow(Zotero: any, event: any): Promise<void> {
  const { reader, append } = event ?? {};
  const text: string =
    event?.params?.annotation?.text?.trim() || getSelectedText(reader);
  if (!text) return;
  const settings = getSettings();
  const row = buildPopupRow(Zotero, event?.doc, settings);
  if (!row) return;
  append?.(row.root);
  // 参照 T4Z: 解除原生选区弹窗的宽度限制, 否则 textarea 拖不宽(maxWidth 默认很小)
  const popup = event?.doc?.querySelector?.(".selection-popup");
  if (popup) popup.style.maxWidth = "none";

  // 缓冲非空: 新划词打开弹窗时先把已拼接内容与段数铺在 textarea 上,
  // 用户可继续 ＋拼接, 也可直接点"翻译拼接"整段翻译
  const buffered = getConcatState();
  if (buffered.count > 0) {
    row.textarea.value = buffered.text;
    setConcatPlaceholder(row, buffered.count);
  }

  // run 闭包持有同一行 UI, 失败后可原样重跑(再失败继续给重试按钮);
  // payload 为本次翻译的文本: 普通划词 = 当前选区, 拼接模式 = 整段缓冲
  // (run 只接收 payload, 不再捕获 text, 两种入口共用同一条流式流程)
  const run = async (payload: string): Promise<void> => {
    // 无互斥: 新一次翻译直接 begin 抢占(新代际接管界面)。
    // begin 会先 abort 旧代际的在途请求(旧请求被真实中止, 不再后台走完),
    // 旧流的迟到回调再经 store 的代际校验作废(gen 不符即 return),
    // 不会覆盖本行的流式结果。
    // fromSelection=true: 侧栏状态行据此显示"已同步划词翻译"
    const engine = getActiveEngine();
    const gen = getSharedStore().begin(
      payload,
      engine?.id ?? "",
      engine?.name ?? "",
      true,
    );
    // 停止按钮仅翻译进行中显示; 句柄兼作"本 run 仍是最新代际"的判据 —
    // 新一轮 run 会先移除旧按钮再建新按钮, 旧 run 的迟到清理/提示据此让位
    const stopButton = showStopButton(row, () => {
      getSharedStore().cancelCurrent();
    });
    try {
      const result = await translateText(
        payload,
        (partial) => {
          getSharedStore().setPartial(gen, partial);
          void refreshAllPanels();
          updatePopupRow(row, partial, false);
        },
        {
          // 故障转移: 实际发请求的引擎可能不是 begin 时的当前引擎,
          // 回调覆盖 store 元信息, 侧栏状态行据此显示"（故障转移）"后缀
          onEngineResolved: (engineId, engineName, failover) => {
            getSharedStore().resolveEngine(gen, engineId, engineName, failover);
            void refreshAllPanels();
          },
          // 停止按钮的真实取消通道: abort 本代际在途请求
          signal: getSharedStore().getSignal(),
        },
      );
      getSharedStore().finish(gen, result);
      void refreshAllPanels();
      updatePopupRow(row, result, true);
      // 写回收集笔记: 内部 try/catch 且异步, 不阻塞弹窗展示, 失败不影响主流程
      void writeTranslationToCollectNote(Zotero, reader, payload, result);
    } catch (e) {
      const cancelled = e instanceof CancelledError;
      getSharedStore().fail(gen, zhErrorMessage(e));
      void refreshAllPanels();
      if (cancelled) {
        // 用户主动取消(或被新一轮翻译中止): 中性提示, 不按错误样式渲染,
        // textarea 保留已流出的部分译文, 也不给重试按钮
        if (row.stopButton === stopButton) {
          showCancelledHint(row);
        }
      } else {
        updatePopupRow(row, `翻译失败: ${zhErrorMessage(e)}`, true);
        // 未配置密钥: 错误文案旁追加"打开设置"入口引导配置(API 缺失时不渲染)
        if (e instanceof NoKeyError && canOpenPrefs()) {
          showOpenPrefsButton(row);
        }
        showRetryButton(row, () => void run(payload));
      }
    } finally {
      // 仅当停止按钮仍属于本 run 时才移除: 防误删新一轮 run 的按钮
      if (row.stopButton === stopButton) {
        row.stopButton?.remove?.();
        row.stopButton = null;
      }
    }
  };

  // 拼接按钮行先于翻译挂载: 任何模式下用户都能把当前选区并入缓冲
  renderConcatRow(row, text, run);

  // 中文跳过(对齐 T4Z disabledLanguages 先例): 开关开启、目标语言为中文
  // 且选区文本主要是中文时, 翻译纯属浪费 — 提示后直接返回,
  // 不发起请求、不显示翻译按钮; 手动翻译模式同样被拦截。
  // 缓冲非空时不走此分支: 此时本就不自动翻译, 弹窗要保留拼接入口
  if (
    buffered.count === 0 &&
    settings.skipChinese &&
    settings.targetLanguage.startsWith("zh") &&
    isMostlyChinese(text)
  ) {
    updatePopupRow(row, "检测到中文，已跳过翻译（可在设置中关闭）", true);
    return;
  }

  // 缓冲非空只等用户点"翻译拼接": 自动翻译会把半截缓冲浪费掉一次请求
  if (buffered.count > 0) return;

  // 自动翻译开关: 关闭时先给手动翻译按钮, 用户点击才走现有流式流程;
  // 开启时保持划词即译的现状
  if (settings.autoTranslate === false) {
    showTranslateButton(row, () => void run(text));
    return;
  }
  await run(text);
}

function buildPopupRow(
  Zotero: any,
  doc: any,
  settings: Settings,
): PopupRow | null {
  if (!doc?.createElement) return null;
  const root = doc.createElement("div");
  root.setAttribute("style", "padding:6px 8px;max-width:none;font-size:12px;");

  const textarea = doc.createElement("textarea");
  // readonly 只保证译文不可改, 不阻止选择/复制; resize:both 交给用户拖拽调尺寸
  textarea.setAttribute("readonly", "readonly");
  // 手动翻译模式(按钮在屏期间)用 placeholder 提示用户点击开始
  const placeholder = settings.autoTranslate
    ? `SmartTranslate → ${settings.targetLanguage} …`
    : `SmartTranslate → ${settings.targetLanguage} (点击下方翻译按钮开始)`;
  textarea.setAttribute("placeholder", placeholder);
  // 字体三参数随 settings 每次构建弹窗时取值, 修复默认回落衬线栈的"字体丑"问题
  textarea.setAttribute(
    "style",
    `width:${settings.popupWidth}px;height:${settings.popupHeight}px;min-width:200px;min-height:60px;` +
      `font-family:${resolveFontFamily(settings)};` +
      `font-size:${settings.fontSize}px;line-height:${settings.lineHeight};` +
      "resize:both;overflow:auto;box-sizing:border-box;",
  );
  root.appendChild(textarea);

  wirePopupEvents(Zotero, doc, root, textarea);
  return { doc, root, textarea, retryButton: null, basePlaceholder: placeholder };
}

/** 缓冲非空时的 placeholder: 说明已拼段数与下一步操作 */
function setConcatPlaceholder(row: PopupRow, count: number): void {
  row.textarea.setAttribute(
    "placeholder",
    `已拼接 ${count} 段，点翻译拼接或继续 ＋拼接`,
  );
}

/** 缓冲清空后恢复基础 placeholder(回到普通划词模式的样子) */
function restorePlaceholder(row: PopupRow): void {
  row.textarea.setAttribute("placeholder", row.basePlaceholder);
}

/**
 * textarea 事件全挂本地并 stopPropagation — 保命核心(参照 T4Z popup.ts):
 * 点选/拖拽/按键一旦冒泡到 document, Zotero 会立刻关闭选区弹窗, 复制就无从谈起。
 */
function wirePopupEvents(
  Zotero: any,
  doc: any,
  root: any,
  textarea: any,
): void {
  textarea.addEventListener("pointerup", (ev: any) => {
    ev.stopPropagation();
    persistPopupSize(textarea);
  });
  textarea.addEventListener("dragstart", (ev: any) => {
    ev.stopPropagation();
  });
  textarea.addEventListener("keydown", (ev: any) => {
    const key = (ev.key ?? "").toLowerCase();
    if (!(ev.ctrlKey || ev.metaKey)) return;
    if (key !== "c" && key !== "a" && key !== "x") return;
    ev.stopPropagation();
    if (key === "a") {
      // Ctrl+A: 全选交给原生行为, 只阻断冒泡防外层监听截走
      textarea.select?.();
      return;
    }
    // Ctrl+C/X: 复制当前选中内容(无选中则全文); 延迟 10ms 绕过 Zotero 拦截(T4Z 同款)
    const selected = String(
      textarea.value.slice(
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
      ),
    );
    setTimeout(() => {
      copyText(Zotero, doc, textarea, selected || textarea.value);
    }, 10);
  });
  textarea.addEventListener("dblclick", () => {
    // 双击 = 全选 + 复制全文 + "已复制"小提示
    textarea.select?.();
    setTimeout(() => {
      copyText(Zotero, doc, textarea, textarea.value);
      showCopiedHint(root, doc);
    }, 10);
  });
}

/** 第三级复制通道: textarea 全选 + document.execCommand("copy") */
function copyViaExecCommand(doc: any, textarea: any, text: string): void {
  try {
    textarea.focus?.();
    textarea.select?.();
    doc?.execCommand?.("copy");
  } catch {
    /* 无可用复制通道, 放弃 */
  }
}

/**
 * 统一复制辅助, 三级 fallback:
 * 1. Zotero.Utilities.Internal.copyTextToClipboard(zotero-types 已确认存在, 签名 (str: string): void)
 * 2. 窗口 navigator.clipboard.writeText
 * 3. textarea 全选 + document.execCommand("copy")
 * 第二级是异步通道: writeText 返回 promise, 只有失败后才知道要续落第三级,
 * 这里以 .catch 链式兜底(保持同步返回 void, 调用方无需感知异步)。
 * result-panel 复用同一逻辑。
 */
export function copyText(
  Zotero: any,
  doc: any,
  textarea: any,
  text: string,
): void {
  if (!text) return;
  try {
    if (Zotero?.Utilities?.Internal?.copyTextToClipboard) {
      Zotero.Utilities.Internal.copyTextToClipboard(text);
      return;
    }
  } catch {
    /* 落到浏览器剪贴板通道 */
  }
  try {
    const clip = doc?.defaultView?.navigator?.clipboard;
    if (clip?.writeText) {
      // 非用户激活上下文(如 reader iframe)writeText 常见 reject, 必须续落
      void clip.writeText(text).catch(() => {
        copyViaExecCommand(doc, textarea, text);
      });
      return;
    }
  } catch {
    /* 落到 execCommand 通道 */
  }
  copyViaExecCommand(doc, textarea, text);
}

/** pointerup 时把 textarea 实际尺寸写回设置持久化; 差异 <=4px 视为抖动不写 */
function persistPopupSize(textarea: any): void {
  try {
    const w = textarea.clientWidth;
    const h = textarea.clientHeight;
    if (typeof w !== "number" || typeof h !== "number") return;
    const { popupWidth, popupHeight } = getSettings();
    if (Math.abs(w - popupWidth) > 4 || Math.abs(h - popupHeight) > 4) {
      setPopupSize(w, h);
    }
  } catch {
    /* 尺寸回写失败不影响交互 */
  }
}

/** 双击复制后在容器内追加"已复制"小提示, 1.5 秒后自动移除; 重复双击先清旧提示 */
function showCopiedHint(root: any, doc: any): void {
  try {
    root?.querySelector?.(".smarttranslate-copied-hint")?.remove?.();
    const hint = doc.createElement("span");
    hint.className = "smarttranslate-copied-hint";
    hint.setAttribute("style", "margin-left:6px;font-size:11px;color:#2e7d32;");
    hint.textContent = "已复制";
    root.appendChild(hint);
    setTimeout(() => {
      hint.remove?.();
    }, 1500);
  } catch {
    /* 提示失败不影响复制主流程 */
  }
}

/**
 * 弹窗内小按钮工厂: 统一样式, 并在 pointerup 上阻断冒泡 —
 * 按钮上的点按一旦冒泡到 document, Zotero 会立刻关掉选区弹窗。
 */
function createPopupButton(
  row: PopupRow,
  label: string,
  onClick: () => void,
): any {
  const button = row.doc.createElement("button");
  button.setAttribute(
    "style",
    "margin-top:6px;font-size:12px;padding:2px 10px;cursor:pointer;",
  );
  button.textContent = label;
  button.addEventListener("pointerup", (ev: any) => {
    ev.stopPropagation();
  });
  button.addEventListener("click", () => {
    onClick();
  });
  return button;
}

/**
 * 拼接按钮行(只在弹窗内, 不动侧栏): ＋拼接 / 翻译拼接 / 清空 + 缓冲状态。
 * - ＋拼接: 把当前选区并入缓冲, textarea 显示累计内容, 不翻译;
 * - 翻译拼接: 缓冲非空才出现, concatTake 取走整段交给 run 翻译;
 * - 清空: 缓冲非空才出现, 丢弃缓冲回到普通划词模式。
 * 每次状态变化整行重建, 保证按钮集与段数提示始终与缓冲一致。
 */
function renderConcatRow(
  row: PopupRow,
  selectionText: string,
  run: (payload: string) => Promise<void>,
): void {
  try {
    row.concatRow?.remove?.();
    const state = getConcatState();
    const bar = row.doc.createElement("div");
    bar.setAttribute(
      "style",
      "margin-top:2px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;",
    );
    bar.appendChild(
      createPopupButton(row, "＋拼接", () => {
        concatAppend(selectionText);
        const next = getConcatState();
        row.textarea.value = next.text;
        setConcatPlaceholder(row, next.count);
        renderConcatRow(row, selectionText, run);
      }),
    );
    if (state.count > 0) {
      bar.appendChild(
        createPopupButton(row, "翻译拼接", () => {
          // 先 take 后 run: run 已无互斥分支, 不会再出现"取走缓冲却被拒"的丢失
          // (旧请求继续在后台走完, 其回调被代际校验作废)
          const payload = concatTake();
          row.textarea.value = "";
          restorePlaceholder(row);
          renderConcatRow(row, selectionText, run);
          void run(payload);
        }),
      );
      bar.appendChild(
        createPopupButton(row, "清空", () => {
          concatClear();
          row.textarea.value = "";
          restorePlaceholder(row);
          renderConcatRow(row, selectionText, run);
        }),
      );
    }
    const status = row.doc.createElement("span");
    status.setAttribute("style", "margin-top:6px;font-size:11px;opacity:0.72;");
    status.textContent =
      state.count > 0 ? `已拼接 ${state.count} 段` : "把选中文本并入拼接缓冲";
    bar.appendChild(status);
    row.concatRow = bar;
    row.root.appendChild(bar);
  } catch {
    /* 弹窗已关闭, 放弃拼接入口 */
  }
}

/** 失败重试按钮: 追加前先移除旧按钮防堆积; 点击后清空译文并原样重跑 translateText */
function showRetryButton(row: PopupRow, onRetry: () => void): void {
  try {
    row.retryButton?.remove?.();
    const button = createPopupButton(row, "重试", () => {
      button.remove?.();
      row.retryButton = null;
      row.textarea.value = "";
      onRetry();
    });
    row.retryButton = button;
    row.root.appendChild(button);
  } catch {
    /* 弹窗已关闭, 放弃重试入口 */
  }
}

/** 手动翻译按钮: settings.autoTranslate=false 时随弹窗出现, 点击后移除自身并开始翻译 */
function showTranslateButton(row: PopupRow, onStart: () => void): void {
  try {
    const button = createPopupButton(row, "翻译", () => {
      button.remove?.();
      onStart();
    });
    row.root.appendChild(button);
  } catch {
    /* 弹窗已关闭, 放弃手动翻译入口 */
  }
}

/**
 * 停止按钮(st-stop): 仅翻译进行中显示, 点击中止当前代际在途请求。
 * 追加前先移除旧按钮防堆积(新一轮 run 的旧按钮由调用方按句柄让位)。
 * 返回按钮元素供 run 持有, 兼作"本 run 仍是最新代际"的判据。
 */
function showStopButton(row: PopupRow, onCancel: () => void): any {
  try {
    row.stopButton?.remove?.();
    const button = createPopupButton(row, "停止", onCancel);
    button.className = "st-stop";
    row.stopButton = button;
    row.root.appendChild(button);
    return button;
  } catch {
    /* 弹窗已关闭, 放弃停止入口 */
    return null;
  }
}

/**
 * 取消后的中性提示("已取消", 不带错误样式): 1.5 秒后自动移除,
 * textarea 不动 — 已流出的部分译文原样保留供复制。
 */
function showCancelledHint(row: PopupRow): void {
  try {
    row.root?.querySelector?.(".st-cancelled-hint")?.remove?.();
    const hint = row.doc.createElement("span");
    hint.className = "st-cancelled-hint";
    hint.setAttribute(
      "style",
      "margin-top:6px;font-size:11px;color:#555;opacity:0.9;",
    );
    hint.textContent = CANCELLED_MESSAGE;
    row.root.appendChild(hint);
    setTimeout(() => {
      hint.remove?.();
    }, 1500);
  } catch {
    /* 弹窗已关闭, 放弃取消提示 */
  }
}

/** "打开设置"小按钮(st-openprefs): NoKeyError 时挂在错误文案旁, 引导去配置密钥 */
function showOpenPrefsButton(row: PopupRow): void {
  try {
    // 同类按钮防堆积(理论上一次失败只挂一个, 保守去重)
    row.root?.querySelector?.(".st-openprefs")?.remove?.();
    const button = createPopupButton(row, "打开设置", () => {
      openPluginPrefs();
    });
    button.className = "st-openprefs";
    row.root.appendChild(button);
  } catch {
    /* 弹窗已关闭, 放弃设置入口 */
  }
}

function updatePopupRow(row: PopupRow | null, text: string, done: boolean): void {
  try {
    if (!row?.textarea) return;
    row.textarea.value = text;
    // 流式更新保持滚动在底部, 最新译文始终可见
    row.textarea.scrollTop = row.textarea.scrollHeight;
    row.root?.setAttribute?.("data-done", done ? "1" : "0");
  } catch {
    /* popup already closed; row is out of scope */
  }
}

/**
 * reader.itemID -> 附件条目 -> 父条目: 与 fulltext.getReadingText 的归一语义一致,
 * 附件条目向上取 parentID, 普通条目直接用。
 */
function resolveReaderParentItem(Zotero: any, reader: any): any {
  const attachmentID = reader?.itemID;
  if (!attachmentID) return null;
  const attachment = Zotero?.Items?.get?.(attachmentID);
  if (!attachment) return null;
  if (
    typeof attachment.isRegularItem === "function" &&
    attachment.isRegularItem()
  ) {
    return attachment;
  }
  const parentID = attachment.parentID;
  return parentID ? (Zotero.Items?.get?.(parentID) ?? null) : null;
}

/**
 * 弹窗翻译成功后按 settings.writebackMode 写入该文献的收集笔记:
 * - off: 不写;
 * - note: 追加译文条目;
 * - note-bilingual: 追加原文 + 译文对照条目。
 * 任何失败只记录(console + Zotero.debug), 绝不打断弹窗翻译主流程。
 */
async function writeTranslationToCollectNote(
  Zotero: any,
  reader: any,
  original: string,
  translation: string,
): Promise<void> {
  try {
    const mode = getSettings().writebackMode;
    if (mode === "off" || !translation.trim()) return;
    const parentItem = resolveReaderParentItem(Zotero, reader);
    if (!parentItem) {
      Zotero?.debug?.("[SmartTranslate] 写回收集跳过: 未解析到文献父条目");
      return;
    }
    const entry = buildCollectEntry(
      original,
      translation,
      mode === "note-bilingual",
    );
    const note = await appendToCollectNote(Zotero, parentItem, entry);
    if (!note) {
      Zotero?.debug?.(
        "[SmartTranslate] 写回收集未完成: 收集笔记枚举或写入失败",
      );
    }
  } catch (e) {
    try {
      Zotero?.logError?.(e);
    } catch {
      /* 日志通道本身失败: 忽略, 不影响翻译结果 */
    }
  }
}
