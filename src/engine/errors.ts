/**
 * 错误文案表 — 将 HTTP 状态码与常见失败翻译为用户可读的中文提示。
 * UI 层（菜单/面板）统一经 zhErrorMessage 取文案, 不再向用户暴露原始英文报错。
 */

import { APIError, RateLimitError } from "./retry";

/** HTTP 状态码 -> 中文解释 */
export const ERROR_ZH: Record<number, string> = {
  400: "请求参数有误, 请检查模型名与请求参数配置",
  401: "API 密钥无效或未填写, 请在 Zotero 设置 → SmartTranslate 中检查",
  403: "无访问权限, 请确认该 API Key 是否有效或已开通对应模型",
  404: "接口地址不存在, 请检查 Endpoint 是否填写正确",
  429: "请求过于频繁或配额已用尽, 请稍后重试",
};

/** 网络失败文案（fetch 抛错/断网/DNS 失败等） */
export const ERR_NETWORK_ZH = "网络请求失败, 请检查网络连接或 Endpoint 是否可达";

/** 请求超时文案 */
export const ERR_TIMEOUT_ZH = "请求超时, 请稍后重试或缩短待翻译文本";

/** 取消态的简短中性文案: UI 状态行据此识别并按非错误样式渲染 */
export const CANCELLED_MESSAGE = "已取消";

/**
 * 用户主动取消(点"停止"/新一轮翻译接管): data 层把 AbortError 统一转成
 * 本类型上抛, UI 层按中性文案呈现, 不走红色错误样式。
 */
export class CancelledError extends Error {
  constructor(message = "翻译已取消") {
    super(message);
    this.name = "CancelledError";
  }
}

/**
 * 全部引擎都未配置 API 密钥时的引导型错误。
 * message 沿用历史中文文案(行为兼容), UI 层据此文案识别并渲染
 * "打开设置"入口。
 */
export const NO_KEY_MESSAGE =
  "未配置 API 密钥, 请在 Zotero 设置 → SmartTranslate 中为当前引擎填写 API Key";

export class NoKeyError extends Error {
  constructor(message = NO_KEY_MESSAGE) {
    super(message);
    this.name = "NoKeyError";
  }
}

/**
 * 把任意抛出的错误转换为适合弹窗展示的中文消息。
 * - CancelledError: 固定简短中性文案"已取消"(不按错误呈现)
 * - NoKeyError: 返回原文案(历史中文文案, 引导用户去设置页)
 * - APIError/RateLimitError: 按 statusCode 查 ERROR_ZH, 命中则附加原始 detail
 * - 其他 Error: 直接取 message
 * - 兜底: 通用文案
 */
export function zhErrorMessage(e: unknown): string {
  if (e instanceof CancelledError) return CANCELLED_MESSAGE;
  if (e instanceof NoKeyError) return e.message;
  if (e instanceof APIError || e instanceof RateLimitError) {
    const zh = e.statusCode !== undefined ? ERROR_ZH[e.statusCode] : undefined;
    const detail = e.message?.trim();
    if (zh) return detail ? `${zh} (${detail})` : zh;
    return detail || "翻译失败, 请稍后重试";
  }
  if (e instanceof Error && e.message.trim()) return e.message;
  return "翻译失败, 请稍后重试";
}
