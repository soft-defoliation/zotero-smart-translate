/**
 * 可更新进度行工厂 — Zotero ProgressWindow 的两种行 API 差异的兜底封装。
 *
 * 实证(Zotero 主干 chrome/content/zotero/progressWindow.js):
 * - addLines(text) 无返回值(L192-198 仅创建并 setProgress(100)), 拿到的是
 *   undefined, 再调 setText 就是用户报的 "can't access property setText,
 *   line is undefined";
 * - 需要后续 setText/setProgress 的行必须用 `new pw.ItemProgress(icon, text)`
 *   构造(L285, `if (itemType)` 守卫 → 空串即无图标)。
 *
 * 进度窗文档未加载完时构造可能返回半成品对象, 统一兜底为 null,
 * 调用方用 ?.setText?.() 保持静默降级(进度显示缺失但不阻断主流程)。
 */
export function createProgressLine(pw: any, text: string): any {
  try {
    const line = new pw.ItemProgress("", text);
    return typeof line?.setText === "function" ? line : null;
  } catch {
    return null;
  }
}
