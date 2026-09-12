import type { GlossaryEntry } from "../types";

export class GlossaryManager {
  private entries: GlossaryEntry[] = [];

  add(entry: GlossaryEntry): void {
    this.entries.push(entry);
  }

  addMultiple(entries: GlossaryEntry[]): void {
    this.entries.push(...entries);
  }

  getTerms(): GlossaryEntry[] {
    return this.entries;
  }

  match(text: string): string | null {
    for (const entry of this.entries) {
      if (text.toLowerCase().includes(entry.en.toLowerCase())) {
        return entry.zh;
      }
    }
    return null;
  }

  // 按 en 长度降序的副本上做子串匹配, 修种子顺序 bug: "antiferroelectric"
  // 文本若按存储序先命中 "ferroelectric", 会被误吞成"铁电"条目;
  // 先长后短保证长术语优先命中, 存储顺序本身不动。返回全部命中词条(按 en 去重),
  // 顺序即长度降序, 供对照表 prompt 让模型优先看到长术语。
  matchAll(text: string): GlossaryEntry[] {
    const sorted = [...this.entries].sort((a, b) => b.en.length - a.en.length);
    const lower = text.toLowerCase();
    const seen = new Set<string>();
    const hits: GlossaryEntry[] = [];
    for (const entry of sorted) {
      if (!entry.en) continue;
      const key = entry.en.toLowerCase();
      // 去重: 同一英文术语(大小写变体)只收第一次命中
      if (seen.has(key)) continue;
      if (lower.includes(key)) {
        seen.add(key);
        hits.push(entry);
      }
    }
    return hits;
  }

  injectIntoPrompt(prompt: string): string {
    if (this.entries.length === 0) return prompt;
    
    const terms = this.entries
      .map(e => `${e.en}=${e.zh}`)
      .join(", ");
    
    return `${prompt}\n\nTerminology: ${terms}`;
  }

  validate(translation: string, englishTerms: string[]): boolean {
    // Check if any English terms still appear in translation
    for (const term of englishTerms) {
      const regex = new RegExp(term, "i");
      if (regex.test(translation)) {
        return false;
      }
    }
    return true;
  }
}

// 转义正则元字符: 术语含 "-" "(" 等符号时, 裸 new RegExp(term) 会抛错或误判
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 纯函数: 把命中词条拼成对照表附加指令; 空数组返回空串, 调用方据空串跳过拼接
export function buildGlossaryPrompt(entries: GlossaryEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => `- ${e.en} → ${e.zh}`);
  return `\n\n术语对照表(译文中必须严格使用下列译名):\n${lines.join("\n")}`;
}

// 纯函数: 检出译文中仍以英文残留的词条, 大小写不敏感。
// 刻意只做子串匹配不做 word-boundary: 符号类术语(如 "P-E loop")前后
// 无 \b 语义, 边界断言不可靠, 误报由二次请求兜底而非误放行。
export function residualTerms(
  result: string,
  entries: GlossaryEntry[],
): string[] {
  const residual: string[] = [];
  for (const entry of entries) {
    if (!entry.en) continue;
    const regex = new RegExp(escapeRegExp(entry.en), "i");
    if (regex.test(result)) {
      residual.push(entry.en);
    }
  }
  return residual;
}

// Pre-populated ferroelectric/high-pressure glossary
export const FERROELECTRIC_GLOSSARY: GlossaryEntry[] = [
  { en: "ferroelectric", zh: "铁电" },
  { en: "antiferroelectric", zh: "反铁电" },
  { en: "depolarization", zh: "去极化" },
  { en: "Hugoniot", zh: "霍吉奥曲线" },
  { en: "spall", zh: "喷蚀" },
  { en: "relaxor", zh: "弛豫铁电" },
  { en: "piezoelectric", zh: "压电" },
  { en: "pyroelectric", zh: "热释电" },
  { en: "ferroelastic", zh: "铁弹" },
  { en: "phase transition", zh: "相变" },
  { en: "switching", zh: "极化反转" },
  { en: "domain wall", zh: "畴壁" },
  { en: "polarization", zh: "极化" },
  { en: "electric field", zh: "电场" },
  { en: "strain", zh: "应变" },
  { en: "stress", zh: "应力" },
  { en: "pressure", zh: "压力" },
  { en: "shock compression", zh: "冲击压缩" },
  { en: "dynamic loading", zh: "动载" },
  { en: "piezoresistive", zh: "压阻" },
];
