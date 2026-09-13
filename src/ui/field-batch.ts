/**
 * 批量"翻译标题/摘要写入条目": 多选条目全量顺序处理(T4Z 同款行为, 不截断)。
 * 与单条模式(ui/menus.ts translateItemField)共用同一写回目标 — Extra 字段
 * (titleTranslation/abstractTranslation), 写入后条目列表自定义列
 * (ui/item-columns.ts)与 Info 区译文行(ui/info-rows.ts)自动可见, 无需额外通知。
 * 不做并发: 标题/摘要文本短, 顺序逐条足够; 取消能力留待后续批次。
 * 单条异常只记日志并计入 failed, 不中断批次继续下一条。
 */

import { translateText } from "../data";
import { setExtraField } from "../engine/extra-fields";

/** 批量结果计数: done 成功 / failed 失败 / skipped 空字段跳过, total 为输入总数 */
export interface FieldBatchResult {
  done: number;
  failed: number;
  skipped: number;
  total: number;
}

/**
 * 顺序批量翻译并写入条目 Extra 字段, 返回计数结果。
 * - 字段空白 -> skipped(onItemDone 回调), 不发翻译请求;
 * - 翻译/写回异常 -> failed(logError 后继续), 不中断批次;
 * - onItemDone(index, status, message?) 每条处理完回调一次, 供进度行更新。
 */
export async function translateItemsField(
  items: any[],
  field: "title" | "abstract",
  hooks?: {
    onItemDone?: (
      index: number,
      status: "done" | "failed" | "skipped",
      message?: string,
    ) => void;
  },
): Promise<FieldBatchResult> {
  const extraKey =
    field === "title" ? "titleTranslation" : "abstractTranslation";
  const result: FieldBatchResult = {
    done: 0,
    failed: 0,
    skipped: 0,
    total: items.length,
  };
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    try {
      // 可选链兜底: 非普通条目(笔记等)混入选区时按空字段跳过而非抛错
      const src: string = item?.getField?.(field) ?? "";
      if (!src.trim()) {
        result.skipped += 1;
        hooks?.onItemDone?.(index, "skipped");
        continue;
      }
      const translation = await translateText(src);
      await setExtraField(item, extraKey, translation);
      result.done += 1;
      hooks?.onItemDone?.(index, "done");
    } catch (e) {
      result.failed += 1;
      // 日志经 globalThis 可选链取用: 本模块不接收 Zotero 参数,
      // 测试等无 Zotero 环境下静默, 不能因记日志再抛错;
      // as any 规避 globalThis 无 index signature 的 TS 报错
      (globalThis as any).Zotero?.logError?.(e);
      hooks?.onItemDone?.(index, "failed", zhMessage(e));
    }
  }
  return result;
}

/** 批量失败行的短文案: 优先取 Error.message, 兜底字符串化 */
function zhMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
