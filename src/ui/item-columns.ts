/**
 * 条目列表自定义列注册(标题译文/摘要译文两列)。
 * 列展示机制参考 T4Z(Translate for Zotero): 译文写在条目 Extra 字段
 * (key titleTranslation/abstractTranslation), 再注册为条目树自定义列,
 * 用户可在列选择器(右键列头)中开启。
 * ItemTreeManager.registerColumn 仅 Zotero 7+ 提供(同步签名, 返回带插件
 * 前缀的 dataKey 或 false), 老版本或注册异常时静默跳过, 不影响其余功能;
 * 卸载时按返回的 dataKey 逐列 unregisterColumn。
 */

import { getExtraField } from "../engine/extra-fields";

/** 列定义: dataKey 为条目树列键, extraKey 为 Extra 字段里的译文 key */
const COLUMNS: Array<{ dataKey: string; label: string; extraKey: string }> = [
  {
    dataKey: "stTitleTranslation",
    label: "标题译文",
    extraKey: "titleTranslation",
  },
  {
    dataKey: "stAbstractTranslation",
    label: "摘要译文",
    extraKey: "abstractTranslation",
  },
];

/**
 * 注册标题/摘要译文两列, 返回卸载函数(逐列 unregisterColumn, 单列失败不阻断)。
 * ItemTreeManager 缺失(老版本 Zotero)时返回空卸载函数, 静默跳过。
 */
export function registerItemColumns(Zotero: any, pluginID: string): () => void {
  if (!Zotero?.ItemTreeManager?.registerColumn) return () => {};

  // registerColumn 返回带插件前缀的实际 dataKey; false 表示注册失败,
  // 不进卸载清单(unregisterColumn 对无效 key 无意义)
  const registeredDataKeys: string[] = [];
  for (const column of COLUMNS) {
    try {
      const dataKey = Zotero.ItemTreeManager.registerColumn({
        dataKey: column.dataKey,
        label: column.label,
        pluginID,
        dataProvider: (item: any) => {
          try {
            return getExtraField(item, column.extraKey) ?? "";
          } catch {
            // 单列取值异常不炸条目树: 降级为空串
            return "";
          }
        },
        showInColumnPicker: true,
        zoteroPersist: ["width", "hidden", "sortDirection"],
      });
      if (typeof dataKey === "string" && dataKey) {
        registeredDataKeys.push(dataKey);
      }
    } catch (e) {
      Zotero?.logError?.(e);
    }
  }

  return () => {
    for (const dataKey of registeredDataKeys) {
      try {
        Zotero.ItemTreeManager.unregisterColumn?.(dataKey);
      } catch {
        /* 列可能已随插件被 Zotero 清理, 单个失败不阻断其余 */
      }
    }
  };
}
