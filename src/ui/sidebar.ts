/**
 * Bilingual sidebar panel for Zotero reader.
 * Adds a side panel toggle that shows source/translation pairs.
 */

import { translateText } from "../data";
import { getSettings } from "../engine/settings";

let panel: any = null;
let visible = false;

export function toggleSidebar(reader: any): void {
  if (!reader) return;
  visible = !visible;
  if (visible) {
    ensurePanel(reader);
    renderSidebar(reader);
  } else {
    removePanel(reader);
  }
}

function ensurePanel(reader: any): void {
  if (panel) return;
  const doc = reader?.document ?? reader?._internalReader?._lastView?.document;
  if (!doc?.createElement) return;
  panel = doc.createElement("div");
  panel.className = "smarttranslate-bilingual-panel";
  panel.style.cssText =
    "position:absolute;right:8px;top:8px;width:260px;max-height:80vh;overflow:auto;background:#fff;border:1px solid #ccc;padding:8px;font-size:12px;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.15);";
}

function removePanel(reader: any): void {
  try {
    panel?.remove?.();
  } catch {
    /* ignore */
  }
  panel = null;
}

async function renderSidebar(reader: any): Promise<void> {
  if (!panel) return;
  const settings = getSettings();
  panel.textContent = `SmartTranslate · ${settings.targetLanguage}`;
  try {
    const text = getReaderText(reader);
    const translation = await translateText(text.slice(0, 6000));
    panel.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px;">双语对照</div>
      <div style="color:#555;">${escapeHtml(text.slice(0, 1800))}</div>
      <hr/>
      <div style="color:#000;">${escapeHtml(translation.slice(0, 1800))}</div>
    `;
  } catch (e) {
    panel.textContent = `翻译失败：${(e as Error).message}`;
  }
}

function getReaderText(reader: any): string {
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}
