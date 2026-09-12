/**
 * 批量翻译导出测试:
 * - sanitizeFileName 纯函数(非法字符/长度/空串三态);
 * - buildItemMarkdown 纯函数(pairs 顺序 + 标题与元信息);
 * - runBatchExport 全链路(注入 fake pickFolder/writeFile/translate, 不触网):
 *   多条目多块落盘、单条目失败不阻断、取消选夹零调用、无全文条目跳过。
 * 进度窗用最小 fake 模拟(真实 Zotero ProgressWindow 行为归 tester 真机验证)。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  BATCH_CONCURRENCY,
  buildItemMarkdown,
  runBatchExport,
  sanitizeFileName,
} from "../../src/reading/batch-export";

/** 最小进度行 fake: 只记录当前文案 */
class FakeLine {
  constructor(public text: string) {}
  setText(text: string): void {
    this.text = text;
  }
}

/**
 * 最小进度窗 fake: 记录 headline/所有行/关闭计时器。
 * ItemProgress 是 createProgressLine 建可更新行的唯一入口(见
 * src/reading/progress-line.ts): 生产代码不再用 addLines 的返回值,
 * 因此它建的行同样进 lines 集合, lines[0] 即最先建立的摘要行。
 */
class FakeProgressWindow {
  static instances: FakeProgressWindow[] = [];
  headline = "";
  lines: FakeLine[] = [];
  closeTimer: number | null = null;
  shown = false;
  /** 可更新行构造器: new pw.ItemProgress(icon, text) */
  ItemProgress: new (_icon: string, text: string) => FakeLine;

  constructor(_options?: unknown) {
    FakeProgressWindow.instances.push(this);
    // 行集合按建立顺序共享: ItemProgress 建的行与 addLines 的行同列
    const lines = this.lines;
    this.ItemProgress = class extends FakeLine {
      constructor(_icon: string, text: string) {
        super(text);
        lines.push(this);
      }
    };
  }
  show(): boolean {
    this.shown = true;
    return true;
  }
  changeHeadline(text: string): void {
    this.headline = text;
  }
  addLines(text: string): FakeLine {
    const line = new FakeLine(text);
    this.lines.push(line);
    return line;
  }
  startCloseTimer(ms: number): void {
    this.closeTimer = ms;
  }

  /** 最后建立的进度窗(每个用例只跑一次导出) */
  static latest(): FakeProgressWindow {
    return FakeProgressWindow.instances[FakeProgressWindow.instances.length - 1];
  }
}

let attachmentSeq = 0;

/** fake 条目: getAttachments 返回 fake PDF 附件, attachmentText 直返预置全文 */
function makeItem(title: string, fullText: string) {
  attachmentSeq += 1;
  const attachment: any = {
    id: attachmentSeq,
    attachmentContentType: "application/pdf",
    attachmentText: Promise.resolve(fullText),
  };
  const item: any = {
    parentID: undefined,
    isRegularItem: () => true,
    isAttachment: () => false,
    getField: (field: string) => (field === "title" ? title : ""),
    getAttachments: () => [attachment.id],
  };
  return { item, attachment };
}

/** fake Zotero: 只提供导出链路用到的 Items.get / ProgressWindow / File */
function makeFakeZotero(attachments: any[]) {
  const byId = new Map<number, any>(
    attachments.map((a) => [a.id, a] as [number, any]),
  );
  return {
    Items: { get: (id: number) => byId.get(id) },
    ProgressWindow: FakeProgressWindow,
    File: { putContentsAsync: async () => {} },
  };
}

/** 造 2 段各 6000 字符的全文: 上限 10000 的 chunkSegments 会切成 2 块 */
function twoChunkText(tag: string): string {
  return `Abstract\n${tag.repeat(6000)}\nIntroduction\n${tag.repeat(6000)}`;
}

/** 摘要行文本: createProgressLine 最先建立的行的文案(建行后由 setText 更新) */
function summaryText(): string {
  return FakeProgressWindow.latest().lines[0].text;
}

beforeEach(() => {
  FakeProgressWindow.instances = [];
});

describe("sanitizeFileName", () => {
  it("非法字符统一替换为下划线", () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("超长标题截断到 80 字符", () => {
    expect(sanitizeFileName("x".repeat(200))).toHaveLength(80);
  });

  it("空串/纯空白/纯点 回退 untitled", () => {
    expect(sanitizeFileName("")).toBe("untitled");
    expect(sanitizeFileName("   ")).toBe("untitled");
    expect(sanitizeFileName("...")).toBe("untitled");
  });

  it("去首尾空白与点", () => {
    expect(sanitizeFileName("  标题. ")).toBe("标题");
  });
});

describe("buildItemMarkdown", () => {
  it("块与译文按序配对, 标题与元信息进 markdown", () => {
    const md = buildItemMarkdown(
      "Paper X",
      ["src-1", "src-2"],
      ["译-1", "译-2"],
      { engine: "glm-4.6", date: "2026-09-10" },
    );
    expect(md).toContain("# Paper X");
    expect(md).toContain("glm-4.6");
    expect(md).toContain("2026-09-10");
    expect(md.indexOf("src-1")).toBeGreaterThan(-1);
    expect(md.indexOf("src-2")).toBeGreaterThan(md.indexOf("src-1"));
    expect(md).toContain("> 译-1");
    expect(md).toContain("> 译-2");
    expect(md.indexOf("> 译-1")).toBeGreaterThan(md.indexOf("src-1"));
  });

  it("译文缺项以空串占位, 不抛错", () => {
    const md = buildItemMarkdown("Paper Y", ["only-source"], []);
    expect(md).toContain("# Paper Y");
    expect(md).toContain("only-source");
  });
});

describe("runBatchExport 全链路", () => {
  it("2 条目 x 2 块: 落盘 2 个 md, 内容含标题与对应译文, 并发不超 2", async () => {
    const a = makeItem("Paper A", twoChunkText("a"));
    const b = makeItem("Paper B", twoChunkText("b"));
    const Zotero = makeFakeZotero([a.attachment, b.attachment]);

    const files: Array<{ path: string; content: string }> = [];
    let running = 0;
    let peak = 0;
    // 截断长度取 24: 块首行是 "## <段标题>", 只截 12 字符会把第二个块的
    // "## Introduction" 截成 "## Introduct", 下文按 "## 段标题" 的断言无从成立
    const translate = async (text: string): Promise<string> => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return `译文:${text.slice(0, 24)}`;
    };

    await runBatchExport(Zotero, [a.item, b.item], {
      pickFolder: async () => "D:\\out",
      writeFile: async (path, content) => {
        files.push({ path, content });
      },
      translate,
    });

    expect(files).toHaveLength(2);
    const pathA = files.map((f) => f.path).find((p) => p.includes("Paper A"));
    const pathB = files.map((f) => f.path).find((p) => p.includes("Paper B"));
    expect(pathA).toBe("D:\\out\\Paper A.md");
    expect(pathB).toBe("D:\\out\\Paper B.md");

    const mdA = files.filter((f) => f.path.includes("Paper A"))[0].content;
    expect(mdA).toContain("# Paper A");
    // 条目内分块串行保序: 两块译文都按 "## 段标题" 顺序落在同一文件
    expect(mdA).toContain("译文:## Abstract");
    expect(mdA).toContain("译文:## Introduction");
    expect(mdA.indexOf("译文:## Abstract")).toBeLessThan(
      mdA.indexOf("译文:## Introduction"),
    );
    const mdB = files.filter((f) => f.path.includes("Paper B"))[0].content;
    expect(mdB).toContain("# Paper B");

    // 并发上界: BATCH_CONCURRENCY=2, 峰值不得超过它
    expect(peak).toBeLessThanOrEqual(BATCH_CONCURRENCY);
    expect(peak).toBeGreaterThanOrEqual(1);

    const pw = FakeProgressWindow.latest();
    expect(pw.shown).toBe(true);
    expect(summaryText()).toContain("成功 2");
    expect(summaryText()).toContain("失败 0");
    expect(summaryText()).toContain("D:\\out");
    expect(pw.closeTimer).toBe(15000);
  });

  it("单条目翻译失败: 其余条目照常落盘, 进度标失败且整体不抛出", async () => {
    const a = makeItem("Paper A", twoChunkText("a"));
    const b = makeItem("Paper B", twoChunkText("b"));
    const Zotero = makeFakeZotero([a.attachment, b.attachment]);

    const files: Array<{ path: string; content: string }> = [];
    const translate = async (text: string): Promise<string> => {
      if (text.includes("bbbb")) throw new Error("模拟翻译失败");
      return `译文:${text.slice(0, 12)}`;
    };

    await expect(
      runBatchExport(Zotero, [a.item, b.item], {
        pickFolder: async () => "D:\\out",
        writeFile: async (path, content) => {
          files.push({ path, content });
        },
        translate,
      }),
    ).resolves.toBeUndefined();

    expect(files).toHaveLength(1);
    expect(files[0].path).toContain("Paper A");
    expect(summaryText()).toContain("成功 1");
    expect(summaryText()).toContain("失败 1");
    expect(summaryText()).toContain("D:\\out");

    const failedLine = FakeProgressWindow.latest().lines.find((l) =>
      l.text.includes("模拟翻译失败"),
    );
    expect(failedLine?.text).toContain("⚠");
    expect(failedLine?.text).toContain("Paper B");
  });

  it("取消选夹(返回 null): 零翻译零落盘, 不建进度窗", async () => {
    const a = makeItem("Paper A", twoChunkText("a"));
    const Zotero = makeFakeZotero([a.attachment]);

    let translateCalls = 0;
    let writeCalls = 0;
    await runBatchExport(Zotero, [a.item], {
      pickFolder: async () => null,
      writeFile: async () => {
        writeCalls += 1;
      },
      translate: async () => {
        translateCalls += 1;
        return "";
      },
    });

    expect(translateCalls).toBe(0);
    expect(writeCalls).toBe(0);
    expect(FakeProgressWindow.instances).toHaveLength(0);
  });

  it("无全文条目跳过并标记, 其余条目照常导出", async () => {
    const empty = makeItem("Paper Empty", "");
    const ok = makeItem("Paper OK", twoChunkText("a"));
    const Zotero = makeFakeZotero([empty.attachment, ok.attachment]);

    const files: Array<{ path: string; content: string }> = [];
    await runBatchExport(Zotero, [empty.item, ok.item], {
      pickFolder: async () => "/tmp/out",
      writeFile: async (path, content) => {
        files.push({ path, content });
      },
      translate: async (text) => `译文:${text.slice(0, 12)}`,
    });

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("/tmp/out/Paper OK.md");
    const skipped = FakeProgressWindow.latest().lines.find((l) =>
      l.text.includes("无可用全文"),
    );
    expect(skipped?.text).toContain("Paper Empty");
    expect(summaryText()).toContain("成功 1");
  });
});
