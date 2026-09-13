/**
 * 批量字段翻译(translateItemsField)测试:
 * - 全成功: 每条按 field 映射写回 Extra key, 计数 done=total;
 * - 空字段: skipped 计数, 不发翻译请求不写条目;
 * - 中途抛错: 单条失败不中断批次, 继续后续条目;
 * - onItemDone: 每条恰好回调一次, 状态与顺序正确。
 * vi.mock 掉 data/extra-fields 两个重依赖, 只验证批量编排逻辑本身。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/data", () => ({
  translateText: vi.fn(),
}));

vi.mock("../../src/engine/extra-fields", () => ({
  setExtraField: vi.fn(),
}));

import { translateText } from "../../src/data";
import { setExtraField } from "../../src/engine/extra-fields";
import { translateItemsField } from "../../src/ui/field-batch";

const translateTextMock = vi.mocked(translateText);
const setExtraFieldMock = vi.mocked(setExtraField);

/** 最小条目 fake: getField(field) 返回预设文本 */
function makeItem(field: "title" | "abstract", text: string) {
  return {
    getField: (key: string) => (key === field ? text : ""),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  translateTextMock.mockImplementation(async (text: string) => `译:${text}`);
  setExtraFieldMock.mockResolvedValue(undefined);
});

describe("translateItemsField", () => {
  it("全成功: 逐条翻译并按字段映射写回 Extra key, 计数 done=total", async () => {
    const items = [
      makeItem("title", "Paper A"),
      makeItem("title", "Paper B"),
      makeItem("title", "Paper C"),
    ];
    const result = await translateItemsField(items, "title");

    expect(translateTextMock).toHaveBeenCalledTimes(3);
    expect(setExtraFieldMock).toHaveBeenCalledTimes(3);
    // 写回 key 映射: title -> titleTranslation, 值为译文
    expect(setExtraFieldMock).toHaveBeenNthCalledWith(
      1,
      items[0],
      "titleTranslation",
      "译:Paper A",
    );
    expect(setExtraFieldMock).toHaveBeenNthCalledWith(
      2,
      items[1],
      "titleTranslation",
      "译:Paper B",
    );
    expect(setExtraFieldMock).toHaveBeenNthCalledWith(
      3,
      items[2],
      "titleTranslation",
      "译:Paper C",
    );
    expect(result).toEqual({ done: 3, failed: 0, skipped: 0, total: 3 });
  });

  it("abstract 字段映射到 abstractTranslation, 空字段条目跳过不发请求", async () => {
    const items = [
      makeItem("abstract", "Abstract text"),
      makeItem("abstract", "   "),
      makeItem("abstract", "Another abstract"),
    ];
    const result = await translateItemsField(items, "abstract");

    // 第 2 条纯空白: 不翻译不写回, 计入 skipped
    expect(translateTextMock).toHaveBeenCalledTimes(2);
    expect(translateTextMock).toHaveBeenNthCalledWith(1, "Abstract text");
    expect(translateTextMock).toHaveBeenNthCalledWith(2, "Another abstract");
    expect(setExtraFieldMock).toHaveBeenCalledTimes(2);
    expect(setExtraFieldMock).toHaveBeenNthCalledWith(
      1,
      items[0],
      "abstractTranslation",
      "译:Abstract text",
    );
    expect(setExtraFieldMock).toHaveBeenNthCalledWith(
      2,
      items[2],
      "abstractTranslation",
      "译:Another abstract",
    );
    expect(result).toEqual({ done: 2, failed: 0, skipped: 1, total: 3 });
  });

  it("第 2 条翻译抛错: 继续第 3 条, 计数 done=2 failed=1", async () => {
    const items = [
      makeItem("title", "Ok one"),
      makeItem("title", "Boom"),
      makeItem("title", "Ok three"),
    ];
    translateTextMock.mockImplementation(async (text: string) => {
      if (text === "Boom") throw new Error("network down");
      return `译:${text}`;
    });

    const result = await translateItemsField(items, "title");

    // 批次不中断: 第 3 条仍被翻译并写回
    expect(translateTextMock).toHaveBeenCalledTimes(3);
    expect(setExtraFieldMock).toHaveBeenCalledTimes(2);
    expect(setExtraFieldMock).toHaveBeenNthCalledWith(
      2,
      items[2],
      "titleTranslation",
      "译:Ok three",
    );
    expect(result).toEqual({ done: 2, failed: 1, skipped: 0, total: 3 });
  });

  it("onItemDone: 每条恰好回调一次, 状态与索引按序对应", async () => {
    const items = [
      makeItem("title", "A"),
      makeItem("title", ""),
      makeItem("title", "C"),
    ];
    translateTextMock.mockImplementation(async (text: string) => {
      if (text === "C") throw new Error("fail C");
      return `译:${text}`;
    });
    const calls: Array<[number, string]> = [];
    const result = await translateItemsField(items, "title", {
      onItemDone: (index, status) => {
        calls.push([index, status]);
      },
    });

    expect(calls).toEqual([
      [0, "done"],
      [1, "skipped"],
      [2, "failed"],
    ]);
    expect(result).toEqual({ done: 1, failed: 1, skipped: 1, total: 3 });
  });
});
