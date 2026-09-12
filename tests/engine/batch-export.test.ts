import { describe, it, expect } from "vitest";
import { BatchQueue, estimateTokens } from "../../src/engine/batch";
import { toBilingualMarkdown } from "../../src/engine/export-md";
import {
  buildBilingualAnnotation,
  concatAppend,
  concatTake,
  concatClear,
  getConcatState,
} from "../../src/ui/reader";

describe("Batch & Export", () => {
  it("estimateTokens returns number", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
  });

  it("toBilingualMarkdown formats pairs", () => {
    const md = toBilingualMarkdown("Export", [
      { source: "A", translation: "A'" },
      { source: "B", translation: "B'" },
    ]);
    expect(md).toContain("A");
    expect(md).toContain("B'");
  });

  it("concatAppend/Take/Clear roundtrip", () => {
    concatClear();
    concatAppend("alpha");
    concatAppend("beta");
    // 拼接块以换行分隔(句子级缓存按行还原边界), 不再是空格连接
    expect(concatTake()).toBe("alpha\nbeta");
    concatClear();
    expect(concatTake()).toBe("");
  });

  it("getConcatState 段数计数与清空", () => {
    concatClear();
    expect(getConcatState()).toEqual({ text: "", count: 0 });

    concatAppend("first selection");
    // 一段多词仍算一段: 段数只由拼接次数决定, 不按空白切分
    expect(getConcatState()).toEqual({ text: "first selection", count: 1 });

    concatAppend("second");
    expect(getConcatState()).toEqual({
      text: "first selection\nsecond",
      count: 2,
    });

    // 空/空白选区不并入也不计段
    concatAppend("   ");
    expect(getConcatState().count).toBe(2);

    // 翻译拼接取走后缓冲与段数同时清零
    expect(concatTake()).toBe("first selection\nsecond");
    expect(getConcatState()).toEqual({ text: "", count: 0 });

    // 清空同样清零, 回到普通模式
    concatAppend("x");
    concatClear();
    expect(getConcatState()).toEqual({ text: "", count: 0 });
  });

  it("buildBilingualAnnotation splits original/translation", () => {
    const out = buildBilingualAnnotation("source text", "译文");
    expect(out.text).toBe("source text");
    expect(out.comment).toBe("译文");
  });
});
