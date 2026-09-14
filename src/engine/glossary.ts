import type { GlossaryEntry } from "../types";

export class GlossaryManager {
  private entries: GlossaryEntry[] = [];

  add(entry: GlossaryEntry): void {
    this.entries.push(entry);
  }

  addMultiple(entries: GlossaryEntry[]): void {
    this.entries.push(...entries);
  }

  // 清空全部词条: 供"重建生效词表"在重灌前调用(先 reset 再 addMultiple),
  // 其余 API 与内部结构保持不变
  reset(): void {
    this.entries = [];
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

export interface UserGlossaryParseResult {
  entries: GlossaryEntry[];
  errorLines: number;
}

/**
 * 纯函数: 解析用户自定义术语表原文(textarea 逐行格式)。
 * - 每行 "原文 = 译文", 按首个 = 分割, 两侧 trim(译文中再含 = 不影响);
 * - 空行与 # 开头的注释行跳过;
 * - 缺 = 或任一侧为空的行计入 errorLines, 但不阻断解析 — 合法行照常生效,
 *   坏行由用户在设置页自行修正(调用方不因 errorLines > 0 拒绝整份词表)。
 */
export function parseUserGlossary(text: string): UserGlossaryParseResult {
  const entries: GlossaryEntry[] = [];
  let errorLines = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    // 空行与 # 注释行: 直接跳过, 不计入错误
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      errorLines += 1;
      continue;
    }
    const en = trimmed.slice(0, eq).trim();
    const zh = trimmed.slice(eq + 1).trim();
    if (!en || !zh) {
      errorLines += 1;
      continue;
    }
    entries.push({ en, zh });
  }
  return { entries, errorLines };
}

/**
 * 纯函数: 合并内置种子词表与用户词条 — 用户条目按 en 键(小写化比较)覆盖
 * seeds 中的同名条目(覆盖后留在 seed 原位置, 保留用户的英文大小写与译名),
 * 未命中 seed 的用户条目按书写顺序追加在尾部; 入参数组均不变异, 返回新数组。
 */
export function mergeGlossaries(
  seeds: GlossaryEntry[],
  user: GlossaryEntry[],
): GlossaryEntry[] {
  // 用户词条按 en 小写化建索引; 同名多条时后写覆盖先写
  const overrides = new Map<string, GlossaryEntry>();
  for (const entry of user) {
    const key = entry.en.trim().toLowerCase();
    if (key) overrides.set(key, entry);
  }
  const merged: GlossaryEntry[] = [];
  const consumedKeys = new Set<string>();
  for (const seed of seeds) {
    const key = seed.en.trim().toLowerCase();
    const override = overrides.get(key);
    if (override) {
      merged.push(override);
      consumedKeys.add(key);
    } else {
      merged.push(seed);
    }
  }
  // 未命中任何 seed 的用户词条追加在尾部(同名重复的用户行已被 consumedKeys 排除)
  for (const entry of user) {
    const key = entry.en.trim().toLowerCase();
    if (key && !consumedKeys.has(key)) merged.push(entry);
  }
  return merged;
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
