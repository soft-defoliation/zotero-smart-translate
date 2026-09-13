/**
 * 条目面板 Info 区译文行注册(标题译文/摘要译文两行)。
 * 行展示机制参考 T4Z(Translate for Zotero, AGPL): Zotero.ItemPaneManager
 * .registerInfoRow 在 Info 区追加只读数据行, label 经 l10nID 引用 FTL 消息。
 * l10nID 用构建后的实际消息 id: scaffold 构建时给 addon/locale 下各 .ftl 的
 * 消息 id 自动加 smarttranslate- 前缀并把文件改名为 smarttranslate-main.ftl
 * (已对 .scaffold/build/addon/locale/zh-CN/smarttranslate-main.ftl 实证),
 * 运行时 FTL 由 bootstrap.js 的 loadFTL 经 document.l10n.addResourceIds 挂载。
 * 行数据源自条目 Extra 字段(titleTranslation/abstractTranslation), 与条目
 * 列表自定义列(ui/item-columns.ts)共享同一数据源, 写入入口为菜单
 * "翻译标题/摘要(写入条目)"与批量翻译(ui/field-batch.ts)。
 * registerInfoRow 返回实际 rowKey(string, 可能带 Zotero 内部前缀)或 false;
 * 老版本 Zotero 无 ItemPaneManager 时静默跳过, 不影响其余功能。
 */

import { getExtraField } from "../engine/extra-fields";

/** 行定义: rowID 注册标识(不含逗号), l10nID 构建后 FTL 消息 id, extraKey Extra 字段 key */
const ROWS: Array<{
  rowID: string;
  l10nID: string;
  extraKey: string;
  multiline?: boolean;
  nowrap?: boolean;
}> = [
  {
    rowID: "st-title-translation-row",
    l10nID: "smarttranslate-titleTranslationRow",
    extraKey: "titleTranslation",
    nowrap: true,
  },
  {
    rowID: "st-abstract-translation-row",
    l10nID: "smarttranslate-abstractTranslationRow",
    extraKey: "abstractTranslation",
    multiline: true,
  },
];

/**
 * 注册标题/摘要译文两行, 返回卸载函数(逐行 unregisterInfoRow, 单行失败不阻断)。
 * ItemPaneManager 缺失(老版本 Zotero)时返回空卸载函数, 静默跳过。
 */
export function registerInfoRows(Zotero: any, pluginID: string): () => void {
  if (!Zotero?.ItemPaneManager?.registerInfoRow) return () => {};

  // registerInfoRow 返回实际 rowKey; false 表示注册失败, 不进卸载清单
  const registeredRowIDs: string[] = [];
  for (const row of ROWS) {
    try {
      const rowKey = Zotero.ItemPaneManager.registerInfoRow({
        rowID: row.rowID,
        pluginID,
        label: { l10nID: row.l10nID },
        position: "end",
        multiline: row.multiline,
        nowrap: row.nowrap,
        onGetData: (args: any) => {
          try {
            // BasicHookArgs: { rowID, item, tabType, editable }, 数据源是 args.item
            return getExtraField(args?.item, row.extraKey) ?? "";
          } catch {
            // 单行取值异常不炸 Info 区: 降级为空串
            return "";
          }
        },
      });
      if (typeof rowKey === "string" && rowKey) {
        registeredRowIDs.push(rowKey);
      }
    } catch (e) {
      Zotero?.logError?.(e);
    }
  }

  return () => {
    for (const rowID of registeredRowIDs) {
      try {
        Zotero.ItemPaneManager.unregisterInfoRow?.(rowID);
      } catch {
        /* 行可能已随插件被 Zotero 清理, 单个失败不阻断其余 */
      }
    }
  };
}
