/**
 * 阅读笔记构建与全文附件选取测试:
 * - buildNoteHTML: div 根元素 + 三节结构 + 全文转义;
 * - saveReadingNote: 子笔记 libraryID/parentID/setNote 三件套(bug 修复验证),
 *   标题并入 HTML 首行 <h2>(note 类型无 title 字段, setField 必抛的 P0 回归防线);
 * - buildCollectEntry/appendToCollectNote: 翻译收集笔记(仅译文/双语/转义/时间行,
 *   无收集笔记新建、有则追加保序、枚举失败不抛不新建);
 * - pickPdfAttachment: 混合附件数组选取 PDF 的纯函数。
 */

import { describe, it, expect } from "vitest";
import {
  buildNoteHTML,
  buildCollectEntry,
  appendToCollectNote,
  COLLECT_NOTE_MARKER,
  saveReadingNote,
  type NoteContent,
} from "../../src/reading/notes";
import { pickPdfAttachment } from "../../src/reading/fulltext";

describe("buildNoteHTML 结构与转义", () => {
  const content: NoteContent = {
    summary: 'a<b & "c"',
    innovations: ["创新一 <x>", "创新二"],
    methods: { composition: "AB&C", synthesis: "未提及" },
  };

  it("应产出 div 根元素与三节结构", () => {
    const html = buildNoteHTML(content);
    expect(html.startsWith('<div data-schema-version="9">')).toBe(true);
    expect(html.endsWith("</div>")).toBe(true);
    expect(html).toContain("<h2>📑 全文摘要</h2>");
    expect(html).toContain("<h2>💡 创新点</h2>");
    expect(html).toContain("<h2>🔬 方法结构化</h2>");
  });

  it("摘要与创新点应全部转义, 创新点为 ul/li 结构", () => {
    const html = buildNoteHTML(content);
    // 摘要: & 与 < 均转义
    expect(html).toContain("<p>a&lt;b &amp; \"c\"</p>");
    expect(html).not.toContain("a<b");
    // 创新: li 逐条且转义
    expect(html).toContain(
      "<ul><li>创新一 &lt;x&gt;</li><li>创新二</li></ul>",
    );
  });

  it("方法键值应使用 strong 加粗键", () => {
    const html = buildNoteHTML(content);
    expect(html).toContain("<p><strong>组成与配方</strong>：AB&amp;C</p>");
    expect(html).toContain("<p><strong>合成路径</strong>：未提及</p>");
  });

  it("空创新列表应降级为未提及占位, 未知方法键原样作标签", () => {
    const html = buildNoteHTML({
      summary: "",
      innovations: [],
      methods: { custom_key: "v<1>" },
    });
    expect(html).toContain("<p>未提及</p>");
    expect(html).toContain("<p><strong>custom_key</strong>：v&lt;1&gt;</p>");
  });
});

// saveReadingNote 的 FakeItem: 记录属性赋值与方法调用, 验证子笔记三件套。
// setField 模拟真机行为: note 类型无 title 字段, 非法字段必抛 —
// 若实现回退为对 note 写 title 字段, 本套测试会直接红
class FakeItem {
  type: string;
  libraryID = 0;
  parentID = 0;
  notedHtml = "";
  tags: string[] = [];
  fields: Record<string, string> = {};
  saved = false;
  constructor(type: string) {
    this.type = type;
  }
  setNote(html: string): void {
    this.notedHtml = html;
  }
  setField(key: string, value: string): void {
    if (this.type === "note") {
      throw new Error(`Invalid field '${key}' for note`);
    }
    this.fields[key] = value;
  }
  setTags(tags: string[]): void {
    this.tags = tags;
  }
  async saveTx(): Promise<void> {
    this.saved = true;
  }
}

describe("saveReadingNote 子笔记归属", () => {
  it("应设置 libraryID 与 parentID 并经 setNote 写入, 标题并入 HTML 首行", async () => {
    const Zotero = { Item: FakeItem };
    const parent = { libraryID: 2, id: 77 };
    const note = await saveReadingNote(Zotero, parent, {
      title: "阅读笔记: 某文献",
      htmlBody: "<div data-schema-version=\"9\">x</div>",
      tags: ["smarttranslate-reading"],
    });
    expect(note.type).toBe("note");
    // bug 修复验证: 不再 parentID = 0, 归属父条目
    expect(note.libraryID).toBe(2);
    expect(note.parentID).toBe(77);
    // bug 修复验证: 经 setNote 而非 note.note 直接赋值
    // P0 回归验证: note 无 title 字段, 标题必须是根 div 内首行 <h2>
    expect(note.notedHtml).toBe(
      '<div data-schema-version="9"><h2>阅读笔记: 某文献</h2>x</div>',
    );
    expect(note.fields.title).toBeUndefined();
    expect(note.tags).toEqual(["smarttranslate-reading"]);
    expect(note.saved).toBe(true);
  });

  it("无标题时 HTML 原样写入, 不插入空 <h2>", async () => {
    const Zotero = { Item: FakeItem };
    const note = await saveReadingNote(
      Zotero,
      { libraryID: 1, id: 1 },
      { htmlBody: '<div data-schema-version="9">y</div>' },
    );
    expect(note.notedHtml).toBe('<div data-schema-version="9">y</div>');
  });

  it("标题特殊字符应转义后再入 HTML", async () => {
    const Zotero = { Item: FakeItem };
    const note = await saveReadingNote(
      Zotero,
      { libraryID: 1, id: 2 },
      { title: 'a<b & c', htmlBody: '<div data-schema-version="9">z</div>' },
    );
    expect(note.notedHtml).toBe(
      '<div data-schema-version="9"><h2>a&lt;b &amp; c</h2>z</div>',
    );
  });
});

describe("pickPdfAttachment 纯函数", () => {
  it("混合附件数组应取第一个 PDF 附件", () => {
    const html = { id: 1, attachmentContentType: "text/html" };
    const pdf = { id: 2, attachmentContentType: "application/pdf" };
    const pdf2 = { id: 3, attachmentContentType: "application/pdf" };
    expect(pickPdfAttachment([html, pdf, pdf2])).toBe(pdf);
  });

  it("无 PDF 应返回 null", () => {
    const attachments = [
      { id: 1, attachmentContentType: "text/html" },
      { id: 2, attachmentContentType: "application/epub+zip" },
    ];
    expect(pickPdfAttachment(attachments)).toBeNull();
    expect(pickPdfAttachment([])).toBeNull();
  });

  it("数组中混入 null/原始值条目应跳过且不抛错", () => {
    const pdf = { id: 9, attachmentContentType: "application/pdf" };
    expect(pickPdfAttachment([null, "x", pdf] as unknown[])).toBe(pdf);
  });
});

describe("buildCollectEntry 收集条目", () => {
  const TIME = "2026-09-10 22:01";

  it("仅译文模式应产出 <p>译文</p> 与时间行", () => {
    const entry = buildCollectEntry("Original", "译文内容", false, TIME);
    expect(entry).toContain("<p>译文内容</p>");
    // 时间行同时是识别锚点: data-* 属性 + 可见时间文本
    expect(entry).toContain(`data-smarttranslate-time="${TIME}"`);
    expect(entry).toContain(`>${TIME}</p>`);
    expect(entry).toContain(COLLECT_NOTE_MARKER);
    // 仅译文模式不出现原文
    expect(entry).not.toContain("Original");
  });

  it("双语模式应产出 <p>原文</p><blockquote>译文</blockquote> 与时间行", () => {
    const entry = buildCollectEntry("Original", "译文内容", true, TIME);
    expect(entry).toContain("<p>Original</p><blockquote>译文内容</blockquote>");
    expect(entry).toContain(`data-smarttranslate-time="${TIME}"`);
    expect(entry).not.toContain("<p>译文内容</p>");
  });

  it("原文与译文中的 HTML 敏感字符应全部转义", () => {
    const entry = buildCollectEntry('a<b & c', 'd>e & "f"', true, TIME);
    expect(entry).toContain("<p>a&lt;b &amp; c</p>");
    expect(entry).toContain('<blockquote>d&gt;e &amp; "f"</blockquote>');
    // 时间行之前不得出现未转义的原文片段
    expect(entry).not.toContain("a<b");
  });

  it("时间行不带入未转义的引号(时间串进属性值)", () => {
    const entry = buildCollectEntry("o", "t", false, 'x"y');
    expect(entry).toContain('data-smarttranslate-time="x&quot;y"');
  });
});

// 收集笔记用的 FakeItem: 追加场景需要 getNote 读回已存 HTML
class FakeNoteItem {
  type = "note";
  libraryID = 0;
  parentID = 0;
  html = "";
  saved = false;
  constructor(html = "") {
    this.html = html;
  }
  getNote(): string {
    return this.html;
  }
  setNote(html: string): void {
    this.html = html;
  }
  async saveTx(): Promise<void> {
    this.saved = true;
  }
}

/** fake Zotero: byId 模拟 Zotero.Items.getAsync, Item 构造即"新建子笔记" */
function makeZotero(byId: Map<number, unknown>): any {
  return {
    Item: FakeNoteItem,
    Items: {
      async getAsync(id: number): Promise<unknown> {
        return byId.get(id) ?? null;
      },
    },
  };
}

/** 构造一条已存在的收集笔记 HTML(带 MARKER) */
function collectNoteHtml(entry: string): string {
  return `<div data-schema-version="9"><h2>SmartTranslate 收集</h2>${entry}</div>`;
}

describe("appendToCollectNote 收集笔记写入", () => {
  const entry = buildCollectEntry("Original", "译文内容", false, "2026-09-10 22:01");

  it("没有收集笔记时应新建子笔记(库/父条目/schema 根/标题齐备)", async () => {
    const Zotero = makeZotero(new Map());
    const parent = { libraryID: 5, id: 9, getNotes: () => [] };

    const note = await appendToCollectNote(Zotero, parent, entry);

    expect(note).toBeInstanceOf(FakeNoteItem);
    expect(note.type).toBe("note");
    expect(note.libraryID).toBe(5);
    expect(note.parentID).toBe(9);
    expect(note.html.startsWith('<div data-schema-version="9">')).toBe(true);
    expect(note.html).toContain("<h2>SmartTranslate 收集</h2>");
    expect(note.html).toContain(entry);
    expect(note.saved).toBe(true);
  });

  it("已有收集笔记时应尾部追加且保序(跳过非收集笔记)", async () => {
    const oldEntry = buildCollectEntry("Old", "旧译文", false, "2026-09-01 10:00");
    const collect = new FakeNoteItem(collectNoteHtml(oldEntry));
    const other = new FakeNoteItem('<div data-schema-version="9"><h2>阅读笔记</h2>正文</div>');
    const byId = new Map<number, unknown>([
      [1, other],
      [2, collect],
    ]);
    const Zotero = makeZotero(byId);
    const parent = { libraryID: 1, id: 2, getNotes: () => [1, 2] };

    const note = await appendToCollectNote(Zotero, parent, entry);

    expect(note).toBe(collect);
    expect(note.html).toContain(oldEntry);
    expect(note.html.indexOf(oldEntry)).toBeLessThan(note.html.indexOf(entry));
    // 新条目插在 schema 根 div 内(单一根节点约定), 旧的收尾标签仍在最后
    expect(note.html.indexOf(entry)).toBeLessThan(note.html.lastIndexOf("</div>"));
    expect(note.html.endsWith("</div>")).toBe(true);
    expect(note.saved).toBe(true);
    // 非收集笔记未被改动
    expect(other.html).not.toContain(entry);
  });

  it("MARKER 属性被编辑器规范化掉时按标题兜底认领(不重复建笔记)", async () => {
    // 模拟用户编辑过收集笔记: data-* 属性没了, 只剩标题文本
    const stripped = new FakeNoteItem(
      '<div data-schema-version="9"><h2>SmartTranslate 收集</h2><p>旧译文</p></div>',
    );
    const byId = new Map<number, unknown>([[1, stripped]]);
    const Zotero = makeZotero(byId);
    const parent = { libraryID: 1, id: 7, getNotes: () => [1] };

    const note = await appendToCollectNote(Zotero, parent, entry);

    expect(note).toBe(stripped);
    expect(note.html).toContain(entry);
  });

  it("getNotes 抛错时不应抛出, 也不新建(避免写出重复收集笔记)", async () => {
    const Zotero = makeZotero(new Map());
    const parent = {
      libraryID: 1,
      id: 3,
      getNotes: () => {
        throw new Error("note list unavailable");
      },
    };

    const note = await appendToCollectNote(Zotero, parent, entry);

    expect(note).toBeNull();
  });

  it("单条笔记读取失败应跳过继续找, 不影响后续命中", async () => {
    const collect = new FakeNoteItem(collectNoteHtml(entry));
    const Zotero = {
      Item: FakeNoteItem,
      Items: {
        async getAsync(id: number): Promise<unknown> {
          if (id === 1) throw new Error("boom");
          // id=2 返回无 getNote 的非笔记条目, 也应被跳过
          if (id === 2) return {};
          return collect;
        },
      },
    };
    const parent = { libraryID: 1, id: 4, getNotes: () => [1, 2, 3] };

    const note = await appendToCollectNote(Zotero, parent, entry);

    expect(note).toBe(collect);
    expect(note.saved).toBe(true);
  });

  it("父条目非法时返回 null 不抛", async () => {
    const Zotero = makeZotero(new Map());
    expect(await appendToCollectNote(Zotero, null, entry)).toBeNull();
    expect(await appendToCollectNote(Zotero, { id: "x" }, entry)).toBeNull();
  });
});
