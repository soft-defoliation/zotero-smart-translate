declare const Zotero: any;

/**
 * Zotero reading assistant prefs window.
 */

import { getSettings, setSettings } from "../engine/settings";

export function openReadingPrefs(): void {
  const win = Zotero.getMainWindows?.()?.[0];
  if (!win) return;
  const doc = win.document;
  const existing = doc.getElementById("smarttranslate-reading-prefs");
  if (existing) {
    existing.remove();
    return;
  }
  const panel = doc.createElement("div");
  panel.id = "smarttranslate-reading-prefs";
  panel.style.cssText =
    "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:360px;background:#fff;border:1px solid #ccc;padding:16px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.25);";
  panel.innerHTML = `
    <div style="font-weight:bold;margin-bottom:8px;">SmartTranslate 阅读助手设置</div>
    <label style="display:block;margin:8px 0;">最大 token 预算<input id="st-max-tokens" type="number" value="8000" style="width:120px;margin-left:8px;"></label>
    <button id="st-close" style="float:right;">关闭</button>
  `;
  doc.body.appendChild(panel);
  (panel.querySelector("#st-close") as any)?.addEventListener?.("click", () => panel.remove());
}
