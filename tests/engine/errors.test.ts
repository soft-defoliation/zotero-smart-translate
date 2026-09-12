/**
 * 错误文案表与空密钥拦截测试。
 * data.translateText 的空密钥拦截发生在 fetch 之前, 直接注入设置即可触发, 无需 mock 网络。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ERROR_ZH, zhErrorMessage } from "../../src/engine/errors";
import { APIError, RateLimitError } from "../../src/engine/retry";
import { clearTranslateCache } from "../../src/engine/cache";
import { setSettings, setSecret } from "../../src/engine/settings";
import { translateText } from "../../src/data";
import type { Settings } from "../../src/types";

describe("ERROR_ZH", () => {
  it("应覆盖 400/401/403/404/429", () => {
    for (const code of [400, 401, 403, 404, 429]) {
      expect(typeof ERROR_ZH[code]).toBe("string");
      expect(ERROR_ZH[code].length).toBeGreaterThan(0);
    }
  });

  it("APIError 应按 status 查表", () => {
    const msg = zhErrorMessage(new APIError("HTTP 401: invalid key", 401));
    expect(msg).toContain(ERROR_ZH[401]);
    expect(msg).toContain("HTTP 401");
  });

  it("RateLimitError 应按 status 查表", () => {
    const msg = zhErrorMessage(new RateLimitError("HTTP 429: slow down", 429));
    expect(msg).toContain(ERROR_ZH[429]);
  });

  it("普通 Error 应直接取 message", () => {
    expect(zhErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("非 Error 值应回退通用文案", () => {
    expect(zhErrorMessage(undefined)).toContain("翻译失败");
  });
});

describe("translateText 空密钥拦截", () => {
  beforeEach(() => {
    setSettings(makeSettings());
    setSecret("smart-engine1", "");
  });

  it("空密钥应抛 401 APIError 且不发请求", async () => {
    await expect(translateText("hello")).rejects.toMatchObject({
      name: "APIError",
      statusCode: 401,
    });
    await expect(translateText("hello")).rejects.toThrow(/API 密钥/);
  });

  it("纯空白密钥也应拦截并抛中文错误", async () => {
    setSecret("smart-engine1", "   ");
    await expect(translateText("hello")).rejects.toMatchObject({
      name: "APIError",
      statusCode: 401,
    });
    await expect(translateText("hello")).rejects.toThrow(/API 密钥/);
  });
});

describe("translateText 语言对接通", () => {
  beforeEach(() => {
    // 五元组(engine/model/en/fr/hello)在两个用例间相同, 先清缓存防第二个用例吃到第一个的 cachePut 结果
    clearTranslateCache();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    }));
    setSettings(makeSettings("fr"));
    setSecret("smart-engine1", "valid-key");
  });

  it("targetLang 应取自设置的 targetLanguage 而非硬编码", async () => {
    await translateText("hello");
    const body = JSON.parse((globalThis as any).fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain("to fr");
  });

  it("sourceLang 应取自设置的 sourceLanguage", async () => {
    await translateText("hello");
    const body = JSON.parse((globalThis as any).fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain("from en");
  });
});

function makeSettings(targetLanguage = "zh-CN"): Settings {
  const engine = (id: string) => ({
    id,
    name: id,
    endPoint: "https://example.invalid/api",
    model: "glm-4.6",
    temperature: 0.3,
    stream: false,
    prompt: "Translate ${sourceText} from ${langFrom} to ${langTo}",
    customParams: "",
  });
  return {
    engine1: engine("smart-engine1"),
    engine2: engine("smart-engine2"),
    engine3: engine("smart-engine3"),
    activeEngineId: "smart-engine1",
    targetLanguage,
    sourceLanguage: "en",
  };
}
