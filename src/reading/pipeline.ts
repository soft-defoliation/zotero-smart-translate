import type { Segment } from "../types";

const HEADING_RE =
  /^(?:\d+(?:\.\d+)*\.?\s+)?(abstract|introduction|background|methods?|methodology|experiments?|results?(?:\s+and\s+discussion)?|discussion|conclusions?(?:\s+and\s+future\s+work)?|references|acknowledgements?)(?:\s*[:\-]?\s*)?$/i;

export function splitSections(text: string): Segment[] {
  const lines = text.split(/\n+/);
  const segments: Segment[] = [];
  let current: Segment = { title: "Preamble", text: "" };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (HEADING_RE.test(trimmed)) {
      if (current.text.trim()) segments.push(current);
      current = { title: trimmed, text: "" };
      continue;
    }
    current.text += (current.text ? "\n" : "") + trimmed;
  }
  if (current.text.trim()) segments.push(current);
  return segments.length ? segments : [{ title: "Full Text", text }];
}

// 分节文本格式化: map/创新/方法三类 prompt 共用, 保留 "## 标题" 结构.
// 不再在 prompt 层按 4000 字符截断单段 — 总量控制已上移到 chunkSegments
// 分块与 assistant 的单块预算对半, prompt 层截断会静默丢失正文.
function formatSegments(segments: Segment[]): string {
  return segments
    .map((s) => `## ${s.title}\n${s.text}`)
    .join("\n\n");
}

// map 指令: 对单个块输出中文摘要, 不做额外发挥
const MAP_INSTRUCTION =
  "Below is one part of an academic paper. Write a Chinese summary of this part, " +
  "covering the research object, key methods and main findings. " +
  "Output the Chinese summary only.\n\n";

/** 单块 map: 对一个块生成中文摘要的完整 prompt */
export function mapPrompt(chunk: Segment[]): string {
  return `${MAP_INSTRUCTION}${formatSegments(chunk)}`;
}

/**
 * reduce 汇总: 输入各块摘要, 要求合成为一篇连贯的整体中文摘要
 * (而非简单拼接); 单块场景调用方可跳过 reduce 直接采用该块摘要.
 */
export function reducePrompt(summaries: string[]): string {
  const body = summaries.map((s, i) => `[${i + 1}] ${s}`).join("\n\n");
  return (
    "The following are Chinese summaries of consecutive parts of one academic paper. " +
    "Synthesize them into one coherent overall Chinese summary of the whole paper " +
    "instead of concatenating them. Output the Chinese summary only.\n\n" +
    body
  );
}

export function innovationPrompt(chunk: Segment[]): string {
  return `Extract up to 5 innovations from the following text. For each innovation, provide the conclusion and the section evidence. Mark items without evidence as [待核]. Text:\n\n${formatSegments(chunk)}`;
}

export function methodPrompt(chunk: Segment[]): string {
  return `Extract the following fields from the text. Output JSON only, missing fields as "未提及": composition, synthesis, characterization, dft_params, loading_condition. Text:\n\n${formatSegments(chunk)}`;
}

export const METHOD_SCHEMA = [
  "composition",
  "synthesis",
  "characterization",
  "dft_params",
  "loading_condition",
] as const;

/**
 * 分块纯函数: 按段文本累计字符数把 segments 分成多组, 每组总量不超过
 * maxChars(单段自身超限时独立成组, 超限部分由调用方做预算对半兜底).
 * 保持原有段序; 累计恰好等于上限不切分(仅严格大于才开新组).
 */
export function chunkSegments(
  segments: Segment[],
  maxChars = 10000,
): Segment[][] {
  const chunks: Segment[][] = [];
  let current: Segment[] = [];
  let acc = 0;
  for (const seg of segments) {
    const len = seg.text.length;
    // 单段自身超限: 独立成组, 不与前后拼接
    if (len > maxChars) {
      if (current.length) {
        chunks.push(current);
        current = [];
        acc = 0;
      }
      chunks.push([seg]);
      continue;
    }
    // 放不进当前组: 先落袋再开新组
    if (current.length && acc + len > maxChars) {
      chunks.push(current);
      current = [];
      acc = 0;
    }
    current.push(seg);
    acc += len;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function parseInnovations(raw: string): string[] {
  return raw
    .split(/\n+/)
    .map((s) => s.trim())
    // 剥离 markdown 列表前缀, 否则前缀残留在条目里导致合并去重失效:
    // 普通短横/星号("- x"/"* x"), 编号("1. x"), 加粗编号("**1. x" 型);
    // 加粗条目常以闭合 ** 结尾, 一并剥离防残迹(不命中加粗编号的普通
    // 文本不受影响, 两条 replace 各自只在命中时生效)
    .map((s) =>
      s
        .replace(/^\s*(?:[-*]|\*\*?\d+[.)]|\d+[.)])\s+/, "")
        .replace(/\s*\*\*$/, "")
        .trim(),
    )
    .filter((s) => s.length > 0)
    .slice(0, 5);
}

/**
 * 剥离模型输出常见的 markdown 代码围栏: ```json ... ``` 或 ``` ... ```。
 * 只在串确以围栏开头时剥离, 裸 JSON 原样返回; 头部围栏后的换行由 \s* 吞掉。
 */
function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return stripped || trimmed;
}

export function parseMethods(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of METHOD_SCHEMA) out[key] = "未提及";
  try {
    const obj = JSON.parse(stripJsonFence(raw));
    for (const key of METHOD_SCHEMA) {
      if (obj[key] && typeof obj[key] === "string") out[key] = obj[key].trim() || "未提及";
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * 单请求预算校验: 按 4 字符/token 粗估整组 token 数.
 * 分块后的整体规模由 chunkSegments 控制, 此处只负责判定单个请求
 * (一个块)是否超预算, 超限则由 assistant 对半再切.
 */
export function checkBudget(
  segments: Segment[],
  warnThreshold: number,
  maxTokens: number,
): { ok: boolean; estimated: number } {
  const text = segments.map((s) => s.text).join("");
  const estimated = Math.ceil(text.length / 4);
  return {
    ok: estimated <= maxTokens,
    estimated,
  };
}
