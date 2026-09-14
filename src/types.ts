/**
 * Shared types — single source of truth for engine/data/UI layers.
 * (Audit fix: previously GPTConfig/EngineConfig were referenced but never
 * defined here; esbuild masked the error. tsc --noEmit now gates builds.)
 */

export interface GPTConfig {
  endPoint: string;
  model: string;
  temperature: number;
  stream: boolean;
  prompt: string;
  customParams: string;
}

export interface EngineConfig extends GPTConfig {
  id: string;
  name: string;
}
export interface EngineConfigWithSecret extends EngineConfig {
  apiKey: string;
}

/**
 * 写回模式三态:
 * - off: 不写回(默认);
 * - note: 翻译成功后把译文追加到该文献的"SmartTranslate 收集"子笔记;
 * - note-bilingual: 追加原文 + 译文对照条目。
 * (批注评论路线依赖阅读器私有 API, 未验证, 已废弃, 见契约 20260910-12)
 */
export type WritebackMode = "off" | "note" | "note-bilingual";

/**
 * 翻译风格预设五态:
 * - standard: 标准(不追加风格指令, 保持历史行为, 默认);
 * - academic: 学术规范(术语准确/句式严谨/保留被动语态);
 * - literal: 直译(逐句忠实原文结构, 不意译不增删);
 * - fluent: 流畅(以目标语表达习惯为准, 可调整语序);
 * - custom: 自定义(使用 customPrompt 作为附加翻译指令)。
 * 仅作用于划词/标题摘要翻译路径; 阅读助手 completeText 不注入。
 */
export type TranslateStyle =
  | "standard"
  | "academic"
  | "literal"
  | "fluent"
  | "custom";

export interface Settings {
  engine1: EngineConfig;
  engine2: EngineConfig;
  engine3: EngineConfig;
  activeEngineId: string;
  targetLanguage: string;
  sourceLanguage: string;
  /** 选区弹窗 textarea 初始宽(px), 用户拖拽 resize 后持久化 */
  popupWidth: number;
  /** 选区弹窗 textarea 初始高(px), 用户拖拽 resize 后持久化 */
  popupHeight: number;
  /** 弹窗译文字体族枚举 key(system/yahei/simsun/kaiti/sourcehansans/sourcehanserif/custom) */
  fontFamily: string;
  /** fontFamily === "custom" 时生效的原始 CSS font-family 值 */
  fontCustom: string;
  /** 弹窗译文字号(px) */
  fontSize: number;
  /** 弹窗译文行高(倍) */
  lineHeight: number;
  /** 划词后自动翻译; false 时弹窗先显示"翻译"按钮等用户手动触发 */
  autoTranslate: boolean;
  /** 检测到选区主要是中文且目标语言为中文时跳过翻译(默认开启) */
  skipChinese: boolean;
  /** 引擎失败(429/401/403/5xx/网络错误)时自动换下一个已配置密钥的引擎重试, 默认开启 */
  autoFailover: boolean;
  /** 侧栏双栏原文框占比(0.2-0.8), 拖拽分隔条后持久化 */
  panelSplitRatio: number;
  /** 弹窗翻译成功后的写回模式(三态枚举, 默认 off 不写回) */
  writebackMode: WritebackMode;
  /**
   * 翻译风格预设(五态枚举, 默认 standard 不追加指令);
   * 仅注入划词/标题摘要翻译请求, 阅读助手 completeText 不注入
   */
  translateStyle: TranslateStyle;
  /** translateStyle === "custom" 时生效的自定义风格 prompt(默认空串) */
  customPrompt: string;
  /**
   * 用户自定义术语表原文(textarea 逐字持久化): 每行一条 "原文 = 译文",
   * # 开头为注释行; 同名条目(不区分大小写)覆盖内置铁电词表, 默认空串
   */
  userGlossary: string;
}

export interface GlossaryEntry {
  en: string;
  zh: string;
  domain?: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
}

export interface TokenBudget {
  maxTokens: number;
  warnThreshold: number;
}

export interface Segment {
  title: string;
  text: string;
  pageStart?: number;
}

export interface TranslationResult {
  text: string;
  engineId: string;
  ttfb?: number;
  tokens?: {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface ReadResult {
  summary: string;
  innovations: string[];
  methods: Record<string, string>;
}
