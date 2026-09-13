/**
 * Extra 字段译文持久化: 行格式解析/序列化(纯函数) + Zotero item 读写封装。
 *
 * 行格式与 zotero-plugin-toolkit 的 ExtraField(T4Z 同款)互通, 换插件数据不丢:
 * - item.getField("extra") 按 \n 分行; 每行按首个 ": " 分割 key/value;
 *   值内再含 ": " 时以首个分割为准(等价于 toolkit 的 split(": ") 后用 ": " 回拼);
 * - 不含 ": " 或 key 为空的行归"非标准行", 解析与写回均保留;
 * - 同名 key 可多值(toolkit 取第一个), 本插件写入时覆盖为单值。
 *
 * 换行转义约定(本插件对多行值的扩展): 值内的换行符写盘时转义为字面 \n
 * 两个字符(反斜杠+n), 读取时还原 — 摘要译文必然多行, 不转义会破坏 extra 的
 * 行结构。转义在解析/序列化层完成, 调用方读写均面对原始多行文本。
 * 已知局限: 值本身含字面反斜杠+n 序列时读取会被还原为换行(自然语言译文中
 * 几乎不会出现, 换取实现与 toolkit 保持最小差异)。
 */

/** 解析结果: fields 为 key -> 值数组(Map 保持 key 首次出现顺序), nonStandard 为原样非标准行 */
export interface ParsedExtra {
  fields: Map<string, string[]>;
  nonStandard: string[];
}

/**
 * 解析 extra 行文本: 空行跳过; 每行按首个 ": " 分割; 不含 ": " 或 key 为空的行
 * 归入 nonStandard 并保持原序; 同名 key 的多个值按出现顺序全保留。
 */
export function parseExtraFields(raw: string): ParsedExtra {
  const fields = new Map<string, string[]>();
  const nonStandard: string[] = [];
  for (const line of (raw ?? "").split("\n")) {
    // 空行跳过: 不占 key 也不入非标准行(toolkit 同口径)
    if (line.trim() === "") continue;
    // indexOf 取首个 ": "; -1 为不含分隔符, 0 为 key 为空, 两者都算非标准行
    const idx = line.indexOf(": ");
    if (idx <= 0) {
      nonStandard.push(line);
      continue;
    }
    const key = line.slice(0, idx);
    const value = line.slice(idx + 2);
    const values = fields.get(key);
    if (values) values.push(value);
    else fields.set(key, [value]);
  }
  return { fields, nonStandard };
}

/**
 * 还原为行文本: 每个 key 的每个值一行; 非标准行兜底放末尾 —
 * 解析时它们无法归入 key/value 结构, 与标准行的原始交错顺序已不可恢复,
 * 放末尾是最不破坏标准行序的取舍(非标准行本就多散落在 extra 尾部)。
 */
export function serializeExtraFields(
  fields: Map<string, string[]>,
  nonStandard: string[],
): string {
  const lines: string[] = [];
  for (const [key, values] of fields) {
    for (const value of values) lines.push(`${key}: ${value}`);
  }
  for (const line of nonStandard) lines.push(line);
  return lines.join("\n");
}

/** 写盘转义: 值内换行符替换为字面 \n(反斜杠+n)两字符, 保证 extra 行结构不破 */
function escapeNewlines(value: string): string {
  return value.replace(/\n/g, "\\n");
}

/** 读取还原: 字面 \n(反斜杠+n)替换回换行符 */
function unescapeNewlines(value: string): string {
  return value.replace(/\\n/g, "\n");
}

/**
 * 读条目 Extra 字段指定 key 的首个值, 值内字面 \n 还原为换行。
 * 无 extra / 无该 key 时返回 undefined。
 */
export function getExtraField(item: any, key: string): string | undefined {
  const raw: string = item?.getField?.("extra") ?? "";
  const { fields } = parseExtraFields(raw);
  const values = fields.get(key);
  if (!values || values.length === 0) return undefined;
  return unescapeNewlines(values[0]);
}

/**
 * 把 value 写入条目 Extra 字段指定 key 并落库(saveTx):
 * - value 为空串/undefined(null 同) -> 删除该 key 全部行(同名多值一并移除);
 * - 否则覆盖为单值(Map.set 对已存在 key 保持原位序, 新 key 追加到末尾),
 *   其余 key 行与非标准行原样保留;
 * - 值内换行先转义为字面 \n 再序列化。
 */
export async function setExtraField(
  item: any,
  key: string,
  value: string,
): Promise<void> {
  const raw: string = item?.getField?.("extra") ?? "";
  const { fields, nonStandard } = parseExtraFields(raw);
  if (!value) {
    fields.delete(key);
  } else {
    fields.set(key, [escapeNewlines(value)]);
  }
  item.setField("extra", serializeExtraFields(fields, nonStandard));
  await item.saveTx();
}
