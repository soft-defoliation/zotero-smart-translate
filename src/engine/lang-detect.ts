/**
 * 中文检测纯函数 — 供选区弹窗在翻译前拦截"以中文为主"的文本。
 * 对齐 Translate for Zotero 的 disabledLanguages 先例(中文环境默认含 zh,
 * 命中即跳过自动翻译), 但这里用启发式占比替代语言列表, 不依赖外部库。
 */

// CJK 统一表意文字主区 + 扩展 A 区: 真正承载语义的汉字
const CJK_IDEOGRAPH_RANGES: Array<[number, number]> = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
];

// CJK 标点符号区(\u3000-\u303f: ,。「」等)不单独建表:
// 出现即暗示中文语境, 按契约计入分母不计入分子(分子只统计下方表意区)
// 判定阈值: CJK 字符占非空白字符比例超过该值即视为中文。
// 0.3 的依据: 中英混排学术句里英文术语/公式占比高, "以中文为主、
// 夹杂英文术语"的句子(如 铁电体 ferroelectric 材料的压电响应,
// 实际占比约 0.43)仍能正确跳过; 而纯英文句偶含个别中文字符时
// 占比通常远低于 0.3, 不会被误判成中文(不误杀)。
const CHINESE_RATIO_THRESHOLD = 0.3;

// 采样长度上限: 划词翻译的句子极少超过 200 字符,
// 取前 200 字符足以判定语种, 同时避免长段落全量扫描的开销
const SAMPLE_LIMIT = 200;

function inRange(code: number, range: [number, number]): boolean {
  return code >= range[0] && code <= range[1];
}

/**
 * 判断文本是否"以中文为主":
 * 取前 200 字符作样本, 统计 CJK 表意字符占非空白字符的比例,
 * 大于 0.3 判定中文。空串/纯符号(比分为 0)一律返回 false。
 */
export function isMostlyChinese(text: string): boolean {
  if (typeof text !== "string") return false;
  const sample = text.slice(0, SAMPLE_LIMIT);
  let cjkCount = 0;
  let denominator = 0;
  for (const ch of sample) {
    // 空白字符不进分母, 避免稀释占比导致漏判
    if (/\s/u.test(ch)) continue;
    denominator += 1;
    const code = ch.codePointAt(0) ?? 0;
    for (const range of CJK_IDEOGRAPH_RANGES) {
      if (inRange(code, range)) {
        cjkCount += 1;
        break;
      }
    }
    // 中文标点仅进分母(上面 denominator 已加), 不进分子
  }
  if (denominator === 0) return false;
  return cjkCount / denominator > CHINESE_RATIO_THRESHOLD;
}
