import { describe, it, expect } from "vitest";
import { toBilingualMarkdown } from "../../src/engine/export-md";

describe("Export MD", () => {
  it("formats pairs with title and meta", () => {
    const md = toBilingualMarkdown("Export", [
      { source: "A", translation: "A'" },
      { source: "B", translation: "B'" },
    ], { engine: "e1", date: "2026-09-08" });
    expect(md).toContain("# Export");
    expect(md).toContain("A");
    expect(md).toContain("B'");
    expect(md).toContain("2026-09-08");
  });
});
