import { describe, it, expect } from "vitest";
import {
  splitSections,
  mapPrompt,
  reducePrompt,
  innovationPrompt,
  methodPrompt,
  parseInnovations,
  parseMethods,
  checkBudget,
  METHOD_SCHEMA,
} from "../../src/reading/pipeline";

describe("Reading Pipeline", () => {
  const sample = "Introduction\n\nThis is intro text.\n\nMethods\n\nWe did experiments.\n\nResults\n\nResults are good.";

  it("splitSections returns segments", () => {
    const segs = splitSections(sample);
    const titles = segs.map((s) => s.title);
    expect(titles).toContain("Introduction");
    expect(titles).toContain("Methods");
  });

  it("mapPrompt joins sections with heading prefix", () => {
    const segs = splitSections(sample);
    const prompt = mapPrompt(segs);
    expect(prompt).toContain("## Introduction");
    expect(prompt).toContain("## Methods");
  });

  it("parseInnovations clips to 5", () => {
    const out = parseInnovations(
      Array.from({ length: 7 })
        .map((_, i) => `- item ${i}`)
        .join("\n"),
    );
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it("parseInnovations 应剥离加粗编号/短横/星号三类前缀", () => {
    // **1. 型(模型加粗输出): 前缀 **1. 与闭合 ** 都要剥净
    expect(parseInnovations("**1. 反铁电相变机制**")).toEqual([
      "反铁电相变机制",
    ]);
    // 普通短横与星号(既有行为回归)
    expect(parseInnovations("- 创新甲\n* 创新乙")).toEqual([
      "创新甲",
      "创新乙",
    ]);
  });

  it("parseMethods 应剥 ```json 围栏后解析", () => {
    const out = parseMethods(
      '```json\n{"composition": "KNbO3", "synthesis": "固相法"}\n```',
    );
    expect(out.composition).toBe("KNbO3");
    expect(out.synthesis).toBe("固相法");
  });

  it("parseMethods 应剥裸 ``` 围栏(无语言标记)后解析", () => {
    const out = parseMethods('```\n{"composition": "BaTiO3"}\n```');
    expect(out.composition).toBe("BaTiO3");
  });

  it("parseMethods 裸 JSON 既有行为不变", () => {
    const out = parseMethods('{"composition":"KNbO3"}');
    expect(out.composition).toBe("KNbO3");
  });

  it("parseMethods returns schema keys", () => {
    const out = parseMethods('{"composition":"KNbO3"}');
    expect(out.composition).toBe("KNbO3");
    for (const key of METHOD_SCHEMA) {
      expect(out[key]).toBeDefined();
    }
  });

  it("checkBudget reports estimated tokens", () => {
    const segs = splitSections(sample);
    const budget = checkBudget(segs, 100, 1000);
    expect(typeof budget.estimated).toBe("number");
    expect(budget.ok).toBe(true);
  });
});
