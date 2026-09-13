/**
 * Info 区译文行注册(registerInfoRows)测试:
 * - 无 ItemPaneManager(老版本) -> 返回空卸载函数, 不抛错;
 * - stub registerInfoRow 捕获 options -> 两行的 rowID/l10nID/position/
 *   multiline 逐项断言(l10nID 为构建后带 smarttranslate- 前缀的实际 id);
 * - onGetData -> Extra 字段读数(getExtraField 真实解析)与异常兜底 "";
 * - 卸载 -> 对注册时收集到的 rowKey 各调一次 unregisterInfoRow。
 */

import { describe, it, expect, vi } from "vitest";
import { registerInfoRows } from "../../src/ui/info-rows";

/** 带 titleTranslation/abstractTranslation 行的 extra 文本 */
const EXTRA_WITH_TRANSLATIONS =
  "titleTranslation: 标题译文文本\nabstractTranslation: 摘要译文文本\nOriginal: 保留行";

describe("registerInfoRows", () => {
  it("无 ItemPaneManager 时返回空卸载函数, 静默跳过", () => {
    const unregister = registerInfoRows({}, "smarttranslate@fengqiu.dev");
    expect(typeof unregister).toBe("function");
    expect(() => unregister()).not.toThrow();
  });

  it("注册两行: rowID/l10nID/position/multiline 逐项正确", () => {
    const registerInfoRow = vi.fn((options: any) => options.rowID);
    const Zotero = { ItemPaneManager: { registerInfoRow } };

    const unregister = registerInfoRows(Zotero, "smarttranslate@fengqiu.dev");

    expect(registerInfoRow).toHaveBeenCalledTimes(2);
    const [titleRow, abstractRow] = registerInfoRow.mock.calls.map(
      (call) => call[0] as any,
    );
    // 标题行: 单行不换行, 数据源 titleTranslation
    expect(titleRow.rowID).toBe("st-title-translation-row");
    expect(titleRow.label.l10nID).toBe("smarttranslate-titleTranslationRow");
    expect(titleRow.position).toBe("end");
    expect(titleRow.nowrap).toBe(true);
    expect(titleRow.multiline).toBeUndefined();
    // 摘要行: 多行, 数据源 abstractTranslation
    expect(abstractRow.rowID).toBe("st-abstract-translation-row");
    expect(abstractRow.label.l10nID).toBe(
      "smarttranslate-abstractTranslationRow",
    );
    expect(abstractRow.position).toBe("end");
    expect(abstractRow.multiline).toBe(true);
    expect(abstractRow.nowrap).toBeUndefined();
    // pluginID 透传给 Zotero 做插件归属
    expect(titleRow.pluginID).toBe("smarttranslate@fengqiu.dev");
    unregister();
  });

  it("onGetData: 从 Extra 字段读出译文, 异常 item 兜底空串", () => {
    const registerInfoRow = vi.fn((options: any) => options.rowID);
    const Zotero = { ItemPaneManager: { registerInfoRow } };
    registerInfoRows(Zotero, "plugin-id");

    const [titleRow, abstractRow] = registerInfoRow.mock.calls.map(
      (call) => call[0] as any,
    );
    // 正常条目: getExtraField 真实解析 extra 行文本
    const okItem = { getField: (key: string) =>
      key === "extra" ? EXTRA_WITH_TRANSLATIONS : "",
    };
    expect(titleRow.onGetData({ item: okItem })).toBe("标题译文文本");
    expect(abstractRow.onGetData({ item: okItem })).toBe("摘要译文文本");

    // 异常条目: getField 抛错不炸 Info 区, 降级空串
    const boomItem = {
      getField: () => {
        throw new Error("boom");
      },
    };
    expect(titleRow.onGetData({ item: boomItem })).toBe("");
    expect(abstractRow.onGetData({ item: boomItem })).toBe("");
  });

  it("卸载: 对 registerInfoRow 返回的 rowKey 各调一次 unregisterInfoRow", () => {
    // 模拟 Zotero 给 rowKey 加插件前缀: 返回值与传入 rowID 不同
    const registered: string[] = [];
    const registerInfoRow = vi.fn((options: any) => {
      const key = `smarttranslate-${options.rowID}`;
      registered.push(key);
      return key;
    });
    const unregisterInfoRow = vi.fn();
    const Zotero = {
      ItemPaneManager: { registerInfoRow, unregisterInfoRow },
    };

    const unregister = registerInfoRows(Zotero, "plugin-id");
    unregister();

    expect(unregisterInfoRow).toHaveBeenCalledTimes(2);
    expect(unregisterInfoRow).toHaveBeenNthCalledWith(1, registered[0]);
    expect(unregisterInfoRow).toHaveBeenNthCalledWith(2, registered[1]);
  });

  it("注册返回 false 时不进卸载清单", () => {
    const registerInfoRow = vi.fn(() => false);
    const unregisterInfoRow = vi.fn();
    const Zotero = {
      ItemPaneManager: { registerInfoRow, unregisterInfoRow },
    };

    const unregister = registerInfoRows(Zotero, "plugin-id");
    unregister();

    expect(registerInfoRow).toHaveBeenCalledTimes(2);
    expect(unregisterInfoRow).not.toHaveBeenCalled();
  });
});
