/**
 * Extra 字段解析/序列化与条目读写封装测试。
 * 格式口径与 zotero-plugin-toolkit ExtraField(T4Z 同款)一致:
 * 按 \n 分行, 每行首个 ": " 分割 key/value; 值内换行以字面 \n(反斜杠+n)
 * 转义写盘, 读取时还原为多行。
 */

import { describe, it, expect, vi } from "vitest";
import {
  getExtraField,
  parseExtraFields,
  serializeExtraFields,
  setExtraField,
} from "../../src/engine/extra-fields";

/** 最小条目 stub: getField 读内存态, setField/saveTx 用 vi.fn 记录调用 */
function makeItem(extra = "") {
  let stored = extra;
  return {
    getField: vi.fn((key: string) => (key === "extra" ? stored : "")),
    setField: vi.fn((key: string, value: string) => {
      if (key === "extra") stored = value;
    }),
    saveTx: vi.fn(async () => {}),
  };
}

describe("parseExtraFields", () => {
  it("按首个 ': ' 分割, 值本身含 ': ' 时保留完整值", () => {
    const { fields, nonStandard } = parseExtraFields(
      "DOI: 10.1234/abc\ntitleTranslation: a: b",
    );
    expect(fields.get("DOI")).toEqual(["10.1234/abc"]);
    expect(fields.get("titleTranslation")).toEqual(["a: b"]);
    expect(nonStandard).toEqual([]);
  });

  it("不含 ': ' 或 key 为空的行入 nonStandard 且保持原序", () => {
    const { fields, nonStandard } = parseExtraFields(
      "no colon line\n: empty key\nkey: value",
    );
    expect(fields.get("key")).toEqual(["value"]);
    expect(nonStandard).toEqual(["no colon line", ": empty key"]);
  });

  it("空行跳过, 不占 key 也不入非标准行", () => {
    const { fields, nonStandard } = parseExtraFields("a: 1\n\n\nb: 2\n");
    expect([...fields.keys()]).toEqual(["a", "b"]);
    expect(nonStandard).toEqual([]);
  });

  it("同名 key 多值全保留, 顺序不变(读取方取第一个)", () => {
    const { fields } = parseExtraFields("k: v1\nk: v2");
    expect(fields.get("k")).toEqual(["v1", "v2"]);
  });

  it("空串解析为空结果", () => {
    const { fields, nonStandard } = parseExtraFields("");
    expect(fields.size).toBe(0);
    expect(nonStandard).toEqual([]);
  });
});

describe("serializeExtraFields", () => {
  it("每个值一行还原, 非标准行兜底放末尾", () => {
    const fields = new Map<string, string[]>([
      ["DOI", ["10.1/x"]],
      ["titleTranslation", ["译"]],
    ]);
    expect(serializeExtraFields(fields, ["杂行"])).toBe(
      "DOI: 10.1/x\ntitleTranslation: 译\n杂行",
    );
  });

  it("parse -> serialize 无损还原(无非标准行时)", () => {
    const raw = "DOI: 10.1/x\ntitleTranslation: a: b\nSubmitted: 2024-01-01";
    const { fields, nonStandard } = parseExtraFields(raw);
    expect(serializeExtraFields(fields, nonStandard)).toBe(raw);
  });
});

describe("setExtraField/getExtraField", () => {
  it("roundtrip: 写入后可读回原值", async () => {
    const item = makeItem("DOI: 10.1234/abc\nSubmitted: 2024-01-01");
    await setExtraField(item, "titleTranslation", "铁电薄膜研究");
    expect(getExtraField(item, "titleTranslation")).toBe("铁电薄膜研究");
  });

  it("保留未知 key 行与非标准行(标准行原位, 非标准行兜底末尾)", async () => {
    const item = makeItem("DOI: 10.1234/abc\n杂行无冒号\ntype: article");
    await setExtraField(item, "titleTranslation", "译");
    expect(item.getField("extra")).toBe(
      "DOI: 10.1234/abc\ntype: article\ntitleTranslation: 译\n杂行无冒号",
    );
    expect(getExtraField(item, "DOI")).toBe("10.1234/abc");
  });

  it("同 key 覆盖不残留旧值(含同名多值)", async () => {
    const item = makeItem("titleTranslation: 旧译\ntitleTranslation: 旧译2\nDOI: 10.1/x");
    await setExtraField(item, "titleTranslation", "新译");
    expect(item.getField("extra")).toBe("titleTranslation: 新译\nDOI: 10.1/x");
    expect(getExtraField(item, "titleTranslation")).toBe("新译");
  });

  it("空串删除该 key 全部行", async () => {
    const item = makeItem("titleTranslation: 旧译\nDOI: 10.1/x");
    await setExtraField(item, "titleTranslation", "");
    expect(item.getField("extra")).toBe("DOI: 10.1/x");
    expect(getExtraField(item, "titleTranslation")).toBeUndefined();
  });

  it("多行译文写盘为单行(字面 \\n 转义), 读取还原为多行", async () => {
    const item = makeItem("DOI: 10.1/x");
    await setExtraField(item, "abstractTranslation", "第一段\n第二段");
    const extra = item.getField("extra") as string;
    // extra 里该 key 仅占一行, 值内换行已转义为字面反斜杠+n 两个字符
    expect(extra.split("\n")).toHaveLength(2);
    expect(extra).toBe("DOI: 10.1/x\nabstractTranslation: 第一段\\n第二段");
    expect(getExtraField(item, "abstractTranslation")).toBe("第一段\n第二段");
  });

  it("值含字面反斜杠+n 序列: 读回还原为换行(已声明局限钉测), 反复覆盖同值不膨胀", async () => {
    const item = makeItem("DOI: 10.1/x");
    // 字面反斜杠+n 两个字符(JS 源码 \\n), 不是真实换行
    const literalBackslashN = "第一行\\n第二行";
    await setExtraField(item, "titleTranslation", literalBackslashN);
    const extraAfterFirst = item.getField("extra") as string;
    // 写盘为单行, 值内字面 \\n 序列原样保留(写入只转义真实换行, 不二次转义反斜杠)
    expect(extraAfterFirst).toBe(
      "DOI: 10.1/x\ntitleTranslation: 第一行\\n第二行",
    );
    // 已声明局限(extra-fields.ts 头注释): 读取把值内字面 \\n 统一还原为换行,
    // roundtrip 有损 — 本用例把该局限钉为确定行为, 防未来误改转义逻辑时无感知破坏兼容
    expect(getExtraField(item, "titleTranslation")).toBe("第一行\n第二行");
    // 反复覆盖同值: 转义不叠加, extra 尺寸不膨胀
    await setExtraField(item, "titleTranslation", literalBackslashN);
    const extraAfterSecond = item.getField("extra") as string;
    expect(extraAfterSecond).toBe(extraAfterFirst);
    expect(extraAfterSecond.length).toBe(extraAfterFirst.length);
  });

  it("值本身含 ': '(如 a: b)时解析正确", async () => {
    const item = makeItem("");
    await setExtraField(item, "titleTranslation", "a: b");
    expect(item.getField("extra")).toBe("titleTranslation: a: b");
    expect(getExtraField(item, "titleTranslation")).toBe("a: b");
  });

  it("写入调用 setField('extra', ...) 并 saveTx 恰一次", async () => {
    const item = makeItem("");
    await setExtraField(item, "titleTranslation", "译");
    expect(item.setField).toHaveBeenCalledWith("extra", "titleTranslation: 译");
    expect(item.saveTx).toHaveBeenCalledTimes(1);
  });

  it("无 extra / 无该 key 时 getExtraField 返回 undefined", () => {
    expect(getExtraField(makeItem(""), "titleTranslation")).toBeUndefined();
  });
});
