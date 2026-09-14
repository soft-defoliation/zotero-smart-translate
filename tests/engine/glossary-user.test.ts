/**
 * 用户自定义术语表测试:
 * - parseUserGlossary 纯函数单元(正常行/注释/空行/缺 =/缺侧计数/首个 = 分割);
 * - mergeGlossaries 纯函数单元(同名覆盖不区分大小写/追加尾部/seeds 不变异);
 * - GlossaryManager.reset 重灌语义;
 * - data 级接线用例(风格照 glossary.test.ts/sentence-memory.test.ts:
 *   stub fetch + clearTranslateCache + initData/setSettings + rebuildGlossary),
 *   覆盖 initData 生效与设置变更后重建生效两条路径。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  FERROELECTRIC_GLOSSARY,
  GlossaryManager,
  mergeGlossaries,
  parseUserGlossary,
} from "../../src/engine/glossary";
import { clearTranslateCache } from "../../src/engine/cache";
import { setSecret, setSettings } from "../../src/engine/settings";
import { initData, rebuildGlossary, translateText } from "../../src/data";
import type { Settings } from "../../src/types";

describe("parseUserGlossary", () => {
  it("正常行解析为词条并 trim 两侧空白", () => {
    const { entries, errorLines } = parseUserGlossary(
      "ferroelectric = 铁电\n  P-E loop  =  P-E 回线  ",
    );
    expect(errorLines).toBe(0);
    expect(entries).toEqual([
      { en: "ferroelectric", zh: "铁电" },
      { en: "P-E loop", zh: "P-E 回线" },
    ]);
  });

  it("空行与 # 注释行跳过且不计入错误", () => {
    const { entries, errorLines } = parseUserGlossary(
      "\n# 这是注释\n   \nstrain = 应变\n",
    );
    expect(entries).toEqual([{ en: "strain", zh: "应变" }]);
    expect(errorLines).toBe(0);
  });

  it("缺 = 或任一侧为空计入 errorLines, 合法行仍生效", () => {
    const { entries, errorLines } = parseUserGlossary(
      "没有等号的行\n= 只有译文\n只有原文 =\npressure = 压强",
    );
    expect(entries).toEqual([{ en: "pressure", zh: "压强" }]);
    expect(errorLines).toBe(3);
  });

  it("按首个 = 分割: 译文中再含 = 不影响解析", () => {
    const { entries, errorLines } = parseUserGlossary("a = b = c");
    expect(errorLines).toBe(0);
    expect(entries).toEqual([{ en: "a", zh: "b = c" }]);
  });

  it("空文本返回空词表零错误", () => {
    expect(parseUserGlossary("")).toEqual({ entries: [], errorLines: 0 });
  });
});

describe("mergeGlossaries", () => {
  it("同名条目不区分大小写覆盖, 其余追加尾部, seeds 不变异", () => {
    const seeds = [...FERROELECTRIC_GLOSSARY];
    const merged = mergeGlossaries(seeds, [
      { en: "Pressure", zh: "压强" },
      { en: "mycorrhiza", zh: "菌根" },
    ]);
    // 覆盖发生在 seed 原位置, 保留用户的英文大小写与译名
    expect(merged.find((e) => e.en === "Pressure")?.zh).toBe("压强");
    expect(merged.some((e) => e.en === "pressure")).toBe(false);
    // 未命中 seed 的用户条目按书写顺序追加在尾部
    expect(merged[merged.length - 1]).toEqual({ en: "mycorrhiza", zh: "菌根" });
    // 长度 = 种子数 + 新增数; 传入的 seeds 数组未被改动
    expect(merged.length).toBe(FERROELECTRIC_GLOSSARY.length + 1);
    expect(seeds).toEqual(FERROELECTRIC_GLOSSARY);
    expect(seeds.find((e) => e.en === "pressure")?.zh).toBe("压力");
  });

  it("用户同名重复行只保留一条, 不产生重复追加", () => {
    const seeds: { en: string; zh: string }[] = [{ en: "strain", zh: "应变" }];
    const merged = mergeGlossaries(seeds, [
      { en: "Strain", zh: "应变1" },
      { en: "strain", zh: "应变2" },
    ]);
    // 同名用户行按后写覆盖先写, 且只在 seed 位置出现一次
    expect(merged).toEqual([{ en: "strain", zh: "应变2" }]);
  });

  it("空用户词表时返回与 seeds 等价的新数组", () => {
    const merged = mergeGlossaries(FERROELECTRIC_GLOSSARY, []);
    expect(merged).toEqual(FERROELECTRIC_GLOSSARY);
    expect(merged).not.toBe(FERROELECTRIC_GLOSSARY);
  });
});

describe("GlossaryManager reset", () => {
  it("reset 清空后可重新灌入, 其余 API 不受影响", () => {
    const manager = new GlossaryManager();
    manager.add({ en: "alpha", zh: "甲" });
    manager.reset();
    expect(manager.getTerms()).toEqual([]);
    manager.addMultiple([{ en: "beta", zh: "乙" }]);
    expect(manager.match("beta")).toBe("乙");
    expect(manager.match("alpha")).toBeNull();
  });
});

// data 级接线: 验证用户术语经 initData/rebuildGlossary 进入翻译请求 prompt
describe("translateText 用户术语接入", () => {
  beforeEach(() => {
    clearTranslateCache();
    initData(
      makeSettings({ userGlossary: "mycorrhiza = 菌根\npressure = 压强" }),
    );
    setSettings(makeSettings({ userGlossary: "mycorrhiza = 菌根\npressure = 压强" }));
    setSecret("smart-engine1", "valid-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("initData 后请求 prompt 应含用户术语且覆盖内置同名条目", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "菌根网络对压强有响应" } }],
      }),
    });

    const text = "The mycorrhiza network responds to pressure";
    const result = await translateText(text);
    // 单句无残留: 恰好一次请求
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBe("菌根网络对压强有响应");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      messages: Array<{ content: string }>;
    };
    // 用户词条进入对照表
    expect(body.messages[0].content).toContain("- mycorrhiza → 菌根");
    // 同名内置条目被用户译名覆盖(内置 "压力" 不再出现)
    expect(body.messages[0].content).toContain("- pressure → 压强");
    expect(body.messages[0].content).not.toContain("压力");
  });

  it("设置变更后 rebuildGlossary 应按新词表重建(旧用户词条消失)", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "格吕艾森参数很大" } }],
      }),
    });

    // 模拟设置保存路径(hooks.onPrefsChanged: 重读设置后重建词表)
    setSettings(makeSettings({ userGlossary: "gruneisen = 格吕艾森" }));
    rebuildGlossary();

    const result = await translateText("The gruneisen parameter is large");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBe("格吕艾森参数很大");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0].content).toContain("- gruneisen → 格吕艾森");
    // 旧设置中的词条已随 reset 消失, 不再进入对照表
    expect(body.messages[0].content).not.toContain("mycorrhiza");
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
