/**
 * 翻译风格预设测试:
 * - buildStyleInstruction 纯函数单元(五分支 + 未知枚举防御);
 * - data 级接线用例(风格照 glossary.test.ts/sentence-memory.test.ts:
 *   stub fetch + clearTranslateCache + initData + setSettings/setSecret),
 *   验证 literal/custom 注入请求 prompt、standard 不注入。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildStyleInstruction, initData, translateText } from "../../src/data";
import { clearTranslateCache } from "../../src/engine/cache";
import { setSecret, setSettings } from "../../src/engine/settings";
import type { Settings, TranslateStyle } from "../../src/types";

describe("buildStyleInstruction", () => {
  it("standard 返回空串(保持历史行为, 不追加任何指令)", () => {
    expect(buildStyleInstruction("standard", "")).toBe("");
  });

  it("academic/literal/fluent 返回各自的中文风格指令", () => {
    const academic = buildStyleInstruction("academic", "");
    const literal = buildStyleInstruction("literal", "");
    const fluent = buildStyleInstruction("fluent", "");
    expect(academic).toContain("学术");
    expect(academic).toContain("被动语态");
    expect(literal).toContain("直译");
    expect(fluent).toContain("流畅");
    // 各风格指令互不相同且均以统一前缀开头, 便于测试与 prompt 定位
    expect(new Set([academic, literal, fluent]).size).toBe(3);
    expect(academic.startsWith("翻译风格要求:")).toBe(true);
    expect(literal.startsWith("翻译风格要求:")).toBe(true);
    expect(fluent.startsWith("翻译风格要求:")).toBe(true);
  });

  it("custom 返回 trim 后的 customPrompt, 空白回落空串", () => {
    expect(buildStyleInstruction("custom", "  使用文言文翻译  ")).toBe(
      "使用文言文翻译",
    );
    expect(buildStyleInstruction("custom", "   ")).toBe("");
    expect(buildStyleInstruction("custom", "")).toBe("");
  });

  it("未知枚举(脏数据)防御性回落空串", () => {
    expect(buildStyleInstruction("no-such" as TranslateStyle, "")).toBe("");
  });
});

// data 级接线: 风格指令与术语对照表同级拼接进翻译请求
describe("translateText 风格注入", () => {
  // 单句且不含内置种子术语: 走整段路径, 恰好一次请求
  const text = "The sample was heated slowly.";

  beforeEach(() => {
    clearTranslateCache();
    initData(makeSettings());
    setSettings(makeSettings());
    setSecret("smart-engine1", "valid-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("literal 时请求 prompt 含直译风格指令", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "样品被缓慢加热。" } }],
      }),
    });

    setSettings(makeSettings({ translateStyle: "literal" }));
    const result = await translateText(text);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBe("样品被缓慢加热。");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0].content).toContain("翻译风格要求");
    expect(body.messages[0].content).toContain("直译");
  });

  it("standard 时请求 prompt 不含风格指令(历史行为不变)", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "样品被缓慢加热。" } }],
      }),
    });

    setSettings(makeSettings({ translateStyle: "standard" }));
    await translateText(text);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0].content).not.toContain("翻译风格要求");
  });

  it("custom 时请求 prompt 含用户输入的自定义 prompt", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "样品缓缓受热。" } }],
      }),
    });

    setSettings(
      makeSettings({ translateStyle: "custom", customPrompt: "  使用文言文翻译  " }),
    );
    await translateText(text);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0].content).toContain("使用文言文翻译");
    expect(body.messages[0].content).not.toContain("翻译风格要求");
  });
});

function makeSettings(overrides: Partial<Settings> = {}): Settings {
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
    targetLanguage: "zh-CN",
    sourceLanguage: "en",
    translateStyle: "standard",
    customPrompt: "",
    userGlossary: "",
    ...overrides,
  };
}
