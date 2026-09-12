/**
 * Settings Manager — engine profiles + secretObj-compatible secrets.
 *
 * Secret format mirrors Translate for Zotero: a JSON object stored under
 * the `secretObj` pref keyed by service id. Our extensions simply add an
 * `apiKey` field on the engine object in memory, but persistence stays
 * split: settings in Zotero.Prefs, secrets in secretObj.
 */

import type { Settings, EngineConfig, WritebackMode } from "../types";

const ACADEMIC_PROMPT =
  'As an academic expert with specialized knowledge in various fields, please provide a proficient and precise translation from ${langFrom} to ${langTo} of the academic text enclosed in 📚. It is crucial to maintaining the original phrase or sentence and ensure accuracy while utilizing the appropriate language. The text is as follows:  📚 ${sourceText} 📚  Please provide the translated result without any additional explanation and remove 📚.';

function defaultEngine(id: string, name: string): EngineConfig {
  return {
    id,
    name,
    endPoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    // glm-4-flash 已弃用且术语不稳, 默认改用 glm-4.6
    model: "glm-4.6",
    temperature: 0.3,
    stream: true,
    prompt: ACADEMIC_PROMPT,
    customParams: "",
  };
}

const DEFAULT_SETTINGS: Settings = {
  engine1: defaultEngine("smart-engine1", "Engine 1"),
  engine2: defaultEngine("smart-engine2", "Engine 2"),
  engine3: defaultEngine("smart-engine3", "Engine 3"),
  activeEngineId: "smart-engine1",
  targetLanguage: "zh-CN",
  sourceLanguage: "en",
  popupWidth: 420,
  popupHeight: 120,
  fontFamily: "system",
  fontCustom: "",
  fontSize: 14,
  lineHeight: 1.6,
  autoTranslate: true,
  // 检测到中文跳过翻译: 默认开启, 目标语言为中文时省一次无意义请求
  skipChinese: true,
  // 自动故障转移: 默认开启, 当前引擎报错时换下一个已配置密钥的引擎重试
  autoFailover: true,
  // 侧栏双栏原文框占比: 默认对半(与设计稿 20260909-sidebar-design.md Token 一致)
  panelSplitRatio: 0.5,
  // 写回收集: 默认关闭, 避免未经用户同意往文献里塞笔记
  writebackMode: "off",
};

// 写回模式合法枚举(顺序即面板下拉顺序, 与 addon/prefs.xhtml 的 st-writeback 对齐)
const WRITEBACK_MODES: readonly WritebackMode[] = [
  "off",
  "note",
  "note-bilingual",
];

// 弹窗外观参数的合法区间(与设计稿 20260909-prefs-v2.md "控件默认值与范围"一致)
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 24;
const LINE_HEIGHT_MIN = 1.2;
const LINE_HEIGHT_MAX = 2.0;
// 弹窗 textarea 初始尺寸合法区间: 手动改 pref/异常数据写爆窗口时收敛
const POPUP_WIDTH_MIN = 280;
const POPUP_WIDTH_MAX = 800;
const POPUP_HEIGHT_MIN = 80;
const POPUP_HEIGHT_MAX = 600;

// 侧栏双栏占比合法区间(导出供 smart-panel 分隔条交互共用同一 clamp 边界)
export const PANEL_SPLIT_RATIO_MIN = 0.2;
export const PANEL_SPLIT_RATIO_MAX = 0.8;

// 数值夹取: 越界值收敛到边界, NaN/Infinity 由调用方先行拦截
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 字体族枚举 key → CSS font-family 栈(与设计稿"字体族枚举"表一致)
const FONT_FAMILY_STACKS: Record<string, string> = {
  system:
    '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  yahei: '"Microsoft YaHei", "PingFang SC", sans-serif',
  simsun: '"SimSun", "Songti SC", "Noto Serif CJK SC", serif',
  kaiti: '"KaiTi", "STKaiti", "Kaiti SC", serif',
  sourcehansans:
    '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  sourcehanserif: '"Source Han Serif SC", "Noto Serif CJK SC", "SimSun", serif',
};

/**
 * 弹窗译文字体栈解析纯函数: 枚举 key → font-family 栈字符串。
 * custom 取 fontCustom 的原始 CSS 值(空白视为未填);
 * 未知 key / custom 空值一律回落 system 栈。
 */
export function resolveFontFamily(settings: Settings): string {
  if (settings.fontFamily === "custom") {
    const custom =
      typeof settings.fontCustom === "string" ? settings.fontCustom.trim() : "";
    if (custom) return custom;
    return FONT_FAMILY_STACKS.system;
  }
  return FONT_FAMILY_STACKS[settings.fontFamily] ?? FONT_FAMILY_STACKS.system;
}

// Zotero bootstrap 沙箱没有 structuredClone, 用 JSON 往返实现深拷贝;
// 设置对象全部为纯 JSON 数据(无 Date/Map/undefined 语义), 往返无损
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Zotero.Prefs 自动加 extensions.zotero. 前缀, 与 prefsPrefix 对齐
const PREF_KEY = "smarttranslate.settings";
const SECRET_KEY = "smarttranslate.secretObj";

/**
 * 可注入的偏好存储抽象 — 生产环境传 Zotero.Prefs, 测试传 fake。
 */
export interface PrefsStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

let current: Settings = deepClone(DEFAULT_SETTINGS);
let secrets: Record<string, string> = {};
let prefsStore: PrefsStore | null = null;

/**
 * 绑定偏好存储并立即从 pref 加载(settings JSON 与 secretObj JSON)。
 * 解析失败静默回退默认值; 未绑定时保持纯内存态, 行为与历史版本一致。
 */
export function bindPrefs(store: PrefsStore): void {
  prefsStore = store;
  try {
    const blob = store.get(PREF_KEY);
    if (typeof blob === "string" && blob) {
      current = mergeSettings(JSON.parse(blob));
    } else {
      current = deepClone(DEFAULT_SETTINGS);
    }
  } catch {
    current = deepClone(DEFAULT_SETTINGS);
  }
  try {
    const blob = store.get(SECRET_KEY);
    if (typeof blob === "string" && blob) {
      const parsed: unknown = JSON.parse(blob);
      // 仅接受键值对象, 数组/原始值一律回退空表
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        secrets = parsed as Record<string, string>;
      } else {
        secrets = {};
      }
    } else {
      secrets = {};
    }
  } catch {
    secrets = {};
  }
}

/**
 * 用默认值兜底合并已存储的 settings JSON: 引擎对象逐键合并,
 * 语言标量字段仅接受 trim 后非空的字符串(否则保持默认值),
 * 防御半初始化的持久化数据。
 */
function mergeSettings(parsed: unknown): Settings {
  const merged = deepClone(DEFAULT_SETTINGS);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return merged;
  }
  const incoming = parsed as Record<string, unknown>;
  for (const key of ["engine1", "engine2", "engine3"] as const) {
    const v = incoming[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      merged[key] = { ...merged[key], ...(v as Partial<EngineConfig>) };
    }
  }
  if (typeof incoming.activeEngineId === "string") {
    merged.activeEngineId = incoming.activeEngineId;
  }
  // 纵深防御: 空串/空白串/非字符串一律不采纳, 保持 DEFAULT_SETTINGS 默认值,
  // 拦截 prefs-pane 等来源写出的半初始化数据
  const targetLang = incoming.targetLanguage;
  if (typeof targetLang === "string" && targetLang.trim()) {
    merged.targetLanguage = targetLang;
  }
  const sourceLang = incoming.sourceLanguage;
  if (typeof sourceLang === "string" && sourceLang.trim()) {
    merged.sourceLanguage = sourceLang;
  }
  // 弹窗尺寸: 有限数字夹取到 280-800 / 80-600, 非法(字符串/null/NaN/Infinity)
  // 回落默认 420/120 — 越界值(如拖拽异常回写的 99999)同样收敛, 防弹窗撑爆窗口
  const popupWidth = incoming.popupWidth;
  if (typeof popupWidth === "number" && Number.isFinite(popupWidth)) {
    merged.popupWidth = clampNumber(popupWidth, POPUP_WIDTH_MIN, POPUP_WIDTH_MAX);
  }
  const popupHeight = incoming.popupHeight;
  if (typeof popupHeight === "number" && Number.isFinite(popupHeight)) {
    merged.popupHeight = clampNumber(popupHeight, POPUP_HEIGHT_MIN, POPUP_HEIGHT_MAX);
  }
  // 字体族: 仅接受 trim 后非空的字符串(枚举合法性由 resolveFontFamily 回落兜底)
  const fontFamily = incoming.fontFamily;
  if (typeof fontFamily === "string" && fontFamily.trim()) {
    merged.fontFamily = fontFamily;
  }
  // 自定义字体: 仅接受字符串, 允许空串(空值由 resolveFontFamily 回落 system 栈)
  const fontCustom = incoming.fontCustom;
  if (typeof fontCustom === "string") {
    merged.fontCustom = fontCustom;
  }
  // 字号: 有限数字夹取到 10-24, 非法回落默认 14
  const fontSize = incoming.fontSize;
  if (typeof fontSize === "number" && Number.isFinite(fontSize)) {
    merged.fontSize = clampNumber(fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX);
  }
  // 行高: 有限数字夹取到 1.2-2.0, 非法回落默认 1.6
  const lineHeight = incoming.lineHeight;
  if (typeof lineHeight === "number" && Number.isFinite(lineHeight)) {
    merged.lineHeight = clampNumber(lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX);
  }
  // 自动翻译: 仅接受布尔, 非法回落默认 true(划词即译)
  const autoTranslate = incoming.autoTranslate;
  if (typeof autoTranslate === "boolean") {
    merged.autoTranslate = autoTranslate;
  }
  // 中文跳过: 仅接受布尔, 非法回落默认 true(检测到中文时跳过翻译)
  const skipChinese = incoming.skipChinese;
  if (typeof skipChinese === "boolean") {
    merged.skipChinese = skipChinese;
  }
  // 自动故障转移: 仅接受布尔, 非法回落默认 true(用户显式关掉才不转移)
  const autoFailover = incoming.autoFailover;
  if (typeof autoFailover === "boolean") {
    merged.autoFailover = autoFailover;
  }
  // 侧栏双栏占比: 有限数字夹取到 0.2-0.8, 非法回落默认 0.5
  const panelSplitRatio = incoming.panelSplitRatio;
  if (
    typeof panelSplitRatio === "number" &&
    Number.isFinite(panelSplitRatio)
  ) {
    merged.panelSplitRatio = clampNumber(
      panelSplitRatio,
      PANEL_SPLIT_RATIO_MIN,
      PANEL_SPLIT_RATIO_MAX,
    );
  }
  // 写回模式: 仅接受三态枚举内的字符串, 未知值/非字符串/旧版缺失一律回落默认 off
  const writebackMode = incoming.writebackMode;
  if (
    typeof writebackMode === "string" &&
    (WRITEBACK_MODES as readonly string[]).includes(writebackMode)
  ) {
    merged.writebackMode = writebackMode as WritebackMode;
  }
  return merged;
}

// 已绑定时把 settings 同步写回 pref; 写失败不阻断内存态
function flushSettings(): void {
  if (!prefsStore) return;
  try {
    prefsStore.set(PREF_KEY, JSON.stringify(current));
  } catch {
    /* pref 写入失败时保持内存态 */
  }
}

// 已绑定时把 secrets 同步写回 pref; 写失败不阻断内存态
function flushSecrets(): void {
  if (!prefsStore) return;
  try {
    prefsStore.set(SECRET_KEY, JSON.stringify(secrets));
  } catch {
    /* pref 写入失败时保持内存态 */
  }
}

export function getSettings(): Settings {
  return current;
}

export function setSettings(next: Settings): void {
  current = deepClone(next);
  flushSettings();
}

/**
 * 记忆选区弹窗尺寸 — 专用 setter: 只覆盖这两个字段后整体落盘,
 * 避免调用方拿旧快照走 setSettings 整写、并发覆盖其他字段。
 */
export function setPopupSize(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  current = { ...current, popupWidth: width, popupHeight: height };
  flushSettings();
}

/**
 * 记忆侧栏双栏占比 — 专用 setter: 只覆盖 panelSplitRatio 后整体落盘,
 * 同 setPopupSize 的理由, 避免调用方拿旧快照走 setSettings 整写。
 */
export function setPanelSplitRatio(ratio: number): void {
  if (!Number.isFinite(ratio)) return;
  current = {
    ...current,
    panelSplitRatio: clampNumber(
      ratio,
      PANEL_SPLIT_RATIO_MIN,
      PANEL_SPLIT_RATIO_MAX,
    ),
  };
  flushSettings();
}

export function getEngine(id: string): EngineConfig | undefined {
  return [current.engine1, current.engine2, current.engine3].find(
    (e) => e.id === id,
  );
}

export function setActiveEngine(id: string): void {
  if (getEngine(id)) {
    current.activeEngineId = id;
    flushSettings();
  }
}

export function getActiveEngine(): EngineConfig | undefined {
  return getEngine(current.activeEngineId);
}

export function getSecret(id: string): string {
  return secrets[id] ?? "";
}

export function setSecret(id: string, apiKey: string): void {
  secrets[id] = apiKey;
  flushSecrets();
}

export function serializeSecrets(): string {
  return JSON.stringify(secrets);
}

export function loadSecrets(blob: string): void {
  try {
    secrets = JSON.parse(blob);
  } catch {
    secrets = {};
  }
}
