/**
 * 主窗口右下角浮动结果面板 — 菜单/快捷键翻译结果的可见出口。
 * 取代旧的 console 打印(用户不可见)与阻塞式系统弹窗(不可复制)两条展示路径。
 * P0 采用内联浅色样式, 深色模式适配属 P1 范围。
 */

import { copyText } from "./reader";

/** 面板固定样式: 右下角 fixed + 浅色卡片(样式按契约内联, 不引外部 css) */
const PANEL_STYLE =
  "position:fixed;right:24px;bottom:24px;z-index:9999;max-width:440px;" +
  "background:#fff;color:#333;border:1px solid #ccc;border-radius:6px;" +
  "box-shadow:0 2px 12px rgba(0,0,0,.18);padding:10px;box-sizing:border-box;";

const SMALL_BUTTON_STYLE =
  "font-size:12px;padding:2px 10px;cursor:pointer;margin-left:6px;";

/**
 * 在主窗口右下角弹出结果面板。
 * - isError: 标题标红, 用于翻译失败路径(替代 Zotero.alert)。
 * - 面板内 pointerdown/keydown stopPropagation, 防止输入/按键冒泡触发主窗口快捷键;
 *   点击面板外(window 捕获阶段)或点关闭即移除面板并清理监听。
 */
export function showResultPanel(
  Zotero: any,
  title: string,
  text: string,
  isError = false,
): void {
  try {
    const win = Zotero?.getMainWindow?.();
    const doc = win?.document;
    const body = doc?.body;
    if (!win || !doc || !body) return;

    // 重复触发先移除旧面板, 防叠加
    doc.querySelector?.(".smarttranslate-result-panel")?.remove?.();

    const panel = doc.createElement("div");
    panel.className = "smarttranslate-result-panel";
    panel.setAttribute("style", PANEL_STYLE);

    // 标题行: 标题 + 右上角 x 关闭; 失败时标题标红
    const head = doc.createElement("div");
    head.setAttribute(
      "style",
      "display:flex;align-items:center;margin-bottom:6px;",
    );
    const titleEl = doc.createElement("span");
    titleEl.setAttribute(
      "style",
      `flex:1;font-size:13px;font-weight:bold;${isError ? "color:#c62828;" : ""}`,
    );
    titleEl.textContent = title;
    head.appendChild(titleEl);
    const closeCross = doc.createElement("button");
    closeCross.setAttribute(
      "style",
      "border:none;background:none;font-size:14px;cursor:pointer;color:#666;padding:0 4px;",
    );
    closeCross.textContent = "×";
    head.appendChild(closeCross);
    panel.appendChild(head);

    // 译文区: readonly textarea, 可选择可复制可拖拽调大小
    const textarea = doc.createElement("textarea");
    textarea.setAttribute("readonly", "readonly");
    textarea.setAttribute(
      "style",
      "width:100%;height:110px;resize:both;font-size:12px;line-height:1.5;box-sizing:border-box;",
    );
    textarea.value = text;
    panel.appendChild(textarea);

    // 按钮行: 复制(点击后文字变"已复制"1.5s) + 关闭
    const actions = doc.createElement("div");
    actions.setAttribute("style", "margin-top:6px;text-align:right;");
    const copyBtn = doc.createElement("button");
    copyBtn.setAttribute("style", SMALL_BUTTON_STYLE);
    copyBtn.textContent = "复制";
    copyBtn.addEventListener("click", () => {
      copyText(Zotero, doc, textarea, textarea.value);
      copyBtn.textContent = "已复制";
      setTimeout(() => {
        copyBtn.textContent = "复制";
      }, 1500);
    });
    actions.appendChild(copyBtn);
    const closeBtn = doc.createElement("button");
    closeBtn.setAttribute("style", SMALL_BUTTON_STYLE);
    closeBtn.textContent = "关闭";
    actions.appendChild(closeBtn);
    panel.appendChild(actions);

    // 面板内按下/按键不冒泡, 防止触发主窗口快捷键(如 Ctrl+Shift+T)或误关弹窗
    const swallow = (ev: any): void => {
      ev.stopPropagation();
    };
    panel.addEventListener("pointerdown", swallow);
    panel.addEventListener("keydown", swallow);

    // 关闭 = 移除面板 + 清理 window 上的外部点击监听
    let outsideClick: ((ev: any) => void) | null = null;
    const close = (): void => {
      try {
        if (outsideClick) {
          win.removeEventListener("click", outsideClick, true);
          outsideClick = null;
        }
        panel.remove?.();
      } catch {
        /* 窗口已销毁, 无需清理 */
      }
    };
    closeCross.addEventListener("click", close);
    closeBtn.addEventListener("click", close);

    // 点面板外即关闭: window 捕获阶段统一接住, 点在面板内则放过
    outsideClick = (ev: any): void => {
      try {
        if (!panel.contains?.(ev.target)) close();
      } catch {
        close();
      }
    };
    // 网络等待后面板才出现, 触发翻译的那次 click 早已结束, 可直接挂载
    win.addEventListener?.("click", outsideClick, true);

    body.appendChild(panel);
    textarea.focus?.();
  } catch {
    /* 主窗口不可用等极端场景, 静默放弃展示 */
  }
}
