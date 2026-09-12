/**
 * 句子级翻译记忆测试:
 * - 纯函数单元(切分/编号解析/拼装/归一化);
 * - data 级接线用例(风格照 errors.test.ts/glossary.test.ts: stub fetch +
 *   clearTranslateCache + initData + setSettings/setSecret), 覆盖
 *   首次编号请求 / 全键命中 0 请求 / 单句句子缓存命中 0 请求 / 解析失败回落整段。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MAX_MEMORY_SEGMENTS,
  MAX_MEMORY_SEGMENT_CHARS,
  NUMBERING_INSTRUCTION,
  assembleTranslations,
  normalizeForCache,
  parseNumberedTranslations,
  splitSentences,
  stripNumberingForDisplay,
} from "../../src/engine/sentence-memory";
import { clearTranslateCache } from "../../src/engine/cache";
import { setSecret, setSettings } from "../../src/engine/settings";
import { initData, translateText } from "../../src/data";
import type { Settings } from "../../src/types";

describe("normalizeForCache", () => {
  it("折叠所有空白并去首尾", () => {
    expect(normalizeForCache("  a\n b\t c  ")).toBe("a b c");
    expect(normalizeForCache("单   行")).toBe("单 行");
  });
});

describe("splitSentences", () => {
  it("多句英文按句末标点拆开", () => {
    expect(splitSentences("Hello world. This is a test. Another one here.")).toEqual([
      "Hello world.",
      "This is a test.",
      "Another one here.",
    ]);
    // 契约口径: 句末标点后须有空白才拆 — 中文句末紧跟下一句(无空格)不拆
    expect(splitSentences("这是第一句。这是第二句话！")).toEqual([
      "这是第一句。这是第二句话！",
    ]);
  });

  it("换行拼接串按行拆开(拼接缓冲以换行连接)", () => {
    expect(splitSentences("First sentence one.\nSecond sentence two.")).toEqual([
      "First sentence one.",
      "Second sentence two.",
    ]);
  });

  it("短于 8 字符的碎片并入前段", () => {
    expect(splitSentences("This is fine. Ok. And more text here.")).toEqual([
      "This is fine. Ok.",
      "And more text here.",
    ]);
  });

  it("单句返回原文单段(不强行拆)", () => {
    expect(splitSentences("Just one sentence.")).toEqual(["Just one sentence."]);
  });

  it("无标点长文本返回原文单段", () => {
    const text = "a very long text without any punctuation at all";
    expect(splitSentences(text)).toEqual([text]);
  });

  it("全空白返回原文单段", () => {
    expect(splitSentences("   ")).toEqual(["   "]);
  });
});

describe("parseNumberedTranslations", () => {
  it("正常编号逐行解析", () => {
    expect(parseNumberedTranslations("1. 甲\n2. 乙\n3. 丙", 3)).toEqual([
      "甲",
      "乙",
      "丙",
    ]);
    // 首部空行与中文顿号编号都容忍
    expect(parseNumberedTranslations("\n1、甲\n2、乙", 2)).toEqual(["甲", "乙"]);
  });

  it("围栏行被过滤", () => {
    expect(parseNumberedTranslations("```\n1. 甲\n2. 乙\n```", 2)).toEqual([
      "甲",
      "乙",
    ]);
  });

  it("未命中行作为上一句的续行合并", () => {
    expect(
      parseNumberedTranslations("1. 第一句\n换行续写内容\n2. 第二句", 2),
    ).toEqual(["第一句 换行续写内容", "第二句"]);
  });

  it("编号前出现杂项返回 null", () => {
    expect(
      parseNumberedTranslations("以下是翻译结果:\n1. 甲\n2. 乙", 2),
    ).toBeNull();
  });

  it("缺号或空句返回 null", () => {
    expect(parseNumberedTranslations("1. 甲\n3. 丙", 2)).toBeNull();
    expect(parseNumberedTranslations("1. 甲\n2. ", 2)).toBeNull();
    expect(parseNumberedTranslations("", 1)).toBeNull();
  });
});

describe("assembleTranslations", () => {
  it("中文目标语言无分隔符拼装", () => {
    expect(assembleTranslations(["你好。", "世界。"], "zh-CN")).toBe("你好。世界。");
  });

  it("非中文目标语言以空格拼装", () => {
    expect(assembleTranslations(["Hello.", "World."], "en")).toBe("Hello. World.");
  });

  it("空片段被丢弃", () => {
    expect(assembleTranslations(["甲", "", "  "], "zh")).toBe("甲");
  });
});

describe("stripNumberingForDisplay", () => {
  it("去掉行首编号保留译文", () => {
    expect(stripNumberingForDisplay("1. 甲\n2. 乙")).toBe("甲\n乙");
  });
});

describe("translateText 句子级记忆接入", () => {
  // 两句英文都短于编号阈值内的句数, 且不含种子术语(避免术语二次修正干扰计数)
  const multiText =
    "The cat sleeps on the mat. The dog runs in the park.";
  const firstSentence = "The cat sleeps on the mat.";

  beforeEach(() => {
    clearTranslateCache();
    initData(makeSettings());
    setSettings(makeSettings());
    setSecret("smart-engine1", "valid-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("首次多句文本发一次编号请求并返回拼装结果", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "1. 猫睡在垫子上。\n2. 狗在公园里跑。" } }],
      }),
    });

    const result = await translateText(multiText);
    // 恰好一次请求: 缺失句合并成一条编号请求, 不做整段请求
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      messages: Array<{ content: string }>;
    };
    // 请求体是编号文本 + 编号指令
    expect(body.messages[0].content).toContain("1. The cat sleeps on the mat.");
    expect(body.messages[0].content).toContain("2. The dog runs in the park.");
    expect(body.messages[0].content).toContain(NUMBERING_INSTRUCTION);
    // 中文目标语言无空格拼装
    expect(result).toBe("猫睡在垫子上。狗在公园里跑。");
  });

  it("同文本第二次全键命中 0 请求", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "1. 甲译文。\n2. 乙译文。" } }],
      }),
    });
    const first = await translateText(multiText);
    fetchMock.mockClear();

    const second = await translateText(multiText);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(second).toBe(first);
  });

  it("只选其中一句时句子缓存命中 0 请求", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "1. 猫睡在垫子上。\n2. 狗在公园里跑。" } }],
      }),
    });
    await translateText(multiText);
    fetchMock.mockClear();

    const single = await translateText(firstSentence);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(single).toBe("猫睡在垫子上。");
  });

  it("编号解析失败回落整段请求并返回整段结果", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock
      // 第一次(编号请求): 模型没按编号输出, 解析必然失败
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "没有编号的译文" } }] }),
      })
      // 第二次(整段回落): 正常给整段译文
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "整段回落译文" } }] }),
      });

    const result = await translateText(multiText);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      messages: Array<{ content: string }>;
    };
    expect(firstBody.messages[0].content).toContain("1. The cat sleeps on the mat.");
    // 回落请求发的是整段原文, 且不带编号指令
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body) as {
      messages: Array<{ content: string }>;
    };
    expect(secondBody.messages[0].content).toContain(multiText);
    expect(secondBody.messages[0].content).not.toContain(NUMBERING_INSTRUCTION);
    expect(result).toBe("整段回落译文");
  });

  it("disableMemory 时直接走整段请求", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "整段译文" } }] }),
    });
    const result = await translateText(multiText, undefined, {
      disableMemory: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0].content).toContain(multiText);
    expect(body.messages[0].content).not.toContain(NUMBERING_INSTRUCTION);
    expect(result).toBe("整段译文");
  });
});

describe("句子记忆常量", () => {
  it("与契约口径一致", () => {
    expect(MAX_MEMORY_SEGMENTS).toBe(30);
    expect(MAX_MEMORY_SEGMENT_CHARS).toBe(1000);
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
