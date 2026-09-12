/**
 * Reading assistant UI — toolbar dropdown + progress + cancel.
 * Pure DOM, no external framework.
 */

import { translateText } from "../data";

export type ReadingAction = "summary" | "innovation" | "method" | "note";

export function attachReadingToolbar(reader: any, onCancel?: () => void): void {
  if (!reader) return;
  try {
    const doc = reader.document ?? reader?._internalReader?._lastView?.document;
    if (!doc?.createElement) return;
    const existing = doc.getElementById("smarttranslate-reading-toolbar");
    if (existing) existing.remove();

    const bar = doc.createElement("div");
    bar.id = "smarttranslate-reading-toolbar";
    bar.style.cssText =
      "position:absolute;left:8px;top:8px;display:flex;gap:6px;z-index:9999;";

    const actions: Array<{ label: string; action: ReadingAction }> = [
      { label: "摘要", action: "summary" },
      { label: "创新点", action: "innovation" },
      { label: "方法", action: "method" },
      { label: "笔记", action: "note" },
    ];

    for (const item of actions) {
      const btn = doc.createElement("button");
      btn.textContent = item.label;
      btn.style.cssText =
        "padding:4px 8px;font-size:12px;background:#f5f5f5;border:1px solid #ccc;cursor:pointer;";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "处理中…";
        try {
          const text = await extractReaderText(reader);
          const result = await translateText(
            `[${item.action}] ${text.slice(0, 6000)}`,
          );
          appendLog(reader, `${item.label}：${result}`);
        } catch (e) {
          appendLog(reader, `${item.label}失败：${(e as Error).message}`);
        } finally {
          btn.disabled = false;
          btn.textContent = item.label;
        }
      });
      bar.appendChild(btn);
    }

    const cancel = doc.createElement("button");
    cancel.textContent = "取消";
    cancel.style.cssText =
      "padding:4px 8px;font-size:12px;background:#ffecec;border:1px solid #ccc;cursor:pointer;";
    cancel.addEventListener("click", () => {
      bar.remove();
      onCancel?.();
    });
    bar.appendChild(cancel);

    (reader as any)?.document?.body?.appendChild?.(bar) ??
      reader?._internalReader?._lastView?.document?.body?.appendChild?.(bar);
  } catch {
    /* ignore */
  }
}

function appendLog(reader: any, text: string): void {
  try {
    const doc = reader.document ?? reader?._internalReader?._lastView?.document;
    if (!doc?.createElement) return;
    const el = doc.createElement("div");
    el.style.cssText =
      "position:absolute;right:8px;bottom:8px;max-width:260px;background:#fff;border:1px solid #ccc;padding:6px;font-size:12px;z-index:9999;";
    el.textContent = text;
    doc.body.appendChild(el);
  } catch {
    /* ignore */
  }
}

async function extractReaderText(reader: any): Promise<string> {
  try {
    const view = reader?._internalReader?._lastView;
    return (
      view?.textContent?.trim?.() ??
      view?.innerText?.trim?.() ??
      ""
    );
  } catch {
    return "";
  }
}
