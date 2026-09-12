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

/**
 * 把任意抛出的错误转换为适合弹窗展示的中文消息。
 * - APIError/RateLimitError: 按 statusCode 查 ERROR_ZH, 命中则附加原始 detail
 * - 其他 Error: 直接取 message
 * - 兜底: 通用文案
 */
export function zhErrorMessage(e: unknown): string {
  if (e instanceof APIError || e instanceof RateLimitError) {
    const zh = e.statusCode !== undefined ? ERROR_ZH[e.statusCode] : undefined;
    const detail = e.message?.trim();
    if (zh) return detail ? `${zh} (${detail})` : zh;
    return detail || "翻译失败, 请稍后重试";
  }
  if (e instanceof Error && e.message.trim()) return e.message;
  return "翻译失败, 请稍后重试";
}
