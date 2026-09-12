import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GlossaryManager,
  FERROELECTRIC_GLOSSARY,
  buildGlossaryPrompt,
  residualTerms,
} from "../../src/engine/glossary";
import {
  clearTranslateCache,
  buildCacheKey,
  cacheGet,
} from "../../src/engine/cache";
import { setSettings, setSecret } from "../../src/engine/settings";
import { data, initData, translateText } from "../../src/data";
import type { GlossaryEntry, Settings } from "../../src/types";

describe("Glossary", () => {
  it("should add and retrieve terms", () => {
    const manager = new GlossaryManager();
    manager.add({ en: "ferroelectric", zh: "铁电" });
    expect(manager.match("ferroelectric")).toBe("铁电");
  });

  it("should be case-insensitive", () => {
    const manager = new GlossaryManager();
    manager.add({ en: "antiferroelectric", zh: "反铁电" });
    expect(manager.match("Antiferroelectric")).toBe("反铁电");
  });

  it("FERROELECTRIC_GLOSSARY is non-empty", async () => {
    const { FERROELECTRIC_GLOSSARY } = await import("../../src/engine/glossary");
    expect(FERROELECTRIC_GLOSSARY.length).toBeGreaterThan(0);
  });
});

describe("matchAll", () => {
  it("含 antiferroelectric 的句子应命中反铁电条目且不被铁电误吞", () => {
    // 按种子原始顺序注入(ferroelectric 在前), 复现历史顺序 bug 场景
    const manager = new GlossaryManager();
    manager.addMultiple(FERROELECTRIC_GLOSSARY);
    const hits = manager.matchAll("The antiferroelectric phase was observed");
    // 长术语排首位: 不再被子串短术语按存储序抢先
    expect(hits[0]?.en).toBe("antiferroelectric");
    // 子串匹配语义下长词条命中时短词条同样命中, 两者都进对照表
    expect(hits.map((e) => e.en)).toContain("ferroelectric");
  });

  it("无命中时返回空数组", () => {
    const manager = new GlossaryManager();
    manager.add({ en: "ferroelectric", zh: "铁电" });
    expect(manager.matchAll("hello world")).toEqual([]);
  });
});

describe("buildGlossaryPrompt", () => {
  it("空数组应返回空串", () => {
    expect(buildGlossaryPrompt([])).toBe("");
  });

  it("应逐行拼接术语对照表", () => {
    const prompt = buildGlossaryPrompt([
      { en: "ferroelectric", zh: "铁电" },
      { en: "P-E loop", zh: "P-E 回线" },
    ]);
    expect(prompt).toContain("术语对照表(译文中必须严格使用下列译名):");
    expect(prompt).toContain("- ferroelectric → 铁电");
    expect(prompt).toContain("- P-E loop → P-E 回线");
  });
});

describe("residualTerms", () => {
  it("含正则元字符的词条不抛错且能检出残留", () => {
    // "P-E loop" 中的 "-" 是元字符, 裸 new RegExp 会误判/抛错
    const entries: GlossaryEntry[] = [{ en: "P-E loop", zh: "P-E 回线" }];
    expect(() => residualTerms("the P-E loop is narrow", entries)).not.toThrow();
    expect(residualTerms("the P-E loop is narrow", entries)).toEqual([
      "P-E loop",
    ]);
  });

  it("大小写不敏感, 已按译名翻译时不报残留", () => {
    const entries: GlossaryEntry[] = [{ en: "Ferroelectric", zh: "铁电" }];
    expect(residualTerms("铁电效应 ferroelectric", entries)).toEqual([
      "Ferroelectric",
    ]);
    expect(residualTerms("铁电效应", entries)).toEqual([]);
  });
});

// data 级接线用例: 风格参照 errors.test.ts 的 stub fetch + clearTranslateCache
describe("translateText 术语锁定接入", () => {
  beforeEach(() => {
    clearTranslateCache();
    // data.glossary 是模块级单例, 注入种子术语(重复调用由 matchAll 去重兜底)
    initData(makeSettings());
    setSettings(makeSettings());
    setSecret("smart-engine1", "valid-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("命中术语应携带对照表, 残留触发一次修正性二次请求且缓存存第二次结果", async () => {
    const fetchMock = (globalThis as any).fetch;
    // 第一次: 译文残留英文术语 ferroelectric, 应触发残留检测
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "the ferroelectric response" } }],
        }),
      })
      // 第二次: 按对照表给出正确译名
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "铁电响应" } }],
        }),
      });

    const text = "antiferroelectric and ferroelectric response";
    const result = await translateText(text);
    // 恰好两次请求: 初次 + 一次修正, 不做第三次
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 最终采用第二次结果(即使它仍不完美)
    expect(result).toBe("铁电响应");

    // 首次请求 prompt 尾部带术语对照表, 且长术语在前
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      messages: Array<{ content: string }>;
    };
    expect(firstBody.messages[0].content).toContain("术语对照表");
    expect(firstBody.messages[0].content).toContain(
      "- antiferroelectric → 反铁电",
    );

    // 二次请求 prompt 带残留警告点名行
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body) as {
      messages: Array<{ content: string }>;
    };
    expect(secondBody.messages[0].content).toContain(
      "注意: 上次译文中以下术语未按对照表翻译",
    );
    expect(secondBody.messages[0].content).toContain("ferroelectric");

    // 缓存写入的是第二次(最终采用)结果
    const key = buildCacheKey("smart-engine1", "glm-4.6", "en", "zh-CN", text);
    expect(cacheGet(key)).toBe("铁电响应");
  });

  it("无术语命中且无残留时应只发一次请求且 prompt 不带对照表", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "你好" } }] }),
    });
    const result = await translateText("hello world");
    expect(result).toBe("你好");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0].content).not.toContain("术语对照表");
  });
});

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
  };
}
