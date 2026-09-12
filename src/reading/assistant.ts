/**
 * Reading assistant controller — orchestrates pipeline and UI.
 * P6: 真 map-reduce 编排 — 全文切分后逐块 map 摘要, reduce 汇总,
 * 创新/方法逐块提取后合并; 分析指令经 completeText 原始补全通道直发
 * (旧实现误用 translateText, 分析 prompt 被塞进翻译模板, 已废弃)。
 */

import {
  splitSections,
  chunkSegments,
  mapPrompt,
  reducePrompt,
  innovationPrompt,
  methodPrompt,
  parseInnovations,
  parseMethods,
  checkBudget,
  METHOD_SCHEMA,
} from "./pipeline";
import { GlossaryManager, buildGlossaryPrompt } from "../engine/glossary";
import { completeText, data } from "../data";
import { zhErrorMessage } from "../engine/errors";
import { getReadingText } from "./fulltext";
import { createProgressLine } from "./progress-line";
import { buildNoteHTML, saveReadingNote } from "./notes";
import type { Segment } from "../types";

export interface ReadingOptions {
  text: string;
  glossary: GlossaryManager;
  maxTokens: number;
  /** 单块字符上限, 默认 10000; 测试可调小以构造多块场景 */
  chunkMaxChars?: number;
  /** step 取 summary/innovations/methods/done, progress 为块粒度 i/n */
  onProgress?: (step: string, progress: number) => void;
}

export interface ReadingResult {
  summary: string;
  innovations: string[];
  methods: Record<string, string>;
}

// 菜单入口的单请求 token 预算: 10000 字符块约 2500 token, 留足余量
const READING_MAX_TOKENS = 6000;

// 进度条目文案: step -> 中文阶段名
const STEP_ZH: Record<string, string> = {
  summary: "全文摘要",
  innovations: "创新点",
  methods: "方法结构化",
  done: "完成",
};

/**
 * 阅读分析主流程: 切分 -> 分块 -> 预算对半 -> 逐块 map -> reduce ->
 * 创新/方法逐块提取合并。全程通过 onProgress 上报 (step, i/n) 步进。
 */
export async function runReadingAssistant(
  opts: ReadingOptions,
): Promise<ReadingResult> {
  if (!opts.text.trim()) {
    throw new Error("全文内容为空, 无法执行阅读分析");
  }
  const segments = splitSections(opts.text);
  const chunks = chunkSegments(segments, opts.chunkMaxChars ?? 10000);
  // 单块超预算自动对半再切一次(防炸); 对半后仍超限则照发, 由错误链路兜底
  const units: Segment[][] = [];
  for (const chunk of chunks) {
    const budget = checkBudget(chunk, 0, opts.maxTokens);
    if (!budget.ok) units.push(...halveChunk(chunk));
    else units.push(chunk);
  }
  const n = units.length;

  // 阶段一: 逐块 map 摘要, 术语按块内文本命中注入
  const summaries: string[] = [];
  for (let i = 0; i < n; i++) {
    opts.onProgress?.("summary", (i + 1) / n);
    summaries.push(await askChunk(opts, units[i], mapPrompt));
  }
  // reduce 汇总: 单块无需再汇总直接采用; 步进已在 map 阶段报满, 不重复上报
  let summary: string;
  if (n === 1) {
    summary = summaries[0];
  } else {
    summary = await completeText(reducePrompt(summaries));
  }

  // 阶段二: 创新点逐块提取, 解析去重合并
  const innovationLists: string[][] = [];
  for (let i = 0; i < n; i++) {
    opts.onProgress?.("innovations", (i + 1) / n);
    const raw = await askChunk(opts, units[i], innovationPrompt);
    innovationLists.push(parseInnovations(raw));
  }
  const innovations = mergeInnovations(innovationLists);

  // 阶段三: 方法逐块提取, 同键取首个非未提及值
  const methodMaps: Record<string, string>[] = [];
  for (let i = 0; i < n; i++) {
    opts.onProgress?.("methods", (i + 1) / n);
    const raw = await askChunk(opts, units[i], methodPrompt);
    methodMaps.push(parseMethods(raw));
  }
  const methods = mergeMethods(methodMaps);

  opts.onProgress?.("done", 1);
  return { summary, innovations, methods };
}

/** 单块请求: 按块内文本命中术语表, 拼 prompt 后走 completeText 原始通道 */
async function askChunk(
  opts: ReadingOptions,
  chunk: Segment[],
  build: (chunk: Segment[]) => string,
): Promise<string> {
  const chunkText = chunk.map((s) => s.text).join("\n");
  const entries = opts.glossary.matchAll(chunkText);
  const instruction = entries.length > 0 ? buildGlossaryPrompt(entries) : "";
  return completeText(build(chunk), { glossaryInstruction: instruction });
}

/** 超预算块对半: 多段按段数中点切; 单段超限按文本中点切成两个虚拟段 */
function halveChunk(chunk: Segment[]): Segment[][] {
  if (chunk.length > 1) {
    const mid = Math.floor(chunk.length / 2);
    return [chunk.slice(0, mid), chunk.slice(mid)];
  }
  const seg = chunk[0];
  const mid = Math.floor(seg.text.length / 2);
  return [
    [{ title: `${seg.title} (1/2)`, text: seg.text.slice(0, mid) }],
    [{ title: `${seg.title} (2/2)`, text: seg.text.slice(mid) }],
  ];
}

/** 逐块创新点去重合并: 去空白小写判重, 总量与 prompt 的 up-to-5 约定对齐 */
function mergeInnovations(lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = item.replace(/\s+/g, "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= 5) return out;
    }
  }
  return out;
}

/** 逐块方法合并: 同一键取第一个非"未提及"值, 保持 METHOD_SCHEMA 键序 */
function mergeMethods(maps: Record<string, string>[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of METHOD_SCHEMA) {
    out[key] = "未提及";
    for (const m of maps) {
      if (m[key] && m[key] !== "未提及") {
        out[key] = m[key];
        break;
      }
    }
  }
  return out;
}

/**
 * 菜单编排入口: 选中条目取全文 -> 原生 ProgressWindow 逐阶段/逐块更新 ->
 * runReadingAssistant -> buildNoteHTML + saveReadingNote 写子笔记。
 * 失败以 ⚠ 错误行展示中文消息; 无 PDF/无全文时提示后返回。
 */
export async function runReadingAssistantForItem(Zotero: any): Promise<void> {
  let pw: any = null;
  let line: any = null;
  try {
    const items = Zotero.getActiveZoteroPane?.()?.getSelectedItems?.() ?? [];
    let item = items[0];
    // 选中 PDF 附件条目也允许: 向上取父条目再判定
    if (item?.isAttachment?.()) {
      item = item.parentID ? Zotero.Items?.get?.(item.parentID) : null;
    }
    if (!item?.isRegularItem?.()) {
      showTip(Zotero, "请先在条目列表中选中一个普通条目");
      return;
    }
    pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.show();
    pw.changeHeadline("SmartTranslate: 阅读助手");
    // 可更新行必须用 ItemProgress 构造(addLines 无返回值); 构造失败回落 null,
    // 后续 setText 一律可选链调用, 进度显示降级但不影响主流程
    line = createProgressLine(pw, "正在获取全文...");
    const reading = await getReadingText(Zotero, item);
    if (!reading) {
      line?.setText?.("⚠ 未找到可用的 PDF 全文, 请确认条目带有 PDF 附件");
      pw.startCloseTimer(8000);
      return;
    }
    line?.setText?.(`已取到全文 ${reading.text.length} 字符, 开始逐块分析...`);
    const result = await runReadingAssistant({
      text: reading.text,
      glossary: data.glossary,
      maxTokens: READING_MAX_TOKENS,
      onProgress: (step, frac) => {
        // 逐阶段/逐块更新同一行: 阶段名 + 块粒度百分比
        line?.setText?.(
          `分析中: ${STEP_ZH[step] ?? step} ${Math.round(frac * 100)}%`,
        );
      },
    });
    line?.setText?.("分析完成, 正在写入子笔记...");
    const title = item.getField?.("title") ?? "文献";
    await saveReadingNote(Zotero, item, {
      title: `阅读笔记: ${title}`,
      htmlBody: buildNoteHTML(result),
      tags: ["smarttranslate-reading"],
    });
    line?.setText?.("已写入子笔记 📝");
    pw.startCloseTimer(4000);
  } catch (e) {
    if (pw && line) {
      // 已有可更新进度行: 复用错误行展示中文消息, 延时关闭便于阅读
      line?.setText?.(`⚠ ${zhErrorMessage(e)}`);
      pw.startCloseTimer(8000);
    } else {
      // 进度窗尚未建立(取条目阶段)的失败: 单独起提示窗
      showTip(Zotero, zhErrorMessage(e));
    }
  }
}

/** 短生命周期提示窗: 用于无需全文分析的轻量提示与早期失败 */
function showTip(Zotero: any, message: string): void {
  try {
    const pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.show();
    pw.changeHeadline("SmartTranslate: 阅读助手");
    pw.addLines(`⚠ ${message}`);
    pw.startCloseTimer(6000);
  } catch {
    /* 进度窗不可用时静默, 不阻断主流程 */
  }
}
