/**
 * Zotero note I/O — creates child notes for reading results, plus the
 * "SmartTranslate 收集" note that accumulates popup translations.
 * 平台事实(Better Notes 同款): 子笔记必须 libraryID + parentID + setNote
 * 三件套, HTML 需包 <div data-schema-version="9"> 根元素, 白名单
 * h1-h6/p/ul/ol/li/table/strong/em/a 内取标签。
 */

export interface NoteInput {
  /** 子笔记标题(可选, 并入笔记 HTML 首行 <h2>, 不写 title 字段) */
  title?: string;
  htmlBody: string;
  tags?: string[];
}

/** 阅读结果到笔记的结构化输入(与 assistant.ReadingResult 结构兼容, 避免反向依赖) */
export interface NoteContent {
  summary: string;
  innovations: string[];
  methods: Record<string, string>;
}

// 转义 &, <, > 三类 HTML 敏感字符; 文本节点中引号无需处理(沿用旧 esc 语义)
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 方法键 -> 中文标签(与 pipeline.METHOD_SCHEMA 对应; 未知键原样作标签)
const METHOD_LABELS: Record<string, string> = {
  composition: "组成与配方",
  synthesis: "合成路径",
  characterization: "表征手段",
  dft_params: "DFT 参数",
  loading_condition: "加载条件",
};

/**
 * 构建阅读笔记 HTML: 根 <div data-schema-version="9"> + 三节结构
 * (摘要 p / 创新 ul-li 逐条 / 方法 strong 键值逐行), 全部内容经 esc 转义。
 */
export function buildNoteHTML(content: NoteContent): string {
  const parts: string[] = ['<div data-schema-version="9">'];
  // 摘要节: 换行转 <br>; 空摘要以未提及占位, 保证节结构完整
  parts.push("<h2>📑 全文摘要</h2>");
  const summary = esc(content.summary).replace(/\n/g, "<br>");
  parts.push(`<p>${summary || "未提及"}</p>`);
  // 创新点节: 逐条 li; 空列表降级为未提及占位
  parts.push("<h2>💡 创新点</h2>");
  if (content.innovations.length > 0) {
    const items = content.innovations.map((i) => `<li>${esc(i)}</li>`).join("");
    parts.push(`<ul>${items}</ul>`);
  } else {
    parts.push("<p>未提及</p>");
  }
  // 方法节: 键值对逐行, 键加粗(冒号为笔记正文文案, 全角系契约模板指定)
  parts.push("<h2>🔬 方法结构化</h2>");
  for (const [key, value] of Object.entries(content.methods)) {
    const label = METHOD_LABELS[key] ?? key;
    parts.push(`<p><strong>${esc(label)}</strong>：${esc(value)}</p>`);
  }
  parts.push("</div>");
  return parts.join("");
}

/**
 * 把标题并入笔记 HTML 首行: note 类型没有 title 字段(Zotero schema 中
 * note 的字段列表为空), 对 note 调 setField 写标题必抛, 因此标题只能
 * 走笔记内容 — Zotero 的 noteToTitle 会取笔记 HTML 首个块级元素的文本
 * 作为笔记列表标题, 首行 <h2> 即可让标题可见可检索。
 * 常规产物以根 <div data-schema-version="9"> 开头, 标题插入根内首个子元素;
 * 裸 HTML(无根 div)则直接前置, 两种形态 noteToTitle 都能取到。
 */
function withTitleHeading(title: string | undefined, htmlBody: string): string {
  if (!title) return htmlBody;
  const heading = `<h2>${esc(title)}</h2>`;
  const withHeading = htmlBody.replace(/^(<div[^>]*>)/, `$1${heading}`);
  return withHeading === htmlBody ? heading + htmlBody : withHeading;
}

/**
 * 保存子笔记: 归属父条目所在的库与条目, 经 setNote 写入 HTML 后 saveTx。
 * 旧实现 parentID = 0 会把笔记写成无父孤儿, note.note 直接赋值不触发
 * Zotero 的笔记解析管线, 两处均为真 bug, 已修。
 * 标题不经 setField 写 title 字段(note 类型无此字段, 必抛), 并入 HTML 首行。
 */
export async function saveReadingNote(
  Zotero: any,
  parent: any,
  input: NoteInput,
): Promise<any> {
  const note = new Zotero.Item("note");
  note.libraryID = parent.libraryID;
  note.parentID = parent.id;
  note.setNote(withTitleHeading(input.title, input.htmlBody));
  if (input.tags?.length) note.setTags(input.tags);
  await note.saveTx?.();
  return note;
}

/** 收集笔记的识别标记: 存在于笔记 HTML 中即认定该笔记是收集笔记 */
export const COLLECT_NOTE_MARKER = "smarttranslate-collect";

/** 收集笔记标题(Zotero 取笔记首个块级元素文本作列表标题, 故并入 HTML 首行 <h2>) */
const COLLECT_NOTE_TITLE = "SmartTranslate 收集";

// 属性值转义: esc 不处理引号, 时间串要进 data-* 属性, 引号必须额外转义
function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}

/** 本地时间戳 YYYY-MM-DD HH:mm(纯函数, 时间由调用方注入便于测试) */
export function formatCollectTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * 构建一条收集条目(纯函数):
 * - bilingual=false: `<p>译文</p>` + 时间行;
 * - bilingual=true: `<p>原文</p><blockquote>译文</blockquote>` + 时间行。
 * 时间行带 MARKER 属性, 新建笔记与追加共用同一条目形态, 便于再次定位。
 * 原文/译文/时间全部转义, 防止文献正文里的 < > & 破坏笔记结构。
 */
export function buildCollectEntry(
  original: string,
  translation: string,
  bilingual: boolean,
  time: string = formatCollectTime(new Date()),
): string {
  const stamp = escAttr(time);
  // 时间行: 样式被 Zotero 清洗掉也不影响识别(识别只看 data-* 属性与文本)
  const timeRow =
    `<p data-${COLLECT_NOTE_MARKER}="${escAttr(COLLECT_NOTE_MARKER)}"` +
    ` data-smarttranslate-time="${stamp}"` +
    ` style="font-size:0.85em;opacity:0.72;">${esc(time)}</p>`;
  const body = bilingual
    ? `<p>${esc(original)}</p><blockquote>${esc(translation)}</blockquote>`
    : `<p>${esc(translation)}</p>`;
  return body + timeRow;
}

/** 新建收集笔记的初始 HTML: 根 div + 标题 + 首条 entry */
function buildCollectNoteHTML(entryHtml: string): string {
  return (
    `<div data-schema-version="9"><h2>${esc(COLLECT_NOTE_TITLE)}</h2>` +
    `${entryHtml}</div>`
  );
}

/**
 * 收集笔记识别判据: 条目上的 MARKER 属性为准;
 * 兜底比对标题文本 — 用户在笔记编辑器里改动过收集笔记时, Zotero 的
 * 笔记编辑器可能规范化掉未知 data-* 属性, 只剩标题可认, 否则会重复建笔记。
 */
function isCollectNoteHtml(html: string): boolean {
  return (
    html.includes(COLLECT_NOTE_MARKER) || html.includes(COLLECT_NOTE_TITLE)
  );
}

/**
 * 在父条目的子笔记里找收集笔记: 逐条 getNote() 查 MARKER。
 * 返回值三态:
 * - 笔记对象: 找到收集笔记;
 * - null: 确认没有收集笔记(可以新建);
 * - undefined: 子笔记列表读取失败(不可新建, 否则可能写出重复收集笔记)。
 */
async function findCollectNote(
  Zotero: any,
  parentItem: any,
): Promise<any> {
  let ids: unknown;
  try {
    ids = parentItem?.getNotes?.() ?? [];
  } catch {
    return undefined;
  }
  if (!Array.isArray(ids)) return undefined;
  for (const id of ids) {
    try {
      const note = Zotero?.Items?.getAsync
        ? await Zotero.Items.getAsync(id)
        : Zotero?.Items?.get?.(id);
      if (typeof note?.getNote !== "function") continue;
      if (isCollectNoteHtml(String(note.getNote() ?? ""))) return note;
    } catch {
      /* 单条笔记读取失败: 跳过继续找, 不影响其余候选 */
    }
  }
  return null;
}

/**
 * 把新条目并入已有收集笔记 HTML:
 * 有 schema 根 <div> 就插在根内末尾 — 保持"单一根节点"约定(与
 * buildNoteHTML/withTitleHeading 一致); 裸 HTML 才直接尾部追加。
 * 追加而非前插, 保证收集顺序 = 翻译先后顺序。
 */
function appendEntryToCollectNoteHtml(
  oldHtml: string,
  entryHtml: string,
): string {
  const tail = /<\/div>\s*$/.exec(oldHtml);
  if (!tail || tail.index === undefined) return oldHtml + entryHtml;
  return (
    oldHtml.slice(0, tail.index) + entryHtml + oldHtml.slice(tail.index)
  );
}

/**
 * 追加一条翻译收集条目到父条目的收集笔记:
 * - 已有收集笔记 -> 旧 HTML 末尾追加 entry 后 setNote + saveTx(保序);
 * - 没有 -> 新建子笔记(libraryID + parentID + setNote 三件套, 同 saveReadingNote);
 * - 子笔记列表读取失败或写入抛错 -> 返回 null 不抛, 由调用方决定是否提示。
 */
export async function appendToCollectNote(
  Zotero: any,
  parentItem: any,
  entryHtml: string,
): Promise<any> {
  try {
    if (!parentItem || typeof parentItem.id !== "number") return null;
    const existing = await findCollectNote(Zotero, parentItem);
    // undefined = 列表读取失败: 不新建, 免得第二条收集笔记从此分裂
    if (existing === undefined) return null;
    if (existing) {
      existing.setNote(
        appendEntryToCollectNoteHtml(String(existing.getNote() ?? ""), entryHtml),
      );
      await existing.saveTx?.();
      return existing;
    }
    const note = new Zotero.Item("note");
    note.libraryID = parentItem.libraryID;
    note.parentID = parentItem.id;
    note.setNote(buildCollectNoteHTML(entryHtml));
    await note.saveTx?.();
    return note;
  } catch {
    return null;
  }
}
