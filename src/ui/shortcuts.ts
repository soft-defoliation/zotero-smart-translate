/**
 * Keyboard shortcut and menu integration for sidebar/batch/read tools.
 */

import { toggleSidebar } from "./sidebar";
import { translateTitleAbstract } from "./menus";

export function registerReaderShortcuts(Zotero: any, reader: any): void {
  if (!reader) return;
  try {
    reader.addEventListener("keydown", (ev: any) => {
      const key = (ev.key ?? "").toUpperCase();
      if (ev.altKey && key === "B") {
        ev.preventDefault();
        toggleSidebar(reader);
      }
    });
  } catch {
    /* ignore */
  }
}
