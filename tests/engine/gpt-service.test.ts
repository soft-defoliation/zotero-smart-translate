import { describe, it, expect, vi, beforeEach } from "vitest";
import { GPTService } from "../../src/engine/gpt-service";
import type { EngineConfig } from "../../src/types";

vi.stubGlobal("fetch", vi.fn());

const base: EngineConfig = {
  id: "smart-engine1",
  name: "Engine 1",
  endPoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  model: "glm-4.6",
  temperature: 0.3,
  stream: false,
  prompt: "Translate ${sourceText} from ${langFrom} to ${langTo}.",
  customParams: "",
};

describe("GPTService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("should return translated text on success", async () => {
    (globalThis as any).fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "这是翻译结果" } }],
        usage: { completion_tokens: 5, prompt_tokens: 10, total_tokens: 15 },
      }),
    });
    const service = new GPTService(base);
    service.setApiKey("fake-key");
    const result = await service.translate({
      text: "ferroelectric",
      sourceLang: "en",
      targetLang: "zh-CN",
    });
    expect(result.text).toBe("这是翻译结果");
    expect(result.engineId).toBe(base.id);
  });

  it("空白密钥应在 fetch 之前抛中文 401 APIError", async () => {
    const service = new GPTService(base);
    service.setApiKey("   ");
    await expect(
      service.translate({
        text: "ferroelectric",
        sourceLang: "en",
        targetLang: "zh-CN",
      }),
    ).rejects.toMatchObject({ name: "APIError", statusCode: 401 });
    await expect(
      service.translate({
        text: "ferroelectric",
        sourceLang: "en",
        targetLang: "zh-CN",
      }),
    ).rejects.toThrow(/API 密钥/);
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it("请求体应携带 thinking disabled 以关闭智谱思考链", async () => {
    (globalThis as any).fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "译文" } }],
      }),
    });
    const service = new GPTService(base);
    service.setApiKey("fake-key");
    await service.translate({
      text: "ferroelectric",
      sourceLang: "en",
      targetLang: "zh-CN",
    });
    // 翻译轻任务关闭思考: 首字延迟从秒级降到亚秒
    const body = JSON.parse(
      (globalThis as any).fetch.mock.calls[0][1].body,
    ) as { thinking?: { type?: string } };
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("1210 模型不支持关思考时应移除 thinking 降级重试一次", async () => {
    const fetchMock = (globalThis as any).fetch;
    // 第一次: glm-5 系始终思考, 400 且 body 含 "1210"
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          '{"error":{"code":"1210"},"message":"该模型始终思考, 不支持关闭思考"}',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "降级译文" } }],
        }),
      });
    const service = new GPTService(base);
    service.setApiKey("fake-key");
    const result = await service.translate({
      text: "ferroelectric",
      sourceLang: "en",
      targetLang: "zh-CN",
    });
    expect(result.text).toBe("降级译文");
    // 降级恰好触发一次第二次调用
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 重试请求体已移除 thinking 字段
    const retryBody = JSON.parse(
      fetchMock.mock.calls[1][1].body,
    ) as { thinking?: unknown };
    expect(retryBody.thinking).toBeUndefined();
  });

  it("传 glossaryInstruction 时请求体 prompt 应含对照表文本且拼在尾部", async () => {
    (globalThis as any).fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "译文" } }],
      }),
    });
    const service = new GPTService(base);
    service.setApiKey("fake-key");
    const instruction =
      "\n\n术语对照表(译文中必须严格使用下列译名):\n- ferroelectric → 铁电";
    await service.translate({
      text: "ferroelectric",
      sourceLang: "en",
      targetLang: "zh-CN",
      glossaryInstruction: instruction,
    });
    const body = JSON.parse(
      (globalThis as any).fetch.mock.calls[0][1].body,
    ) as { messages: Array<{ content: string }> };
    const prompt = body.messages[0].content;
    expect(prompt).toContain("术语对照表(译文中必须严格使用下列译名):");
    expect(prompt).toContain("- ferroelectric → 铁电");
    // 对照表拼接在模板渲染结果尾部, 原模板指令在前
    expect(prompt).toBe("Translate ferroelectric from en to zh-CN." + instruction);
  });

  it("未传 glossaryInstruction 时 prompt 应保持模板渲染原样", async () => {
    (globalThis as any).fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "译文" } }],
      }),
    });
    const service = new GPTService(base);
    service.setApiKey("fake-key");
    await service.translate({
      text: "ferroelectric",
      sourceLang: "en",
      targetLang: "zh-CN",
    });
    const body = JSON.parse(
      (globalThis as any).fetch.mock.calls[0][1].body,
    ) as { messages: Array<{ content: string }> };
    expect(body.messages[0].content).toBe(
      "Translate ferroelectric from en to zh-CN.",
    );
  });
});
