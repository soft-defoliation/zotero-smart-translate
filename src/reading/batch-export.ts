/**
 * 批量翻译导出 — 条目右键第三项的后端: 多选条目 → 各条目 PDF 全文
 * → splitSections/chunkSegments 分块 → 逐块 translateText → 双语 Markdown
 * → 全部落盘到用户选定的一个文件夹。
 *
 * 复用链: BatchQueue(条目级限流) + pipeline 分块(与阅读助手同一口径)
 * + data.translateText(术语锁定/会话缓存/空密钥拦截全生效)
 * + export-md.toBilingualMarkdown(与既有导出格式一致)。
 *
 * 三个外部副作用点(pickFolder/writeFile/translate)均可注入: 单测用 fake
 * 覆盖全链路, 默认实现走 Zotero 真实 API(实证出处见各实现注释)。
 * 已知限制(本次不做, 记录于任务报告): 无取消 UI; 只落盘不回写 Zotero 库;
 * 磁盘上已有的同名文件会被覆盖(仅做本次导出内的重名去重)。
 */

import { BatchQueue } from "../engine/batch";
import { toBilingualMarkdown } from "../engine/export-md";
import { zhErrorMessage } from "../engine/errors";
import { getActiveEngine } from "../engine/settings";
import { translateText } from "../data";
import { getReadingText } from "./fulltext";
import { createProgressLine } from "./progress-line";
import { chunkSegments, splitSections } from "./pipeline";
import type { BatchJob } from "../engine/batch";
import type { BilingualPair } from "../engine/export-md";
import type { Segment } from "../types";

/**
 * 条目级并发上限: 原 t10 需求限流 2(条目内分块串行保序, 只有条目之间并发),
 * 暂不做设置项 — 并发过高会同时打多个 API 请求, 易触发限流或配额告警。
 */
export const BATCH_CONCURRENCY = 2;

/** 单块字符上限, 与阅读助手默认值一致(约 2500 token/块) */
const CHUNK_MAX_CHARS = 10000;

/** 文件名长度上限(含扩展名在内不宜过长, 兼容 Windows 路径长度限制) */
const MAX_FILE_NAME = 80;

/** Windows/macOS 通用的非法文件名字符 */
const ILLEGAL_FILE_NAME_CHARS = /[\\/:*?"<>|]/g;

/** 导出 markdown 的元信息(引擎名/日期), 缺项由 toBilingualMarkdown 省略 */
export interface BatchExportMeta {
  engine?: string;
  date?: string;
}

/** 可注入的副作用点, 便于单测完全离线运行 */
export interface BatchExportOptions {
  /** 选目标文件夹; 返回 null 表示用户取消(中止整个导出) */
  pickFolder?: () => Promise<string | null>;
  /** 落盘, 默认 Zotero.File.putContentsAsync */
  writeFile?: (path: string, content: string) => Promise<void>;
  /** 单块翻译, 默认 translateText(关闭句子记忆: 导出块含 "## 标题" 结构标记,
   *  编号路径会破坏格式; 关闭历史记录: 批量块短时间大量入列, 不刷屏历史区) */
  translate?: (text: string) => Promise<string>;
}

/**
 * 把条目标题转成安全文件名(不含扩展名)。
 * 非法字符替换为下划线, 去首尾空白与点(Windows 不允许文件名以点/空格结尾),
 * 截断到 80 字符; 结果为空则回退 "untitled"。
 */
export function sanitizeFileName(title: string): string {
  const cleaned = String(title ?? "")
    .replace(ILLEGAL_FILE_NAME_CHARS, "_")
    .slice(0, MAX_FILE_NAME)
    // 截断后可能重新出现尾部空格/点, 因此去首尾放在截断之后
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return cleaned || "untitled";
}

/**
 * 组双语 Markdown: 块文本与译文按序配成 pairs 后交 toBilingualMarkdown。
 * 译文缺项(理论上只会在调用方传短数组时出现)以空串占位, 不抛错。
 */
export function buildItemMarkdown(
  title: string,
  sourceChunks: string[],
  translations: string[],
  meta?: BatchExportMeta,
): string {
  const pairs: BilingualPair[] = sourceChunks.map((source, idx) => ({
    source,
    translation: translations[idx] ?? "",
  }));
  return toBilingualMarkdown(title, pairs, meta);
}

/**
 * 批量导出主流程:
 * 1. 选目标文件夹(取消/空路径直接中止, 不建进度窗、不发任何请求);
 * 2. 逐条收集: 附件向上归一 → isRegularItem 过滤 → 取全文; 无全文条目在
 *    进度窗标"无可用全文"跳过;
 * 3. BatchQueue(并发 BATCH_CONCURRENCY, job=条目)逐条: 条目内分块串行翻译
 *    (保序) → 组 markdown → 写 `<安全文件名>.md`;
 * 4. 单条目失败标 ⚠ 并继续其余; 结束后摘要行报告成功/失败数与文件夹路径,
 *    再 startCloseTimer 收尾。
 * 全程失败以中文消息呈现(zhErrorMessage), 不向用户抛未处理异常。
 */
export async function runBatchExport(
  Zotero: any,
  items: any[],
  opts: BatchExportOptions = {},
): Promise<void> {
  const pick = opts.pickFolder ?? (() => defaultPickFolder(Zotero));
  const write = opts.writeFile ?? ((path, content) => defaultWriteFile(Zotero, path, content));
  const translate =
    opts.translate ??
    ((t: string) =>
      translateText(t, undefined, { disableMemory: true, recordHistory: false }));

  let pw: any = null;
  let summaryLine: any = null;
  try {
    // 选夹在任何 UI 之前: 取消即静默返回, 进度窗与翻译链都不启动
    const folder = await pick();
    if (!folder || !folder.trim()) return;
    const folderPath = folder.trim();

    pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.show();
    pw.changeHeadline("SmartTranslate: 批量翻译导出");
    summaryLine = createProgressLine(pw, "正在收集条目与全文...");

    // 收集阶段: 只把"普通条目且取到全文"的入队, 其余在进度窗逐行说明
    const candidates: Array<{ title: string; chunks: string[] }> = [];
    for (const raw of items ?? []) {
      let item = raw;
      // 选中 PDF 附件也允许: 向上取父条目(与 fulltext.getReadingText 同一归一逻辑)
      if (typeof item?.isAttachment === "function" && item.isAttachment()) {
        item = item.parentID ? Zotero.Items?.get?.(item.parentID) : null;
      }
      if (typeof item?.isRegularItem !== "function" || !item.isRegularItem()) continue;
      const title = String(item.getField?.("title") ?? "").trim() || "未命名条目";
      const reading = await getReadingText(Zotero, item);
      if (!reading || !reading.text.trim()) {
        pw.addLines(`⚠ ${title}: 无可用全文, 已跳过`);
        continue;
      }
      const chunks = chunkSegments(splitSections(reading.text), CHUNK_MAX_CHARS).map(
        formatChunk,
      );
      if (!chunks.length) {
        pw.addLines(`⚠ ${title}: 全文分块为空, 已跳过`);
        continue;
      }
      candidates.push({ title, chunks });
    }

    if (!candidates.length) {
      summaryLine?.setText?.("没有可导出的条目(无普通条目或无可用全文)");
      pw.startCloseTimer(8000);
      return;
    }

    const total = candidates.length;
    // 一行一条目: line 引用留到翻译过程里按块进度更新
    const entryByKey = new Map<string, ExportEntry>();
    candidates.forEach((candidate, idx) => {
      const key = `item-${idx}`;
      entryByKey.set(key, {
        idx: idx + 1,
        title: candidate.title,
        chunks: candidate.chunks,
        line: createProgressLine(
          pw,
          `[${idx + 1}/${total}] ${candidate.title}: 排队中`,
        ),
      });
    });

    // 本次导出去重: 同标题条目追加 -2/-3 后缀, 避免互相覆盖
    const usedNames = new Set<string>();
    const claimFileName = (base: string): string => {
      let name = base;
      let n = 1;
      while (usedNames.has(name.toLowerCase())) {
        n += 1;
        name = base.replace(/\.md$/i, `-${n}.md`);
      }
      usedNames.add(name.toLowerCase());
      return name;
    };

    const engineName = currentEngineName();
    const date = todayISO();
    const onQueueProgress = (state: BatchJob[]) => {
      const finished = state.filter(
        (j) => j.status === "done" || j.status === "failed",
      ).length;
      const failed = state.filter((j) => j.status === "failed").length;
      summaryLine?.setText?.(
        `导出中: 已完成 ${finished}/${state.length}${failed ? `, 失败 ${failed}` : ""}`,
      );
    };

    const queue = new BatchQueue({
      concurrency: BATCH_CONCURRENCY,
      // job=条目: 条目内分块严格串行保序, 只有条目之间受限并发
      translator: async (key: string) => {
        const entry = entryByKey.get(key);
        if (!entry) throw new Error("内部错误: 条目记录丢失, 已跳过");
        try {
          const chunks = entry.chunks;
          const translations: string[] = [];
          for (let i = 0; i < chunks.length; i++) {
            entry.line?.setText?.(
              `[${entry.idx}/${total}] ${entry.title}: 翻译中 ${i}/${chunks.length} ` +
                `(${Math.round((i / chunks.length) * 100)}%)`,
            );
            translations.push(await translate(chunks[i]));
          }
          entry.line?.setText?.(
            `[${entry.idx}/${total}] ${entry.title}: 翻译完成 (100%), 正在写入文件...`,
          );
          const markdown = buildItemMarkdown(entry.title, chunks, translations, {
            engine: engineName,
            date,
          });
          const filePath = joinPath(
            folderPath,
            claimFileName(`${sanitizeFileName(entry.title)}.md`),
          );
          await write(filePath, markdown);
          entry.line?.setText?.(`[${entry.idx}/${total}] ${entry.title}: 已导出`);
          return filePath;
        } catch (e) {
          // 队列只保留 message, 这里先转成中文文案再抛出, 进度行直接可读
          throw new Error(zhErrorMessage(e));
        }
      },
    });

    queue.load(Array.from(entryByKey.keys()));
    await queue.run(onQueueProgress);

    // 失败条目逐行标 ⚠, 成功计数只认 done
    let ok = 0;
    let failed = 0;
    for (const job of queue.snapshot()) {
      const entry = entryByKey.get(job.text);
      if (job.status === "done") {
        ok += 1;
        continue;
      }
      failed += 1;
      entry?.line?.setText?.(
        `[${entry.idx}/${total}] ${entry.title}: ⚠ ${job.error ?? "导出失败"}`,
      );
    }
    summaryLine?.setText?.(
      `导出完成: 成功 ${ok} / 失败 ${failed} · 文件夹: ${folderPath}`,
    );
    pw.startCloseTimer(15000);
  } catch (e) {
    const message = zhErrorMessage(e);
    if (pw && summaryLine) {
      // 已有进度窗(收集/导出阶段失败): 复用摘要行展示并延时关闭
      summaryLine?.setText?.(`⚠ ${message}`);
      pw.startCloseTimer(8000);
    } else {
      // 进度窗尚未建立(选夹阶段失败): 单独起提示窗
      showTip(Zotero, message);
    }
  }
}

/** 队列内一条目的运行时记录: 进度行引用 + 已切好的块文本 */
interface ExportEntry {
  /** 进度行里的序号(从 1 起) */
  idx: number;
  title: string;
  chunks: string[];
  line: any;
}

/**
 * 块文本拼装: 与 pipeline.formatSegments 同一形态("## 段标题" + 正文),
 * 让翻译链看到的分节结构与阅读分析一致, 段的标题也随正文一起翻译。
 */
function formatChunk(chunk: Segment[]): string {
  return chunk.map((s) => `## ${s.title}\n${s.text}`).join("\n\n");
}

/**
 * 默认选夹实现 — 走 Zotero 自带 FilePicker 模块。
 * 实证(2026-09-10, 查 Zotero 主干 chrome/content/zotero/modules/filePicker.mjs):
 * - 模块路径 "chrome://zotero/content/modules/filePicker.mjs", 导出 class FilePicker;
 * - fp.init(parentWindow, title, mode) 内部转调
 *   nsIFilePicker.init(parentWindow.browsingContext, ...), 即已适配 Firefox 128+
 *   的 init 签名变化 — 因此不要自己拼裸 nsIFilePicker(在 Zotero 8+ 会抛
 *   NS_ERROR_XPC_BAD_CONVERT_JS);
 * - fp.modeGetFolder = 2, fp.returnOK = 0, fp.returnCancel = 1;
 * - fp.show() 为 async(Promise<Integer>); fp.file getter 返回路径字符串。
 * zotero-types 未收录该模块, 故此处按运行时形状访问并收窄, 不写死枚举值。
 */
async function defaultPickFolder(Zotero: any): Promise<string | null> {
  const chromeUtils = (globalThis as any).ChromeUtils;
  if (!chromeUtils?.importESModule) {
    throw new Error("当前 Zotero 环境不支持文件选择器, 无法选择导出文件夹");
  }
  const { FilePicker } = chromeUtils.importESModule(
    "chrome://zotero/content/modules/filePicker.mjs",
  );
  if (!FilePicker) {
    throw new Error("当前 Zotero 版本未提供 FilePicker 模块, 无法选择导出文件夹");
  }
  const fp = new FilePicker();
  fp.init(Zotero.getMainWindow?.(), "选择双语 Markdown 导出文件夹", fp.modeGetFolder);
  const result = await fp.show();
  if (result === fp.returnCancel) return null;
  const picked = fp.file;
  if (typeof picked === "string" && picked.trim()) return picked.trim();
  // 老版本可能返回 nsIFile 形态, 取 .path 兜底
  const path = (picked as { path?: unknown })?.path;
  return typeof path === "string" && path.trim() ? path.trim() : null;
}

/**
 * 默认落盘实现 — Zotero.File.putContentsAsync(path, data, charset)。
 * 实证: zotero-types 的 types/xpcom/file.d.ts 声明
 * `putContentsAsync: (path: string | nsIFile, data: string | ..., charset?: string) => Promise<void>`;
 * 显式传 "utf-8" 保证中文内容不被默认字符集写坏。
 */
function defaultWriteFile(
  Zotero: any,
  path: string,
  content: string,
): Promise<void> {
  return Zotero.File.putContentsAsync(path, content, "utf-8");
}

/** 按目录自身分隔符拼文件路径(Windows 盘符路径带反斜杠, 不能写死 "/") */
function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${name}`;
}

/** 本地日期 YYYY-MM-DD(用本地时区, 避免 UTC 跨日把导出日期标错) */
function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 当前引擎名(写进 markdown 元信息); 无引擎/未初始化时返回空串, 元信息自动省略 */
function currentEngineName(): string {
  try {
    return getActiveEngine()?.name?.trim() ?? "";
  } catch {
    return "";
  }
}

/** 短生命周期提示窗: 用于选夹阶段等进度窗尚未建立的早期失败 */
function showTip(Zotero: any, message: string): void {
  try {
    const pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.show();
    pw.changeHeadline("SmartTranslate: 批量翻译导出");
    pw.addLines(`⚠ ${message}`);
    pw.startCloseTimer(6000);
  } catch {
    /* 进度窗不可用时静默, 不阻断主流程 */
  }
}
