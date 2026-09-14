/**
 * 翻译历史 — 供条目侧栏"历史"区回看与重翻(点击条目把原文/译文回填双框,
 * 不自动触发翻译; 目标是"刚翻过的段落想再翻/再对照"的高频回路)。
 *
 * 持久化: 整表 JSON 写入 pref smarttranslate.history(Zotero.Prefs 自动补
 * extensions.zotero. 前缀, 完整路径 extensions.zotero.smarttranslate.history,
 * 与 settings.ts 的 PREF_KEY 同一套前缀口径)。容量上限 HISTORY_CAPACITY 条,
 * 超出裁最旧; 单条原文长度上限 5000 字符, 超长不记录 — 防止单条 prefs 过大
 * 拖慢启动与每次翻译的读写。Zotero.Prefs 不可用(单测/早期启动)时持久化
 * 全部静默 no-op, 只保留内存态。
 *
 * [双 bundle 模块双实例] 本模块同时被打进主 bundle(经 data.ts, 负责记录)
 * 与 panel bundle(经 smart-panel.ts, 负责读取/清空), 两份 bundle 各有一份
 * 模块态。与 translate-store.ts 同一解法: 有状态实现打包成 API 对象, 首次
 * 调用时懒挂到 Zotero.SmartTranslate.history 桥上(??=, 谁先到谁注册),
 * 对外导出一律经 sharedApi() 转发 — 调用方拿到的永远是同一个实例,
 * 侧栏"清空"后主 bundle 不会把内存里的旧条目再写回 pref。
 * 不能在 import 时挂桥: index.ts 创建 Zotero.SmartTranslate 晚于模块加载。
 */

import { normalizeForCache } from "./sentence-memory";

/** 单条历史记录(time 为 epoch ms) */
export interface HistoryItem {
  source: string;
  result: string;
  engineName: string;
  time: number;
}

/** 历史容量上限: 超出裁最旧(新条目在头部) */
export const HISTORY_CAPACITY = 100;

/** 单条原文长度上限: 超长不记录, 防止单条 prefs 过大 */
const MAX_HISTORY_SOURCE_CHARS = 5000;

/**
 * 持久化 key: 传给 store 的短 key(Zotero.Prefs 自动补 extensions.zotero.
 * 前缀, 落到 extensions.zotero.smarttranslate.history)。
 */
export const HISTORY_PREF_KEY = "smarttranslate.history";

/**
 * 可注入的偏好存储抽象 — 生产环境经适配层走 Zotero.Prefs, 测试注入 fake。
 * get 返回 string | undefined(缺 pref 由适配层收窄), set 只收 string。
 */
export interface HistoryPrefsStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

// ---- 本模块实例的有状态实现(经 LOCAL_API 打包, 可被桥接管) ----

// 内存环形数组: 新条目在头部, 超容量裁尾
let items: HistoryItem[] = [];
// 显式注入的存储(null=清除注入回落默认); 未注入时运行期动态读 Zotero.Prefs
let injectedStore: HistoryPrefsStore | null = null;
let storeInjected = false;

function setHistoryPrefsStoreImpl(store: HistoryPrefsStore | null): void {
  injectedStore = store;
  storeInjected = true;
}

/**
 * 解析当前生效的存储: 显式注入优先; 未注入时把 Zotero.Prefs 适配成
 * string 存储(与 settings.ts 的 PrefsStore 既有写法一致) — 直接用
 * Zotero.Prefs, 不存在的 pref 由 Zotero.Prefs.get 抛错(实证主干 prefs.js:
 * getComplexValue 失败即 throw, 无默认值返回), 交给调用方 try/catch 兜住;
 * 返回值按 string 收窄, 其余类型视同缺失。Zotero.Prefs 缺失(单测/早期
 * 启动)返回 null。
 */
function resolveStore(): HistoryPrefsStore | null {
  if (storeInjected) return injectedStore;
  const prefs = (globalThis as any).Zotero?.Prefs;
  if (!prefs) return null;
  return {
    get(key: string): string | undefined {
      const value = prefs.get(key);
      return typeof value === "string" ? value : undefined;
    },
    set(key: string, value: string): void {
      prefs.set(key, value);
    },
  };
}

/** 每次变更后尝试持久化; 存储缺失或写失败静默 no-op(只保内存态) */
function persist(): void {
  try {
    resolveStore()?.set(HISTORY_PREF_KEY, JSON.stringify(items));
  } catch {
    /* 持久化失败保持内存态 */
  }
}

/**
 * 记录一条历史: 原文与译文分别经 normalizeForCache 同款空白归一后判空,
 * 空串不记录; 原文长度超 MAX_HISTORY_SOURCE_CHARS 不记录; 与首条原文
 * (归一后相等)同源时置顶替换首条(更新 result/engineName/time), 否则插入
 * 头部; 超容量裁尾; 每次变更尝试持久化(失败静默)。
 */
function recordHistoryImpl(
  source: string,
  result: string,
  engineName: string,
): void {
  const normalizedSource = normalizeForCache(source ?? "");
  if (!normalizedSource) return;
  const normalizedResult = normalizeForCache(result ?? "");
  if (!normalizedResult) return;
  // 长度按原文原样判(落盘的就是原文原样): 超长直接不记录
  if ((source ?? "").length > MAX_HISTORY_SOURCE_CHARS) return;
  const entry: HistoryItem = {
    source,
    result,
    engineName,
    time: Date.now(),
  };
  if (
    items.length > 0 &&
    normalizeForCache(items[0].source) === normalizedSource
  ) {
    // 与首条同源: 置顶替换, 不产生重复条目
    items[0] = entry;
  } else {
    items.unshift(entry);
  }
  if (items.length > HISTORY_CAPACITY) {
    items.length = HISTORY_CAPACITY;
  }
  persist();
}

/** 只读副本: 调用方改动不影响内部态 */
function getHistoryImpl(): HistoryItem[] {
  return items.map((item) => ({ ...item }));
}

/** 清空内存并尝试持久化(持久化失败不影响内存清空) */
function clearHistoryImpl(): void {
  items = [];
  persist();
}

/**
 * 启动时从 pref 恢复(覆盖式替换内存态): JSON 解析失败/形状非法/超容一律
 * 静默裁剪; 存储缺失或读取抛错时保持内存态不动。
 */
function loadHistoryFromPrefsImpl(): void {
  try {
    const blob = resolveStore()?.get(HISTORY_PREF_KEY);
    items = parseHistoryBlob(blob);
  } catch {
    /* 读取失败保持内存态 */
  }
}

/** 持久化 blob → 合法条目数组: 非 JSON/非数组/单条形状非法静默跳过, 超容裁剪 */
function parseHistoryBlob(blob: string | undefined): HistoryItem[] {
  if (typeof blob !== "string" || !blob) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: HistoryItem[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.source !== "string" || typeof item.result !== "string") {
      continue;
    }
    if (typeof item.time !== "number" || !Number.isFinite(item.time)) continue;
    out.push({
      source: item.source,
      result: item.result,
      engineName: typeof item.engineName === "string" ? item.engineName : "",
      time: item.time,
    });
    if (out.length >= HISTORY_CAPACITY) break;
  }
  return out;
}

// ---- 共享桥(决策见文件头"双 bundle 模块双实例") ----

/** 桥上注册的有状态 API 打包形态 */
interface HistoryApi {
  recordHistory(source: string, result: string, engineName: string): void;
  getHistory(): HistoryItem[];
  clearHistory(): void;
  loadHistoryFromPrefs(): void;
  setHistoryPrefsStore(store: HistoryPrefsStore | null): void;
}

// 本模块私有实例: 桥不可达时(单测/node 环境)的回落, 正常运行被桥覆盖
const LOCAL_API: HistoryApi = {
  recordHistory: recordHistoryImpl,
  getHistory: getHistoryImpl,
  clearHistory: clearHistoryImpl,
  loadHistoryFromPrefs: loadHistoryFromPrefsImpl,
  setHistoryPrefsStore: setHistoryPrefsStoreImpl,
};

/** 首次调用时把本实例懒挂到共享桥(??= 谁先到谁注册), 返回共享实例 */
function sharedApi(): HistoryApi {
  const bridge = (globalThis as any).Zotero?.SmartTranslate;
  if (bridge) {
    bridge.history ??= LOCAL_API;
    return bridge.history as HistoryApi;
  }
  return LOCAL_API;
}

// ---- 对外导出: 一律经共享实例转发(调用方无感, 与 getSharedStore 同风格) ----

/** 记录一条翻译历史(空串/超长不记录, 同源置顶替换; 细则见 recordHistoryImpl) */
export function recordHistory(
  source: string,
  result: string,
  engineName: string,
): void {
  sharedApi().recordHistory(source, result, engineName);
}

/** 全量历史(新→旧), 返回副本 */
export function getHistory(): HistoryItem[] {
  return sharedApi().getHistory();
}

/** 清空内存与持久化 */
export function clearHistory(): void {
  sharedApi().clearHistory();
}

/** 启动时从 pref 恢复(细则见 loadHistoryFromPrefsImpl) */
export function loadHistoryFromPrefs(): void {
  sharedApi().loadHistoryFromPrefs();
}

/** 注入/清除偏好存储(null=清除注入, 回落默认的 Zotero.Prefs 适配层) */
export function setHistoryPrefsStore(store: HistoryPrefsStore | null): void {
  sharedApi().setHistoryPrefsStore(store);
}
