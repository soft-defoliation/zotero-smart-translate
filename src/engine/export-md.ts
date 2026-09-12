/**
 * Bilingual Markdown export — pure function, unit tested.
 */

export interface BilingualPair {
  source: string;
  translation: string;
  heading?: string;
}

export function toBilingualMarkdown(
  title: string,
  pairs: BilingualPair[],
  meta?: { engine?: string; date?: string },
): string {
  const lines: string[] = [
    `# ${title}`,
    "",
    `> SmartTranslate bilingual export${meta?.engine ? ` · ${meta.engine}` : ""}${meta?.date ? ` · ${meta.date}` : ""}`,
    "",
  ];
  for (const p of pairs) {
    if (p.heading) lines.push(`## ${p.heading}`, "");
    lines.push(p.source.trim(), "", `> ${p.translation.trim()}`, "");
  }
  return lines.join("\n");
}
