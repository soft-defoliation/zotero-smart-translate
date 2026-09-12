/**
 * GPT Service — OpenAI-compatible endpoint adapter
 */

import type { EngineConfig, TranslationResult } from "../types";
import { withRetry, RateLimitError, APIError } from "./retry";
import { ERROR_ZH } from "./errors";

export interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
  // 术语对照表附加指令(可选): 非空时拼接在模板 prompt 尾部, 由 data 层组装;
  // gpt-service 不感知术语来源与重试语义
  glossaryInstruction?: string;
  onProgress?: (partial: string) => void;
}

/**
 * 原始补全请求: prompt 即最终发送内容, 不经 engine.prompt 翻译模板渲染。
 * 供阅读助手等分析类任务走 completeText 通道使用, 与 translate 共享
 * 请求体构建/退避重试/1210 降级等全部传输层逻辑。
 */
export interface CompletionRequest {
  prompt: string;
  glossaryInstruction?: string;
  onProgress?: (partial: string) => void;
}

export class GPTService {
  constructor(private config: EngineConfig, private apiKey = "") {}

  get id(): string {
    return this.config.id;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  async translate(req: TranslationRequest): Promise<TranslationResult> {
    // 空密钥前置拦截: 杜绝 Authorization: Bearer "" 直发 401; trim 拦截纯空白
    if (!this.apiKey.trim()) {
      throw new APIError(ERROR_ZH[401], 401);
    }
    if (!this.config.endPoint) {
      throw new APIError("引擎未配置 endpoint", 400);
    }
    const prompt = this.config.prompt
      .replace("${langFrom}", req.sourceLang)
      .replace("${langTo}", req.targetLang)
      .replace("${sourceText}", req.text);
    // 术语对照表拼接在模板渲染结果尾部, 引导模型严格使用表中译名
    const fullPrompt = req.glossaryInstruction
      ? `${prompt}${req.glossaryInstruction}`
      : prompt;
    return this.sendCompletion(fullPrompt, req.onProgress);
  }

  async complete(req: CompletionRequest): Promise<TranslationResult> {
    // 空密钥前置拦截与 translate 同源, 保证两条通道行为一致
    if (!this.apiKey.trim()) {
      throw new APIError(ERROR_ZH[401], 401);
    }
    if (!this.config.endPoint) {
      throw new APIError("引擎未配置 endpoint", 400);
    }
    // 原始补全: 不套翻译模板, prompt(可选拼接对照表)即最终内容
    const fullPrompt = req.glossaryInstruction
      ? `${req.prompt}${req.glossaryInstruction}`
      : req.prompt;
    return this.sendCompletion(fullPrompt, req.onProgress);
  }

  /**
   * 共享传输层: 请求体构建(thinking 关闭)/流式或非流式解析/退避重试/
   * 1210 降级, translate 与 complete 两条通道全部经由此处发送。
   */
  private async sendCompletion(
    fullPrompt: string,
    onProgress?: (partial: string) => void,
  ): Promise<TranslationResult> {
    const start = Date.now();
    let firstByte = 0;

    // 用索引签名便于降级路径 delete thinking 字段(delete 要求可选属性)
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [{ role: "user", content: fullPrompt }],
      temperature: this.config.temperature,
      stream: this.config.stream,
      // 翻译是轻任务: 智谱 4.5+/4.6 系默认开思考, 会先烧完思维链才出首字;
      // 显式关闭后首字延迟从秒级降到亚秒, 且术语翻译质量不降
      thinking: { type: "disabled" },
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    const doFetch = async (): Promise<TranslationResult> => {
      const resp = await fetch(this.config.endPoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        // 消息前缀套用中文解释, 便于用户理解原始英文报错
        const zh = ERROR_ZH[resp.status] ?? "请求失败";
        throw new APIError(
          `${zh} (HTTP ${resp.status}: ${text.slice(0, 200)})`,
          resp.status,
          text,
        );
      }
      if (this.config.stream && resp.body) {
        return this.parseStream(resp, (t) => {
          if (!firstByte) firstByte = Date.now();
          onProgress?.(t);
        });
      }
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: TranslationResult["tokens"];
      };
      return {
        text: data.choices?.[0]?.message?.content ?? "",
        engineId: this.config.id,
        ttfb: Date.now() - start,
        tokens: data.usage,
      };
    };

    try {
      const result = await withRetry(doFetch, { maxAttempts: 3 });
      if (!firstByte) result.ttfb = Date.now() - start;
      else result.ttfb = firstByte - start;
      return result;
    } catch (e) {
      // 1210 自动降级: glm-5 系模型始终思考, 传 thinking 参数返回 400 且 body 含 "1210";
      // APIError 第三参已保留完整响应 body, 据此识别; 移除 thinking 后重试一次,
      // 降级后的调用仍走退避重试(429/5xx 照常处理), 若仍失败则照常抛出
      if (
        e instanceof APIError &&
        e.statusCode === 400 &&
        typeof e.code === "string" &&
        e.code.includes("1210")
      ) {
        delete body.thinking;
        const result = await withRetry(doFetch, { maxAttempts: 3 });
        if (!firstByte) result.ttfb = Date.now() - start;
        else result.ttfb = firstByte - start;
        return result;
      }
      throw e;
    }
  }

  private async parseStream(
    resp: Response,
    onChunk: (t: string) => void,
  ): Promise<TranslationResult> {
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const piece = obj.choices?.[0]?.delta?.content ?? "";
          if (piece) {
            full += piece;
            onChunk(full);
          }
        } catch {
          /* partial SSE frame, wait for more */
        }
      }
    }
    return { text: full, engineId: this.config.id };
  }
}

export { RateLimitError };
