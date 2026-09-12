import {
  getActiveEngine,
  getSecret,
  getSettings,
  setActiveEngine,
} from "./engine/settings";
import { GPTService } from "./engine/gpt-service";
import { APIError, RateLimitError } from "./engine/retry";
import {
  GlossaryManager,
  FERROELECTRIC_GLOSSARY,
  buildGlossaryPrompt,
  residualTerms,
} from "./engine/glossary";
import {
  buildCacheKey,
  buildSegmentCacheKey,
  cacheGet,
  cachePut,
  segmentCacheGet,
  segmentCachePut,
} from "./engine/cache";
import {
  MAX_MEMORY_SEGMENTS,
  MAX_MEMORY_SEGMENT_CHARS,
  NUMBERING_INSTRUCTION,
  assembleTranslations,
  normalizeForCache,
  parseNumberedTranslations,
  splitSentences,
  stripNumberingForDisplay,
} from "./engine/sentence-memory";
import type { EngineConfig, Settings } from "./types";

export const data = {
  alive: true,
  initialized: false,
  settings: null as unknown as Settings,
  glossary: new GlossaryManager(),
};

export function initData(settings: Settings): void {
  data.settings = settings;
  data.glossary.addMultiple(FERROELECTRIC_GLOSSARY);
}

/**
 * 停用终闸错误的可识别标记 — 停用(500)与真正可转移的 5xx(如 503)同属 APIError
 * 500 类, 单靠状态码无法区分, 故用 code 字段打标记(最小改动: 状态码保持 500,
 * 老调用方与既有断言不受影响), isFailoverEligible 据此把它排除出转移范围。
 */
export const ALIVE_GATE_CODE = "alive-gate";

/** 连续 N 次靠故障转移救活后, 把救活的引擎记为当前引擎(粘性切换) */
export const FAILOVER_STICKY_THRESHOLD = 3;

/** 连续"靠备用引擎救活"的次数; 当前引擎直接成功或粘性切换后清零 */
let consecutiveFailovers = 0;

/**
 * 故障转移错误分类(纯函数, 导出供测试)。
 * 可转移(换引擎可能救活):
 * - RateLimitError: 429 限流 / 1305 模型过载(智谱经网关也多以 429/5xx 返回);
 * - APIError 401/403(密钥失效/无权限)、429、>=500(服务端故障);
 * - TypeError: fetch 在网络层失败(DNS/断网/连接重置)。
 * 不可转移(换引擎也救不了, 直接抛给用户看原因):
 * - APIError 400 及其他配置类中文错误(模型名/参数/endpoint 写错);
 * - 停用终闸(alive=false): 见 ALIVE_GATE_CODE, 它的 500 是内部状态而非服务端故障。
 */
export function isFailoverEligible(e: unknown): boolean {
  if (e instanceof RateLimitError) return true;
  if (e instanceof APIError) {
    if (e.code === ALIVE_GATE_CODE) return false;
    const status = e.statusCode;
    if (status === undefined) return false;
    return status === 401 || status === 403 || status === 429 || status >= 500;
  }
  return e instanceof TypeError;
}

/**
 * 候选引擎链(纯函数, 导出供测试): 当前引擎排首位, 其余按 engine1/2/3 顺序跟随;
 * 跳过未配置密钥(空串/纯空白)的引擎 — 打过去只会拿 401, 浪费一跳;
 * 全部无密钥时返回空数组, 由调用方抛原有中文配置错误。
 */
export function buildEngineCandidates(
  settings: Settings,
  secrets: Record<string, string>,
): EngineConfig[] {
  const all = [settings.engine1, settings.engine2, settings.engine3];
  const active = all.find((e) => e.id === settings.activeEngineId);
  // active 不在三引擎内时(脏数据)退化为原顺序, 不额外报错
  const ordered = active ? [active, ...all.filter((e) => e !== active)] : all;
  return ordered.filter((e) => (secrets[e.id] ?? "").trim().length > 0);
}

/** 引擎 id → 密钥快照, 供纯函数 buildEngineCandidates 使用 */
function collectSecrets(): Record<string, string> {
  const settings = getSettings();
  const out: Record<string, string> = {};
  for (const engine of [settings.engine1, settings.engine2, settings.engine3]) {
    out[engine.id] = getSecret(engine.id);
  }
  return out;
}

/**
 * 组装候选链并套用开关: autoFailover=false 时只保留当前引擎
 * (契约"开关关闭时不做任何转移", 行为与历史版本一致); 当前引擎无密钥时得到空数组。
 */
function resolveCandidates(
  settings: Settings,
  active: EngineConfig,
): EngineConfig[] {
  const chain = buildEngineCandidates(settings, collectSecrets());
  if (settings.autoFailover === false) {
    return chain.filter((e) => e.id === active.id);
  }
  return chain;
}

/**
 * 故障转移成功记账(粘性切换):
 * - 结果出自当前引擎(含缓存命中) → 连续计数清零;
 * - 结果出自备用引擎 → 计数 +1, 达阈值即 setActiveEngine(持久化)并清零,
 *   下次请求直接以它为首选, 不必再吃一次首个引擎的失败。
 * Zotero.debug 记一行便于排查; 无 Zotero 环境(单测)静默跳过。
 */
function noteFailoverOutcome(engineId: string, activeEngineId: string): void {
  if (engineId === activeEngineId) {
    consecutiveFailovers = 0;
    return;
  }
  consecutiveFailovers += 1;
  if (consecutiveFailovers < FAILOVER_STICKY_THRESHOLD) return;
  setActiveEngine(engineId);
  consecutiveFailovers = 0;
  try {
    (globalThis as any).Zotero?.debug?.(
      `[SmartTranslate] 连续 ${FAILOVER_STICKY_THRESHOLD} 次故障转移成功, 当前引擎已切换为 ${engineId}`,
    );
  } catch {
    /* Zotero.debug 不可用(单测/早期启动)时忽略 */
  }
}

/**
 * 候选链执行器: 依次尝试 candidates(当前引擎优先), 单引擎最终失败且错误可转移时
 * 换下一候选整链重试; 错误不可转移(400/配置类中文错误/停用终闸)或已无后续候选时
 * 原样抛出, 由 UI 层经 zhErrorMessage 译成中文提示。
 * onAttempt 在每次请求真正发出的引擎确定后回调(缓存命中同样回调, 缓存 key 已含引擎)。
 */
async function runCandidateChain<T>(
  active: EngineConfig,
  candidates: EngineConfig[],
  attempt: (engine: EngineConfig) => Promise<T>,
  onAttempt?: (engine: EngineConfig, failover: boolean) => void,
): Promise<T> {
  let lastError: unknown;
  let remaining = candidates.length;
  for (const engine of candidates) {
    remaining -= 1;
    onAttempt?.(engine, engine.id !== active.id);
    try {
      const value = await attempt(engine);
      // 成功即记账(粘性计数/可能的粘性切换)
      noteFailoverOutcome(engine.id, active.id);
      return value;
    } catch (e) {
      lastError = e;
      // 不可转移的错误重试也是白搭; 无后续候选时同样抛出, 保留原始错误对象
      if (!isFailoverEligible(e) || remaining === 0) throw e;
    }
  }
  throw lastError;
}

/**
 * 句子级记忆分支的结果:
 * - allCached=true: 全部句子命中缓存(0 请求), 调用方写全键缓存后直接返回;
 * - allCached=false: 缺失句经一次编号请求补齐, 继续走共享的残留检查与缓存写入。
 * 返回 null 表示"该文本不适合走句子记忆", 由调用方回落整段路径。
 */
interface MemoryOutcome {
  text: string;
  allCached: boolean;
}

/** 句子缓存键(句文本先归一化): 与整段缓存同套五元组, 仅前缀与文本粒度不同 */
function segmentKeyFor(engine: EngineConfig, sentence: string): string {
  const settings = getSettings();
  return buildSegmentCacheKey(
    engine.id,
    engine.model,
    settings.sourceLanguage,
    settings.targetLanguage,
    normalizeForCache(sentence),
  );
}

/**
 * 句子级翻译记忆:
 * 1. 逐句查句子缓存 — 全命中即拼装返回(0 请求, 面板 onProgress 回放一次);
 *    单句文本同样先查句子缓存(重选同一句的高频场景, 命中即 0 请求);
 * 2. 多句且有缺失时只把缺失句按 "N. 句" 编号后发一次请求(N 从 1 起连续),
 *    解析成功则用"已缓存句 + 新译文"按原顺序拼装, 新译文逐条写入句子缓存;
 * 3. 不适用/解析失败/请求抛错统一返回 null → 调用方回落整段路径
 *    (整段路径自带术语注入/残留二次修正/退避重试与故障转移, 行为与旧版一致)。
 * 注: 编号请求失败时可能已产生一次无效计费, 这是拿到"按句复用"能力的代价,
 * 概率低(仅在多句文本且句子缓存不完整时发生), 换取后续重选 0 请求。
 */
async function trySegmentMemory(
  engine: EngineConfig,
  service: GPTService,
  text: string,
  glossaryInstruction: string,
  onProgress?: (partial: string) => void,
): Promise<MemoryOutcome | null> {
  const settings = getSettings();
  const segments = splitSentences(text);
  // 句数超限时编号请求易被模型漏行, 一律回落整段
  if (segments.length > MAX_MEMORY_SEGMENTS) return null;
  if (segments.some((seg) => seg.length > MAX_MEMORY_SEGMENT_CHARS)) return null;

  // 逐句查缓存; miss 的位置收集起来, 只把缺失句发给引擎(省 token)
  const cachedValues = segments.map((seg) => segmentCacheGet(segmentKeyFor(engine, seg)));
  if (cachedValues.every((value) => value !== undefined)) {
    const assembled = assembleTranslations(
      cachedValues as string[],
      settings.targetLanguage,
    );
    onProgress?.(assembled);
    return { text: assembled, allCached: true };
  }
  // 单句未命中: 拆不出多句(或本就只选一句)时编号请求等于整段重复, 回落整段路径;
  // 单句"全命中"已在上面拿到 0 请求返回(重选同一句的高频场景)
  if (segments.length < 2) return null;
  const missingIndexes = segments
    .map((_, index) => index)
    .filter((index) => cachedValues[index] === undefined);
  const numberedText = missingIndexes
    .map((index, order) => `${order + 1}. ${segments[index]}`)
    .join("\n");

  let parsed: string[] | null = null;
  try {
    const result = await service.translate({
      text: numberedText,
      sourceLang: settings.sourceLanguage,
      targetLang: settings.targetLanguage,
      // 显示层剥掉行号: 面板看到的是纯译文增量, 不见编号协议噪声
      onProgress: onProgress
        ? (partial) => onProgress(stripNumberingForDisplay(partial))
        : undefined,
      // 术语表指令(如有)在前, 编号指令在后: 两者都是附加约束, 顺序不影响语义
      glossaryInstruction: glossaryInstruction
        ? `${glossaryInstruction}\n${NUMBERING_INSTRUCTION}`
        : NUMBERING_INSTRUCTION,
    });
    parsed = parseNumberedTranslations(result.text, missingIndexes.length);
  } catch {
    // 编号请求抛错: 不在此处消费错误, 回落整段路径重新走退避/故障转移
    return null;
  }
  if (!parsed) return null;
  const translations = parsed;

  // 新译文逐条入句子缓存: 键与查询一致(归一化句文本), 供下次单句重选直接命中
  const positionByIndex = new Map<number, number>();
  missingIndexes.forEach((index, order) => {
    positionByIndex.set(index, order);
    segmentCachePut(segmentKeyFor(engine, segments[index]), translations[order]);
  });
  const parts = segments.map((_, index) => {
    const cachedValue = cachedValues[index];
    if (cachedValue !== undefined) return cachedValue;
    return translations[positionByIndex.get(index) ?? 0];
  });
  return {
    text: assembleTranslations(parts, settings.targetLanguage),
    allCached: false,
  };
}

/**
 * 单引擎翻译尝试: 缓存 → 句子级记忆(可关) → 术语注入 → 流式翻译 → 残留二次修正 → 写缓存。
 * 术语/二次修正/缓存全部留在单引擎内部(缓存 key 已含 engineId),
 * 换引擎只是把这一整套原样重跑一遍。
 */
async function attemptTranslateWithEngine(
  engine: EngineConfig,
  secret: string,
  text: string,
  onProgress?: (partial: string) => void,
  disableMemory = false,
): Promise<string> {
  // 语言对取自设置单例, 消除硬编码死设置
  const settings = getSettings();
  // 会话级缓存先查: key 绑定引擎/模型/语言对/归一化原文, 换模型不吃旧结果,
  // 排版差异(换行/多空格)也不该吃不到缓存。
  // 命中时通过 onProgress 回放一次结果后直接返回, 不发任何请求
  const cacheKey = buildCacheKey(
    engine.id,
    engine.model,
    settings.sourceLanguage,
    settings.targetLanguage,
    normalizeForCache(text),
  );
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    onProgress?.(cached);
    return cached;
  }
  const service = new GPTService(engine);
  service.setApiKey(secret);
  // 术语锁定: 命中词条时把对照表作为附加指令传给 service; 空命中则跳过
  const glossaryEntries = data.glossary.matchAll(text);
  const glossaryInstruction =
    glossaryEntries.length > 0 ? buildGlossaryPrompt(glossaryEntries) : "";
  // 句子级记忆: 多句文本按句查缓存; 全命中 0 请求, 部分命中只发缺失句。
  // 导出等结构化场景由调用方传 disableMemory 关闭(编号路径会破坏 "## 标题" 类标记)
  const memory = disableMemory
    ? null
    : await trySegmentMemory(
        engine,
        service,
        text,
        glossaryInstruction,
        onProgress,
      );
  // 全命中: 结果已由缓存句拼出(已回放 onProgress), 写全键缓存后直接返回, 0 请求
  if (memory?.allCached) {
    cachePut(cacheKey, memory.text);
    return memory.text;
  }
  let finalText: string;
  if (memory) {
    finalText = memory.text;
  } else {
    const result = await service.translate({
      text,
      sourceLang: settings.sourceLanguage,
      targetLang: settings.targetLanguage,
      onProgress,
      glossaryInstruction,
    });
    finalText = result.text;
  }
  // 译后残留检测: 术语仍以英文出现在译文里时, 触发一次修正性二次请求,
  // prompt 尾部点名残留词条; 只重试一次且第二次结果无论有无改善都采用,
  // 避免死循环。onProgress 照常透传二次流, 面板看到的是修正过程。
  // (编号补齐路径与整段路径共享本段: 残留检测同样生效)
  if (glossaryEntries.length > 0) {
    const residual = residualTerms(finalText, glossaryEntries);
    if (residual.length > 0) {
      const retry = await service.translate({
        text,
        sourceLang: settings.sourceLanguage,
        targetLang: settings.targetLanguage,
        onProgress,
        glossaryInstruction: `${glossaryInstruction}\n注意: 上次译文中以下术语未按对照表翻译: ${residual.join(", ")}，本次必须使用表中译名`,
      });
      finalText = retry.text;
    }
  }
  // 仅成功结果入缓存; 失败不缓存, 下次调用仍走真实请求以便重试。
  // 缓存写入最终采用值(可能是二次修正结果)
  cachePut(cacheKey, finalText);
  return finalText;
}

/** 候选引擎确定后的元信息回调(engineName 供侧栏状态行, failover 表示非当前引擎) */
export interface EngineResolvedOptions {
  onEngineResolved?: (
    engineId: string,
    engineName: string,
    failover: boolean,
  ) => void;
  /**
   * 关闭句子级翻译记忆(默认开启): 导出等含结构标记("## 标题")的块必须关 —
   * 编号请求会把结构行当句子切走, 拼装后格式被破坏。
   */
  disableMemory?: boolean;
}

/**
 * 翻译入口(带自动故障转移): 当前引擎最终失败且错误可转移时, 按候选链换下一个
 * 已配置密钥的引擎整链重试; 连续 FAILOVER_STICKY_THRESHOLD 次被备用引擎救活后
 * 直接记住该引擎。无候选(全部未配置密钥)时抛原有中文配置错误。
 */
export async function translateText(
  text: string,
  onProgress?: (partial: string) => void,
  opts?: EngineResolvedOptions,
): Promise<string> {
  // 停用终闸: onShutdown 置 alive=false 后, 残余入口(菜单/快捷键/弹窗的
  // 迟到调用)一律拒绝发请求, 杜绝插件已停用还产生 API 计费
  if (!data.alive) throw new APIError("插件已停用", 500, ALIVE_GATE_CODE);
  const settings = getSettings();
  const active = getActiveEngine();
  if (!active) {
    // 中文报错并指引设置页: 无可用引擎属内部状态, 用 500 而非 401
    throw new APIError(
      "未配置可用引擎, 请在 Zotero 设置 → SmartTranslate 中检查引擎配置",
      500,
    );
  }
  const candidates = resolveCandidates(settings, active);
  if (candidates.length === 0) {
    throw new APIError(
      "未配置 API 密钥, 请在 Zotero 设置 → SmartTranslate 中为当前引擎填写 API Key",
      401,
    );
  }
  return runCandidateChain(
    active,
    candidates,
    (engine) =>
      attemptTranslateWithEngine(
        engine,
        getSecret(engine.id),
        text,
        onProgress,
        opts?.disableMemory === true,
      ),
    (engine, failover) =>
      opts?.onEngineResolved?.(engine.id, engine.name, failover),
  );
}

/** 单引擎原始补全尝试: raw| 缓存 → 直发 prompt(补全无术语注入) → 写缓存 */
async function attemptCompleteWithEngine(
  engine: EngineConfig,
  secret: string,
  prompt: string,
  glossaryInstruction?: string,
): Promise<string> {
  // raw| 前缀 + 引擎/模型/prompt; 补全无语言对, 五元组语言位以 "-" 占位
  const cacheKey = `raw|${buildCacheKey(engine.id, engine.model, "-", "-", prompt)}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  const service = new GPTService(engine);
  service.setApiKey(secret);
  const result = await service.complete({ prompt, glossaryInstruction });
  // 仅成功结果入缓存; 失败不缓存以便下次重试
  cachePut(cacheKey, result.text);
  return result.text;
}

/**
 * 原始补全通道: 直接把 prompt 发给当前引擎, 不套 engine.prompt 翻译模板,
 * 也不做中文跳过。供阅读助手等分析类任务使用, 术语对照表由调用方按需以
 * glossaryInstruction 传入。复用空密钥校验/GPTService 传输层(退避重试/
 * 1210 降级/thinking 关闭)与会话级缓存; 缓存 key 加 raw| 前缀与翻译缓存
 * 隔离, 避免同一段文本的分析结果与译文互相污染。
 * 故障转移与 translateText 同构(同一候选链/同一粘性计数), v1 不回调引擎元信息。
 */
export async function completeText(
  prompt: string,
  opts?: { glossaryInstruction?: string },
): Promise<string> {
  // 停用终闸: 与 translateText 同一口径, 阅读助手等残余入口一并拦下
  if (!data.alive) throw new APIError("插件已停用", 500, ALIVE_GATE_CODE);
  const settings = getSettings();
  const active = getActiveEngine();
  if (!active) {
    // 中文报错并指引设置页, 与 translateText 同一指引口径
    throw new APIError(
      "未配置可用引擎, 请在 Zotero 设置 → SmartTranslate 中检查引擎配置",
      500,
    );
  }
  const candidates = resolveCandidates(settings, active);
  if (candidates.length === 0) {
    throw new APIError(
      "未配置 API 密钥, 请在 Zotero 设置 → SmartTranslate 中为当前引擎填写 API Key",
      401,
    );
  }
  return runCandidateChain(
    active,
    candidates,
    (engine) =>
      attemptCompleteWithEngine(
        engine,
        getSecret(engine.id),
        prompt,
        opts?.glossaryInstruction,
      ),
  );
}
