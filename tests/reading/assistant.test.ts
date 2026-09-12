/**
 * 阅读助手链路测试:
 * - chunkSegments 分块纯函数;
 * - completeText 原始补全通道(prompt 直发/无翻译模板/thinking 关闭/raw| 缓存);
 * - runReadingAssistant map-reduce 全流程(调用数与 onProgress 步进)。
 * 风格参照 errors.test.ts: stub fetch + clearTranslateCache + 注入设置。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { chunkSegments, splitSections } from "../../src/reading/pipeline";
import { completeText, initData } from "../../src/data";
import { runReadingAssistant } from "../../src/reading/assistant";
import {
  clearTranslateCache,
  cacheGet,
  buildCacheKey,
} from "../../src/engine/cache";
import { setSettings, setSecret } from "../../src/engine/settings";
import { GlossaryManager } from "../../src/engine/glossary";
import type { Segment, Settings } from "../../src/types";

function makeSettings(): Settings {
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
    popupWidth: 420,
    popupHeight: 120,
    fontFamily: "system",
    fontCustom: "",
    fontSize: 14,
    lineHeight: 1.6,
    autoTranslate: true,
    skipChinese: true,
    panelSplitRatio: 0.5,
    writebackMode: "off",
  };
}

function seg(title: string, text: string): Segment {
  return { title, text };
}

describe("chunkSegments 分组纯函数", () => {
  it("按累计字符数分组, 累计超限开新组", () => {
    const segments = [seg("a", "1234"), seg("b", "1234"), seg("c", "1234")];
    expect(chunkSegments(segments, 10)).toEqual([
      [segments[0], segments[1]],
      [segments[2]],
    ]);
  });

  it("累计恰好等于上限不切分", () => {
    const segments = [seg("a", "12345"), seg("b", "12345")];
    expect(chunkSegments(segments, 10)).toEqual([[segments[0], segments[1]]]);
  });

  it("单段自身超限独立成组, 不与前后拼接", () => {
    const big = seg("big", "x".repeat(20));
    const small = seg("s", "y");
    expect(chunkSegments([big, small], 5)).toEqual([[big], [small]]);
  });

  it("空输入返回空数组, 组内保持原段序", () => {
    expect(chunkSegments([], 10)).toEqual([]);
    const segments = [seg("a", "1"), seg("b", "2")];
    const chunks = chunkSegments(segments, 100);
    expect(chunks).toEqual([segments]);
  });
});

describe("completeText 原始补全通道", () => {
  beforeEach(() => {
    clearTranslateCache();
    initData(makeSettings());
    setSettings(makeSettings());
    setSecret("smart-engine1", "valid-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("应直发原始 prompt, 不套翻译模板且 thinking 关闭", async () => {
    (globalThis as any).fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "分析结果" } }],
      }),
    });
    const prompt = "请总结这段文本: ferroelectric 效应";
    const out = await completeText(prompt);
    expect(out).toBe("分析结果");
    const body = JSON.parse(
      (globalThis as any).fetch.mock.calls[0][1].body,
    ) as {
      messages: Array<{ content: string }>;
      thinking?: { type?: string };
    };
    // messages[0].content 就是 prompt 本身, 无翻译模板痕迹
    expect(body.messages[0].content).toBe(prompt);
    expect(body.messages[0].content).not.toContain("Translate");
    // thinking 关闭同翻译链
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("缓存 key 应带 raw| 前缀, 命中后不再发请求", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "结果甲" } }],
      }),
    });
    const prompt = "原始分析指令二";
    await completeText(prompt);
    // 与 data.ts 同一组装方式: raw| 前缀 + 五元组(语言位 "-" 占位)
    const key = `raw|${buildCacheKey("smart-engine1", "glm-4.6", "-", "-", prompt)}`;
    expect(key.startsWith("raw|")).toBe(true);
    expect(cacheGet(key)).toBe("结果甲");
    // 同 prompt 二次调用走缓存, 不发第二次请求
    const again = await completeText(prompt);
    expect(again).toBe("结果甲");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("传 glossaryInstruction 时应拼接在 prompt 尾部", async () => {
    (globalThis as any).fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "结果" } }],
      }),
    });
    const instruction =
      "\n\n术语对照表(译文中必须严格使用下列译名):\n- ferroelectric → 铁电";
    const prompt = "分析指令";
    await completeText(prompt, { glossaryInstruction: instruction });
    const body = JSON.parse(
      (globalThis as any).fetch.mock.calls[0][1].body,
    ) as { messages: Array<{ content: string }> };
    expect(body.messages[0].content).toBe(prompt + instruction);
  });

  it("空密钥应前置拦截并抛中文 401", async () => {
    setSecret("smart-engine1", "");
    await expect(completeText("任何指令")).rejects.toMatchObject({
      name: "APIError",
      statusCode: 401,
    });
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });
});

describe("runReadingAssistant map-reduce 流程", () => {
  beforeEach(() => {
    clearTranslateCache();
    setSettings(makeSettings());
    setSecret("smart-engine1", "valid-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("多块文本应逐块 map + reduce 汇总 + 创新/方法逐块提取", async () => {
    const fetchMock = (globalThis as any).fetch;
    // 依序返回: 块1摘要, 块2摘要, reduce 汇总, 块1创新, 块2创新, 块1方法, 块2方法
    const scripted = [
      "块一摘要",
      "块二摘要",
      "整体摘要",
      "- 创新一\n- 创新二",
      "- 创新一\n- 创新三",
      '{"composition":"Na0.5Bi0.5TiO3"}',
      '{"synthesis":"固相烧结"}',
    ];
    fetchMock.mockImplementation(() => {
      const content = scripted.shift() ?? "";
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content } }] }),
      });
    });
    const steps: Array<[string, number]> = [];
    // 两个 30 字符段, chunkMaxChars=35 使其分属两块
    const text = [
      "Introduction",
      "",
      "A".repeat(30),
      "",
      "Methods",
      "",
      "B".repeat(30),
    ].join("\n");
    const result = await runReadingAssistant({
      text,
      glossary: new GlossaryManager(),
      maxTokens: 100000,
      chunkMaxChars: 35,
      onProgress: (step, frac) => steps.push([step, frac]),
    });
    // 2 次 map + 1 次 reduce + 2 次创新 + 2 次方法 = 7 次请求
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(result.summary).toBe("整体摘要");
    // 跨块创新点去重合并
    expect(result.innovations).toEqual(["创新一", "创新二", "创新三"]);
    // 方法逐块合并: 同键取首个非未提及值, schema 键序保持
    expect(result.methods.composition).toBe("Na0.5Bi0.5TiO3");
    expect(result.methods.synthesis).toBe("固相烧结");
    expect(result.methods.characterization).toBe("未提及");
    // onProgress 步进: 每阶段逐块 i/n, 结尾 done
    expect(steps).toEqual([
      ["summary", 0.5],
      ["summary", 1],
      ["innovations", 0.5],
      ["innovations", 1],
      ["methods", 0.5],
      ["methods", 1],
      ["done", 1],
    ]);
    // 首个请求应是块 1 的 map 摘要指令(含分节标题)
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      messages: Array<{ content: string }>;
    };
    expect(firstBody.messages[0].content).toContain("## Introduction");
  });

  it("单块文本应跳过 reduce 直接采用该块摘要", async () => {
    const fetchMock = (globalThis as any).fetch;
    // 单块: map 摘要 + 创新 + 方法 = 3 次请求
    const scripted = ["单块摘要", "- 唯一创新", '{"composition":"ABC"}'];
    fetchMock.mockImplementation(() => {
      const content = scripted.shift() ?? "";
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content } }] }),
      });
    });
    const result = await runReadingAssistant({
      text: "Abstract\n\n短文本",
      glossary: new GlossaryManager(),
      maxTokens: 100000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.summary).toBe("单块摘要");
    expect(result.innovations).toEqual(["唯一创新"]);
  });

  it("单块超预算应自动对半再切一次", async () => {
    const fetchMock = (globalThis as any).fetch;
    const scripted = [
      "前半摘要",
      "后半摘要",
      "汇总",
      "- 甲",
      "- 乙",
      "{}",
      "{}",
    ];
    fetchMock.mockImplementation(() => {
      const content = scripted.shift() ?? "";
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content } }] }),
      });
    });
    // 单段 200 字符 ≈ 50 token, maxTokens=20 触发对半 → 2 个块
    const result = await runReadingAssistant({
      text: "Methods\n\n" + "C".repeat(200),
      glossary: new GlossaryManager(),
      maxTokens: 20,
      onProgress: () => {},
    });
    // 对半后 2 块: map x2 + reduce x1 + 创新 x2 + 方法 x2 = 7 次
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(result.summary).toBe("汇总");
    // 虚拟段标题带对半序号, 证明确实切了两半
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      messages: Array<{ content: string }>;
    };
    expect(firstBody.messages[0].content).toContain("Methods (1/2)");
  });

  it("空文本应抛中文错误", async () => {
    await expect(
      runReadingAssistant({
        text: "   ",
        glossary: new GlossaryManager(),
        maxTokens: 1000,
      }),
    ).rejects.toThrow(/全文内容为空/);
  });
});

// splitSections 在新流程中仍是切分入口, 保留一条冒烟断言防回归
describe("splitSections 冒烟", () => {
  it("应按标题切出分段", () => {
    const segs = splitSections("Introduction\n\n正文甲\n\nMethods\n\n正文乙");
    expect(segs.map((s) => s.title)).toContain("Introduction");
    expect(segs.map((s) => s.title)).toContain("Methods");
  });
});
