/**
 * 句子级翻译记忆的纯函数集: 句切分 / 编号请求解析 / 译文拼装。
 * 全部无副作用、可独立单测; data.ts 只做编排(查缓存/发请求/写缓存),
 * 判断逻辑一律落在这里, 便于回归。
 *
 * 动机: 多句选区按整段请求, 重选其中一句也要重发整段。改成按句查缓存后,
 * 全命中 0 请求; 部分命中只发缺失句(编号请求), 与已缓存句拼装还原全文。
 */

/** 单次记忆请求覆盖的最大句数: 超过则回落整段路径(编号长列表易被模型漏行) */
export const MAX_MEMORY_SEGMENTS = 30;

/** 单句最大字符数: 超长"句"(多半是无标点长文)编号无收益, 回落整段 */
export const MAX_MEMORY_SEGMENT_CHARS = 1000;

/** 最小句长: 短于该值的碎片(如 "Fig." 后切出的 "2")并入前段, 不单独占缓存 */
const MIN_SEGMENT_CHARS = 8;

/**
 * 编号请求附加指令: 追加在术语表指令之后, 要求模型逐句独立翻译且
 * 保持行号与顺序 —— 解析侧据此把译文切回各句。
 */
export const NUMBERING_INSTRUCTION =
  "输入包含多句文本, 每行以「N. 」开头。请逐句独立翻译, 输出必须保持相同的行号与顺序, 每行格式为「N. 译文」, 不要合并、拆分或遗漏任何行。";

/**
 * 缓存归一化: 空白折叠 + 去首尾。
 * 同一段文本的排版差异(多空格/换行/缩进)应命中同一条缓存, 因此全键与
 * 句子键的文本位一律先用本函数处理。
 */
export function normalizeForCache(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 句子切分(供数据层决定是否走句子级记忆):
 * 1. 先按换行拆(拼接缓冲以换行连接, 一行一块, 行边界天然是句子边界);
 * 2. 每段再按句末标点后的空白拆(中英文标点都认);
 * 3. <8 字符的碎片并入前段(避免 "2" 这类残片进缓存);
 * 4. 拆完不足两段(含全空/无标点长文本)时原样返回 [text] — 不强行拆,
 *    调用方据此判断"无句子记忆收益"。
 */
export function splitSentences(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const out: string[] = [];
  for (const line of lines) {
    const parts = line
      .split(/(?<=[.!?。！？])\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    for (const part of parts) {
      if (part.length < MIN_SEGMENT_CHARS && out.length > 0) {
        // 短碎片并入前段(用空格衔接, 中文碎片的空格无伤大雅)
        out[out.length - 1] = `${out[out.length - 1]} ${part}`;
      } else {
        out.push(part);
      }
    }
  }
  // 全空或单段: 返回原文单段, 交由调用方走整段路径
  if (out.length <= 1) return [text];
  return out;
}

/**
 * 去掉显示层的行号: 编号请求的流式增量经此处理后再回放给面板,
 * 用户看到的是纯译文增长, 不会看到 "1. " 这类协议噪声。
 */
export function stripNumberingForDisplay(partial: string): string {
  return partial.replace(/^\s*\d+[.、)]\s?/gm, "");
}

/** 编号行: "1. 译文" / "1、译文" / "1) 译文" 三种常见写法都认 */
const NUMBERED_LINE = /^\s*(\d+)[.、)]\s*(.*)$/;

/** 把一行内容追加到指定序号(重复序号视为同一句的续写, 用空格衔接) */
function appendLine(
  values: Map<number, string>,
  index: number,
  body: string,
): void {
  const prev = values.get(index) ?? "";
  values.set(index, prev ? `${prev} ${body}` : body);
}

/**
 * 解析编号译文(纯函数):
 * - 先丢弃 ``` 围栏行(模型偶尔给整段译文套代码块);
 * - 命中编号行即按序号入 map(重复序号追加);
 * - 未命中行: 空行跳过; 非空行若已有上一个序号则视为该句续行(模型软换行),
 *   编号出现之前就有杂项则判定解析失败返回 null(可能是模型的寒暄/解释);
 * - 最后要求 1..count 每句都非空, 否则返回 null。
 * 返回 null 即"编号路径不可用", 调用方回落整段路径。
 */
export function parseNumberedTranslations(
  text: string,
  count: number,
): string[] | null {
  if (count < 1) return null;
  const values = new Map<number, string>();
  // 0 = 尚未出现任何编号; 此前的非空杂项一律视为解析失败
  let lastIndex = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    // 围栏行(``` 或 ```json)直接丢弃
    if (trimmed.startsWith("```")) continue;
    const match = NUMBERED_LINE.exec(rawLine);
    if (match) {
      const index = Number(match[1]);
      lastIndex = index;
      appendLine(values, index, match[2].trim());
      continue;
    }
    if (!trimmed) continue;
    if (lastIndex === 0) return null;
    appendLine(values, lastIndex, trimmed);
  }
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const value = (values.get(i) ?? "").trim();
    if (!value) return null;
    out.push(value);
  }
  return out;
}

/**
 * 拼装各句译文: 目标语言为中文(zh 开头)时句间不加空格(中文标点已自足),
 * 其他语言用空格衔接。空片段被丢弃, 避免拼出双空格。
 */
export function assembleTranslations(
  parts: string[],
  targetLanguage: string,
): string {
  const separator = targetLanguage.trim().toLowerCase().startsWith("zh")
    ? ""
    : " ";
  const cleaned = parts.map((part) => part.trim()).filter((part) => part.length > 0);
  return cleaned.join(separator);
}
