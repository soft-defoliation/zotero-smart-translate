/**
 * SmartTranslate 侧栏自定义元素 smarttranslate-panel。
 *
 * 本文件只定义与导出元素类, customElements.define 在 custom-elements.ts
 * (panel bundle 入口)执行 — 若 define 写在本文件模块顶层, 未来任何一处
 * 主 bundle 的误 import 都会在 bootstrap 沙箱里执行 define 而抛错
 * (沙箱没有 customElements); 拆开后主 bundle 物理上碰不到 define。
 *
 * [双 bundle 模块双实例] 本模块随 panel bundle 在主窗口作用域运行
 * (loadSubScript 注入), 其 translate-store/settings/data 都是独立于主
 * bundle 的模块实例:
 * - store: 经 getSharedStore() 代理到 Zotero.SmartTranslate.store 共享桥,
 *   划词弹窗(主 bundle)写的译文这里读得到(决策见 engine/translate-store.ts 头注释)
 * - settings: 无共享桥, 每次 render/翻译/写比例前 bindPrefs 重读一次
 *   (bindPrefs 幂等, 代价一次 JSON 读), 与设置页写入最终一致(v1 取舍)
 *
 * DOM/CSS/交互规格: .fleet/design/20260909-sidebar-design.md
 * (无 shadow root, 元素内一个 <style> 块, 所有选择器带 smarttranslate-panel
 * 前缀防污染主窗口; 控件不设 border/background/color, 走原生主题)
 */

import {
  getSharedStore,
  refreshAllPanels,
} from "../../engine/translate-store";
import type {
  TranslateRecord,
  TranslateStatus,
} from "../../engine/translate-store";
import {
  bindPrefs,
  getActiveEngine,
  getSettings,
  resolveFontFamily,
  setActiveEngine,
  setPanelSplitRatio,
  PANEL_SPLIT_RATIO_MIN,
  PANEL_SPLIT_RATIO_MAX,
} from "../../engine/settings";
import { translateText } from "../../data";
import { copyText } from "../reader";
import {
  CANCELLED_MESSAGE,
  NO_KEY_MESSAGE,
  zhErrorMessage,
} from "../../engine/errors";
import { canOpenPrefs, openPluginPrefs } from "../prefs";
import type { Settings } from "../../types";

/** 双框各自最小高度(px): 分隔比例 clamp 与 CSS min-height 双保险 */
const MIN_PANE_HEIGHT = 56;
/** 双击/Home 复位的默认比例 */
const DEFAULT_SPLIT_RATIO = 0.5;
/** 键盘微调步长(设计稿: ↑↓ ±0.05) */
const SPLIT_STEP = 0.05;

/** 状态行时间戳 → HH:MM(24 小时补零) */
function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * 元素内静态模板: 结构与 <style> 一次成型(纯静态串, 无注入面)。
 * 注意: 本串由 MozXULElement.parseXULToFragment 按 application/xml 严格解析,
 * 必须满足 XML 语法 — 每个元素带 html: 前缀(否则落入 XUL 命名空间而无控件行为),
 * 布尔属性必须写全值(hidden="hidden"), 且不允许出现裸 < 与 &。
 * Token 对照设计稿: padding-x 8 / padding-top 6 / row-gap 6 / 控件高 24 /
 * 双框高 240 / 单框最小 56 / 热区 9px / 线 1px .18 / 把手 24×3 r1.5
 * (.35/.6/.75 阶梯)/ 状态字号 11px / 复制按钮 1px 6px / 按钮间距 4px /
 * 脉冲 1s。
 */
const PANEL_TEMPLATE = `
<html:style>
  smarttranslate-panel { display: block; min-width: 0; }
  smarttranslate-panel .st-panel-root {
    display: flex; flex-direction: column; gap: 6px;
    padding: 6px 8px 8px; height: 100%; box-sizing: border-box;
  }
  smarttranslate-panel .st-toolbar {
    display: flex; align-items: center; gap: 4px; height: 24px; flex: none;
  }
  smarttranslate-panel .st-engine { flex: 1; min-width: 0; height: 24px; font-size: 12px; }
  smarttranslate-panel .st-translate { flex: none; height: 24px; padding: 0 10px; font-size: 12px; }
  smarttranslate-panel .st-boxes {
    display: flex; flex-direction: column; flex: 1; min-height: 240px;
  }
  smarttranslate-panel .st-pane {
    display: flex; min-height: 56px; min-width: 0;
  }
  smarttranslate-panel .st-area {
    flex: 1; min-width: 0; box-sizing: border-box; resize: none;
    padding: 4px 6px; font-size: 12px;
  }
  smarttranslate-panel .st-splitter {
    position: relative; flex: none; height: 9px;
    cursor: row-resize; touch-action: none; outline: none;
  }
  smarttranslate-panel .st-split-line {
    position: absolute; left: 0; right: 0; top: 4px; height: 1px;
    background: currentColor; opacity: 0.18;
  }
  smarttranslate-panel .st-split-grip {
    position: absolute; left: 50%; top: 3px; width: 24px; height: 3px;
    margin-left: -12px; border-radius: 1.5px;
    background: currentColor; opacity: 0.35;
  }
  smarttranslate-panel .st-splitter:hover .st-split-grip { opacity: 0.6; }
  smarttranslate-panel .st-splitter.st-dragging .st-split-grip { opacity: 0.75; }
  smarttranslate-panel .st-statusbar {
    display: flex; align-items: center; gap: 4px; height: 24px; flex: none; min-width: 0;
  }
  smarttranslate-panel .st-status {
    display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0;
    overflow: hidden; opacity: 0.72; font-size: 11px;
  }
  smarttranslate-panel .st-status-text {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  smarttranslate-panel .st-status-dot {
    flex: none; width: 6px; height: 6px; border-radius: 50%;
    background: currentColor;
    animation: st-pulse 1s ease-in-out infinite;
  }
  smarttranslate-panel .st-status-dot[hidden] { display: none; }
  smarttranslate-panel .st-actions {
    display: flex; align-items: center; gap: 4px; flex: none;
  }
  smarttranslate-panel .st-copy { font-size: 11px; padding: 1px 6px; }
  @keyframes st-pulse {
    0%, 100% { opacity: 0.25; }
    50% { opacity: 0.8; }
  }
</html:style>
<html:div class="st-panel-root">
  <html:div class="st-toolbar">
    <html:select class="st-engine" aria-label="翻译引擎"></html:select>
    <html:button class="st-translate" type="button">翻译</html:button>
  </html:div>
  <html:div class="st-boxes">
    <html:div class="st-pane">
      <html:textarea class="st-area st-area-src" spellcheck="false" aria-label="原文"></html:textarea>
    </html:div>
    <html:div class="st-splitter" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="拖拽调整双栏比例, 双击复位"></html:div>
    <html:div class="st-pane">
      <html:textarea class="st-area st-area-dst" spellcheck="false" aria-label="译文"></html:textarea>
    </html:div>
  </html:div>
  <html:div class="st-statusbar">
    <html:div class="st-status">
      <html:span class="st-status-dot" hidden="hidden"></html:span>
      <html:span class="st-status-text"></html:span>
    </html:div>
    <html:div class="st-actions">
      <html:button class="st-copy" type="button" data-copy="src">复制原文</html:button>
      <html:button class="st-copy" type="button" data-copy="dst">复制译文</html:button>
      <html:button class="st-copy" type="button" data-copy="both">复制全部</html:button>
    </html:div>
  </html:div>
</html:div>
`;

/** 元素内部引用集合(collectElements 一次收集) */
interface PanelElements {
  engine: HTMLSelectElement;
  translate: HTMLButtonElement;
  boxes: HTMLElement;
  srcPane: HTMLElement;
  dstPane: HTMLElement;
  src: HTMLTextAreaElement;
  dst: HTMLTextAreaElement;
  splitter: HTMLElement;
  status: HTMLElement;
  statusText: HTMLElement;
  dot: HTMLElement;
  actions: HTMLElement;
  copyButtons: HTMLButtonElement[];
}

// XUL 命名空间的自定义元素必须继承窗口全局的 XULElementBase(Zotero 官方模式,
// 见 elements/base.js; 继承 HTMLElement 会导致升级静默失败、面板空白);
// 非 Zotero 环境(单测)回落到 HTMLElement 保证模块可加载。
// 静态类型按 typeof HTMLElement 收窄(运行期表达式不变): 实例类型保持
// HTMLElement, customElements.define 的构造器约束与 this 上的泛型查询才过 tsc
const PanelElementBase: typeof HTMLElement =
  (globalThis as any).XULElementBase ??
  (globalThis as any).HTMLElement;

export class SmartTranslatePanel extends PanelElementBase {
  private els: PanelElements | null = null;
  /** 拖拽进行中: 期间 render 不回写比例, pointerup 才持久化 */
  private dragging = false;
  /** 当前比例(实时), 拖拽结束/键盘/双击调整时持久化 */
  private currentRatio = DEFAULT_SPLIT_RATIO;
  /** 复制反馈定时器句柄(主窗口 window.setTimeout, number 型) */
  private copyTimer: number | null = null;

  /**
   * 内容模板交给 Zotero 的 XUL 片段解析器: 主窗口是 XML 文档, 元素必须带
   * html: 前缀才会成为可用的 HTML 控件(XUL 命名空间的 textarea/select 无控件行为),
   * 且 XML 下布尔属性必须带值(hidden="hidden")否则解析抛错
   */
  get content(): DocumentFragment | null {
    const moz = (globalThis as any).MozXULElement;
    if (!moz?.parseXULToFragment) return null;
    try {
      return moz.parseXULToFragment(PANEL_TEMPLATE);
    } catch (e) {
      (globalThis as any).Zotero?.logError?.(e);
      return null;
    }
  }

  /**
   * 基类 connectedCallback 插入 content 后调用(见 XULElementBase):
   * 收集元素引用 → 接线 → 重读设置 → 渲染。
   */
  init(): void {
    this.collectElements();
    if (this.els) {
      this.wireEvents();
      this.syncSettings();
      this.render();
    }
  }

  /** 基类 disconnectedCallback 调用(随后清空子节点): 释放引用与定时器 */
  destroy(): void {
    this.els = null;
    if (this.copyTimer !== null) {
      clearTimeout(this.copyTimer);
      this.copyTimer = null;
    }
    this.dragging = false;
  }

  /**
   * 从共享 store + 最新设置刷新整个界面。
   * Zotero onRender 与本元素翻译流程都会调用, 必须幂等。
   */
  render(): void {
    const els = this.els;
    if (!els) return;
    // panel bundle 的 settings 是独立实例: 渲染前重读一次与设置页保持一致
    this.syncSettings();
    const settings = getSettings();
    const record = getSharedStore().getRecord();
    this.rebuildEngineOptions(settings);
    this.applyFontSettings(settings);
    // 原文/译文回写: 聚焦中的框不覆盖, 避免冲掉用户正在编辑的内容
    if (this.ownerDocument.activeElement !== els.src) {
      els.src.value = record.raw;
    }
    if (this.ownerDocument.activeElement !== els.dst) {
      els.dst.value = record.result;
    }
    // 拖拽进行中不回写比例, 防高频 render 拉回旧值
    if (!this.dragging) {
      this.applySplitRatio(settings.panelSplitRatio, false);
    }
    this.renderStatus(record);
    this.updateControlStates();
  }

  /**
   * 收集内容模板里的元素引用(content 已由基类插入, 本方法不再建 DOM);
   * 根节点缺失(模板解析失败)时置空引用, 后续交互全部静默跳过。
   */
  private collectElements(): void {
    const root = this.querySelector(".st-panel-root");
    if (!root) {
      this.els = null;
      return;
    }
    const q = <T extends Element>(sel: string): T =>
      this.querySelector(sel) as T;
    this.els = {
      engine: q<HTMLSelectElement>(".st-engine"),
      translate: q<HTMLButtonElement>(".st-translate"),
      boxes: q<HTMLElement>(".st-boxes"),
      srcPane: q<HTMLElement>(".st-boxes .st-pane:first-child"),
      dstPane: q<HTMLElement>(".st-boxes .st-pane:last-child"),
      src: q<HTMLTextAreaElement>(".st-area-src"),
      dst: q<HTMLTextAreaElement>(".st-area-dst"),
      splitter: q<HTMLElement>(".st-splitter"),
      status: q<HTMLElement>(".st-status"),
      statusText: q<HTMLElement>(".st-status-text"),
      dot: q<HTMLElement>(".st-status-dot"),
      actions: q<HTMLElement>(".st-actions"),
      copyButtons: Array.from(
        this.querySelectorAll<HTMLButtonElement>(".st-copy"),
      ),
    };
  }

  private wireEvents(): void {
    const els = this.els;
    if (!els) return;

    // 引擎切换: 原文非空即重译(切换即新代际接管, 不因上一路流式未结束而搁置)
    els.engine.addEventListener("change", () => {
      this.syncSettings();
      setActiveEngine(els.engine.value);
      const raw = els.src.value.trim();
      if (raw) {
        void this.runTranslation(raw);
      }
    });

    // 翻译按钮: idle/done/error 翻译(文案在 renderStatus 里联动);
    // running 时同一按钮变"停止", 点击中止当前代际的在途请求
    els.translate.addEventListener("click", () => {
      if (getSharedStore().getRecord().status === "running") {
        getSharedStore().cancelCurrent();
        return;
      }
      void this.runTranslation(els.src.value);
    });

    // 原文/译文输入: 只更新本地与按钮态, 不自动翻译
    // (与划词自动翻译开关职责分离)
    for (const area of [els.src, els.dst]) {
      area.addEventListener("input", () => this.updateControlStates());
    }

    this.wireSplitter(els);

    // 复制 x3: 事件委托, 按钮内无子元素, closest 恒命中自身
    els.actions.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement | null;
      const btn = target?.closest?.(".st-copy") as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;
      this.onCopy(btn.dataset.copy ?? "");
    });
  }

  /** 分隔条: pointer 拖拽/双击复位/键盘微调(设计稿交互规格) */
  private wireSplitter(els: PanelElements): void {
    const splitter = els.splitter;

    splitter.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      this.dragging = true;
      splitter.classList.add("st-dragging");
      // capture 后 pointermove/up 都派发到 splitter, 拖出热区也不丢
      try {
        splitter.setPointerCapture((ev as PointerEvent).pointerId);
      } catch {
        /* 无 capture 能力时仅在热区内跟随 */
      }
    });

    splitter.addEventListener("pointermove", (ev) => {
      if (!this.dragging) return;
      const rect = els.boxes.getBoundingClientRect();
      if (rect.height <= 0) return;
      this.applySplitRatio(
        ((ev as PointerEvent).clientY - rect.top) / rect.height,
        false,
      );
    });

    const endDrag = (): void => {
      if (!this.dragging) return;
      this.dragging = false;
      splitter.classList.remove("st-dragging");
      // 拖拽结束才持久化, pointermove 高频路径不写 pref
      this.syncSettings();
      setPanelSplitRatio(this.currentRatio);
    };
    splitter.addEventListener("pointerup", endDrag);
    splitter.addEventListener("lostpointercapture", endDrag);

    splitter.addEventListener("dblclick", () => {
      this.applySplitRatio(DEFAULT_SPLIT_RATIO, true);
    });

    splitter.addEventListener("keydown", (ev) => {
      const key = (ev as KeyboardEvent).key;
      if (key === "ArrowUp" || key === "ArrowDown") {
        ev.preventDefault();
        // ↑ 上移分隔条 → 原文框(上方)变矮 → r 减小
        const next =
          this.currentRatio + (key === "ArrowUp" ? -SPLIT_STEP : SPLIT_STEP);
        this.applySplitRatio(next, true);
      } else if (key === "Home") {
        ev.preventDefault();
        this.applySplitRatio(DEFAULT_SPLIT_RATIO, true);
      }
    });
  }

  /**
   * 应用双栏比例: 写两 pane 的 flex-grow。
   * persist=true 时同步持久化 settings.panelSplitRatio(先 clamp 0.2-0.8)。
   */
  private applySplitRatio(ratio: number, persist: boolean): void {
    const els = this.els;
    if (!els) return;
    let r = Math.min(
      PANEL_SPLIT_RATIO_MAX,
      Math.max(PANEL_SPLIT_RATIO_MIN, ratio),
    );
    const boxesHeight = els.boxes.getBoundingClientRect().height;
    if (boxesHeight >= MIN_PANE_HEIGHT * 2) {
      // 每框至少 56px: 与 [0.2, 0.8] 取交集
      const minR = MIN_PANE_HEIGHT / boxesHeight;
      r = Math.min(Math.max(r, minR), 1 - minR);
    } else {
      // 极端矮容器装不下两框时退回对半, 高度交给 CSS min-height 兜底
      r = DEFAULT_SPLIT_RATIO;
    }
    this.currentRatio = r;
    els.srcPane.style.flexGrow = String(r);
    els.dstPane.style.flexGrow = String(1 - r);
    if (persist) {
      this.syncSettings();
      setPanelSplitRatio(r);
    }
  }

  /**
   * 翻译统一入口: 置 running(取新代际令牌) → translateText(raw, onProgress) →
   * done/error 更新 store → render。不做互斥: 多路翻译允许并存, 新 begin 使
   * 旧代际的全部回调作废并真实中止旧请求, 界面永远跟随最近一次翻译。
   */
  private async runTranslation(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text) return;
    const store = getSharedStore();
    // 翻译前重读设置: 引擎/语言对取 panel bundle settings 实例的最新值
    this.syncSettings();
    const engine = getActiveEngine();
    const gen = store.begin(text, engine?.id ?? "", engine?.name ?? "");
    // begin 建好本代际控制器后取走 signal: "停止"按钮经 cancelCurrent
    // abort 它, 在途 fetch 以 AbortError 拒绝并被 data 层转为取消
    const signal = store.getSignal();
    this.render();
    try {
      const result = await translateText(
        text,
        (partial) => {
          store.setPartial(gen, partial);
          this.render();
        },
        {
          // 故障转移: 覆盖 begin 时占位的引擎名, renderStatus 据此加后缀
          onEngineResolved: (engineId, engineName, failover) => {
            store.resolveEngine(gen, engineId, engineName, failover);
            this.render();
          },
          signal,
        },
      );
      store.finish(gen, result);
    } catch (e) {
      store.fail(gen, zhErrorMessage(e));
    }
    this.render();
    // 其他已打开的侧栏实例(其他 reader 标签页)一并刷新
    void refreshAllPanels();
  }

  /** 复制原文/译文/全部(both 格式与 T4Z 一致: 原文\n----\n译文) */
  private onCopy(kind: string): void {
    const els = this.els;
    if (!els) return;
    const raw = els.src.value;
    const result = els.dst.value;
    const text =
      kind === "src" ? raw : kind === "dst" ? result : `${raw}\n----\n${result}`;
    if (!text) return;
    const zotero = (globalThis as any).Zotero;
    copyText(zotero, this.ownerDocument, els.dst, text);
    const label = kind === "src" ? "原文" : kind === "dst" ? "译文" : "全部";
    this.flashStatus(`已复制${label} ✓`);
  }

  /** 状态区复制反馈: 1.5 秒后 render 恢复正常状态文案 */
  private flashStatus(message: string): void {
    const els = this.els;
    if (!els) return;
    if (this.copyTimer !== null) clearTimeout(this.copyTimer);
    els.statusText.textContent = message;
    this.copyTimer = window.setTimeout(() => {
      this.copyTimer = null;
      this.render();
    }, 1500);
  }

  /** 状态行 + 翻译按钮文案联动(设计稿状态表) */
  private renderStatus(record: TranslateRecord): void {
    const els = this.els;
    if (!els) return;
    const time = formatTime(record.updatedAt);
    // "打开设置"入口随错误态增减(仅未配置密钥错误时出现)
    this.syncOpenPrefsButton(record);
    switch (record.status) {
      case "running":
        els.dot.hidden = false;
        els.statusText.textContent = "正在翻译…";
        els.status.removeAttribute("title");
        break;
      case "done":
        els.dot.hidden = true;
        els.statusText.textContent = record.fromSelection
          ? `已同步划词翻译 · ${time}`
          : // 故障转移产出的结果补后缀, 让用户知道是备用引擎救的场
            `已完成 · ${record.engineName || record.engineId}${record.failover ? "（故障转移）" : ""} · ${time}`;
        els.status.removeAttribute("title");
        break;
      case "error":
        els.dot.hidden = true;
        if (record.errorMessage === CANCELLED_MESSAGE) {
          // 用户主动取消: 中性文案呈现, 不按错误样式渲染(无 ⚠ 与悬停 title)
          els.statusText.textContent = `${CANCELLED_MESSAGE} · ${time}`;
          els.status.removeAttribute("title");
        } else {
          els.statusText.textContent = `⚠ 翻译失败: ${record.errorMessage}`;
          // 完整错误放悬停 title, 状态行只显示一句话
          els.status.setAttribute("title", record.errorMessage);
        }
        break;
      default:
        els.dot.hidden = true;
        els.statusText.textContent = "划词或输入原文开始翻译";
        els.status.removeAttribute("title");
        break;
    }
    // running 时同一按钮变"停止"(点击经 cancelCurrent 中止在途请求)
    els.translate.textContent =
      record.status === "running"
        ? "停止"
        : record.status === "error"
          ? "重试"
          : "翻译";
  }

  /**
   * "打开设置"小按钮(st-openprefs): 仅未配置密钥错误时挂在状态行错误文案旁。
   * store 只透传字符串, 以 NoKeyError 的固定文案(NO_KEY_MESSAGE)识别;
   * openPreferences API 缺失或 pane 未注册时(canOpenPrefs=false)不渲染。
   */
  private syncOpenPrefsButton(record: TranslateRecord): void {
    const els = this.els;
    if (!els) return;
    const existing = els.status.querySelector(".st-openprefs");
    const wanted =
      record.status === "error" &&
      record.errorMessage === NO_KEY_MESSAGE &&
      canOpenPrefs();
    if (wanted && !existing) {
      const button = this.ownerDocument.createElement("button");
      button.className = "st-openprefs";
      button.setAttribute("type", "button");
      button.textContent = "打开设置";
      // 控件不设 border/background/color, 走原生主题(与面板设计口径一致)
      button.setAttribute(
        "style",
        "font-size:11px;padding:1px 6px;cursor:pointer;flex:none;",
      );
      button.addEventListener("click", () => {
        openPluginPrefs();
      });
      els.status.appendChild(button);
    } else if (!wanted && existing) {
      existing.remove();
    }
  }

  /** 按钮 disabled 态: 翻译按 running+原文有无, 复制按对应内容有无 */
  private updateControlStates(): void {
    const els = this.els;
    if (!els) return;
    const status: TranslateStatus = getSharedStore().getRecord().status;
    const hasSrc = els.src.value.trim().length > 0;
    const hasDst = els.dst.value.trim().length > 0;
    // running 时按钮是"停止", 必须保持可点(取消入口); 其余状态维持原语义
    els.translate.disabled = status === "running" ? false : !hasSrc;
    const [srcBtn, dstBtn, bothBtn] = els.copyButtons;
    srcBtn.disabled = !hasSrc;
    dstBtn.disabled = !hasDst;
    bothBtn.disabled = !(hasSrc && hasDst);
  }

  /** 引擎下拉按最新设置重建(选项集合变化才重建, 防打断下拉交互) */
  private rebuildEngineOptions(settings: Settings): void {
    const els = this.els;
    if (!els) return;
    const engines = [settings.engine1, settings.engine2, settings.engine3];
    const signature = engines.map((e) => `${e.id}:${e.name}`).join("|");
    if (els.engine.dataset.sig !== signature) {
      els.engine.textContent = "";
      for (const engine of engines) {
        const option = this.ownerDocument.createElement("option");
        option.value = engine.id;
        option.textContent = engine.name || engine.id;
        els.engine.appendChild(option);
      }
      els.engine.dataset.sig = signature;
    }
    els.engine.value = settings.activeEngineId;
  }

  /** 字体三参数内联写入两框(设计稿: 字体不走 CSS, 由 JS 写入) */
  private applyFontSettings(settings: Settings): void {
    const els = this.els;
    if (!els) return;
    const family = resolveFontFamily(settings);
    for (const area of [els.src, els.dst]) {
      area.style.fontFamily = family;
      area.style.fontSize = `${settings.fontSize}px`;
      area.style.lineHeight = String(settings.lineHeight);
    }
  }

  /**
   * 重读偏好绑定: panel bundle 的 settings 单例靠它感知设置页改动;
   * bindPrefs 幂等且自带容错, Prefs 不可达时保持当前内存态。
   */
  private syncSettings(): void {
    try {
      const zotero = (globalThis as any).Zotero;
      if (zotero?.Prefs) bindPrefs(zotero.Prefs);
    } catch {
      /* 保持内存态 */
    }
  }
}
