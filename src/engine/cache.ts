/**
 * 会话级 LRU 翻译缓存 — 纯内存 Map 实现, 不做持久化(重启即清,
 * 规避跨版本/跨引擎的脏数据)。选区弹窗易被误关, 重选同一句极常见,
 * 命中缓存可 0ms 复用并省一次真实请求。
 *
 * LRU 实现: JS Map 迭代序即插入序 — 命中/写入时先删后插把条目移到
 * 尾部(最近使用), 超容量时删除迭代序首个(最旧)条目。
 *
 * 两级缓存: 整段缓存(键=引擎/模型/语言对/整段原文)与句子缓存(键额外带
 * seg| 前缀, 原文位放单句文本)分开存放 — 同名不同粒度互不污染, 句子
 * 条目天然比整段多, 故单独给更大的容量。
 */

// 缓存容量: 会话级翻译条目远超此数的场景罕见, 100 条足够覆盖一次阅读
const CACHE_CAPACITY = 100;

// 句子缓存容量: 一篇文章动辄几百句, 500 条覆盖一次完整阅读的句子复用
const SEGMENT_CACHE_CAPACITY = 500;

// 模块级单例: 同一 Zotero 会话内所有翻译共享
const cache = new Map<string, string>();

// 句子缓存独立 Map: 与整段缓存隔离(键前缀 seg| 只是双保险)
const segmentCache = new Map<string, string>();

/**
 * 组装缓存 key: 引擎 id|模型|源语言|目标语言|原文 五元组。
 * model 必须入 key — 换模型后语义/术语可能不同, 不能吃到旧模型的结果。
 */
export function buildCacheKey(
  engineId: string,
  model: string,
  sourceLang: string,
  targetLang: string,
  text: string,
): string {
  return `${engineId}|${model}|${sourceLang}|${targetLang}|${text}`;
}

/** 命中则返回缓存值并把该条目标记为最近使用, 未命中返回 undefined */
export function cacheGet(key: string): string | undefined {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  // 先删后插 = 移到 Map 尾部, 实现"最近使用"优先保留
  cache.delete(key);
  cache.set(key, value);
  return value;
}

/** 写入缓存并按容量淘汰最旧条目(重复 key 先删再插, 保证序位正确) */
export function cachePut(key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_CAPACITY) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** 清空缓存(供测试与诊断): 整段与句子两级同时清, 避免句子缓存在用例间串味 */
export function clearTranslateCache(): void {
  cache.clear();
  segmentCache.clear();
}

/** 当前缓存条目数(供测试断言容量与淘汰) */
export function cacheSize(): number {
  return cache.size;
}

/** 句子缓存键前缀: 句文本以 seg| 打头参与, 与整段缓存命名空间分离 */
export const SEGMENT_CACHE_KEY_PREFIX = "seg|";

/**
 * 组装句子缓存键: seg| + 五元组(引擎/模型/语言对/单句原文)。
 * 复用 buildCacheKey 保证两级缓存的失效语义一致(换模型不吃旧结果);
 * 调用方须先对句文本做 normalizeForCache, 排版差异不该产生新键。
 */
export function buildSegmentCacheKey(
  engineId: string,
  model: string,
  sourceLang: string,
  targetLang: string,
  sentence: string,
): string {
  return `${SEGMENT_CACHE_KEY_PREFIX}${buildCacheKey(
    engineId,
    model,
    sourceLang,
    targetLang,
    sentence,
  )}`;
}

/** 命中则返回句子缓存值并把该条目标记为最近使用, 未命中返回 undefined */
export function segmentCacheGet(key: string): string | undefined {
  const value = segmentCache.get(key);
  if (value === undefined) return undefined;
  // 先删后插 = 移到 Map 尾部, 与整段缓存同一套 LRU 手法
  segmentCache.delete(key);
  segmentCache.set(key, value);
  return value;
}

/** 写入句子缓存并按容量淘汰最旧条目(重复 key 先删再插, 保证序位正确) */
export function segmentCachePut(key: string, value: string): void {
  segmentCache.delete(key);
  segmentCache.set(key, value);
  while (segmentCache.size > SEGMENT_CACHE_CAPACITY) {
    const oldest = segmentCache.keys().next();
    if (oldest.done) break;
    segmentCache.delete(oldest.value);
  }
}

/** 当前句子缓存条目数(供测试断言命中/写入与容量淘汰) */
export function segmentCacheSize(): number {
  return segmentCache.size;
}
