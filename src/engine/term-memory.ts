/**
 * Term memory helper — one-click add to glossary.
 */

import { GlossaryManager } from "./glossary";
import { getSettings } from "./settings";

let glossary: GlossaryManager | null = null;

export function ensureGlossary(): GlossaryManager {
  if (!glossary) {
    glossary = new GlossaryManager();
    const settings = getSettings();
    if (settings?.targetLanguage) {
      // future: load persisted terms from prefs
    }
  }
  return glossary;
}

export function rememberTerm(english: string, chinese: string): void {
  const manager = ensureGlossary();
  manager.add({ en: english.trim(), zh: chinese.trim(), domain: "user" });
}

export function searchGlossary(term: string): string | undefined {
  const manager = ensureGlossary();
  const hit = manager.match(term);
  return hit ?? undefined;
}
