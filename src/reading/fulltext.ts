/**
 * 全文获取 — 阅读助手的文本来源层。
 * 平台事实(researcher 已实证): 优先 attachmentItem.attachmentText
 * (官方 API, 未索引会现场抽取, 返回 string); 空则 fallback
 * Zotero.PDFWorker.getFullText(attachmentID, null) 解构 {text};
 * 仍空视为无全文。
 */

export interface ReadingText {
  text: string;
  attachmentID: number;
}

/**
 * 可测纯函数: 从混合附件数组中取第一个 PDF 附件。
 * 只认 attachmentContentType === "application/pdf"; 无 PDF 返回 null,
 * 数组中混入 null/非对象条目时跳过不抛错。
 */
export function pickPdfAttachment(attachments: unknown[]): any | null {
  for (const att of attachments) {
    if (
      att &&
      typeof att === "object" &&
      (att as { attachmentContentType?: unknown }).attachmentContentType ===
        "application/pdf"
    ) {
      return att;
    }
  }
  return null;
}

/**
 * 取条目的可读全文:
 * - 传入 PDF 附件条目时自动向上取父条目;
 * - 非普通条目(分类/笔记等)返回 null, 由调用方提示;
 * - getAttachments 找不到 PDF 附件返回 null;
 * - attachmentText 为空或抛异常时降级 PDFWorker, 仍空返回 null。
 */
export async function getReadingText(
  Zotero: any,
  item: any,
): Promise<ReadingText | null> {
  // 附件条目直接选中: 向上取父条目再继续
  if (typeof item?.isAttachment === "function" && item.isAttachment()) {
    const parentID = item.parentID;
    item = parentID ? Zotero.Items?.get?.(parentID) : null;
  }
  if (typeof item?.isRegularItem !== "function" || !item.isRegularItem()) {
    return null;
  }
  const attachmentIDs: number[] = item.getAttachments?.() ?? [];
  const attachments = attachmentIDs
    .map((id) => Zotero.Items?.get?.(id))
    .filter(Boolean);
  const pdf = pickPdfAttachment(attachments);
  if (!pdf) return null;
  // 主通道: 官方 attachmentText, 未索引的附件 Zotero 会现场抽取
  let text = "";
  try {
    text = (await pdf.attachmentText) ?? "";
  } catch {
    text = "";
  }
  // 降级通道: PDFWorker 直取全文, 解构 {text}
  if (!text.trim()) {
    try {
      const full = await Zotero.PDFWorker?.getFullText(pdf.id, null);
      text = full?.text ?? "";
    } catch {
      text = "";
    }
  }
  if (!text.trim()) return null;
  return { text, attachmentID: pdf.id };
}
