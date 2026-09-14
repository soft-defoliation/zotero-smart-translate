/**
 * 翻译历史(引擎层)测试。
 * 覆盖契约第 5 节: record 判空/置顶去重(归一后同源替换首条)/容量裁剪
 * (100+1 裁最旧)/超长拦截, fake store(经 setHistoryPrefsStore 注入)
 * 持久化 roundtrip(record 落盘 -> 重置内存 -> loadHistoryFromPrefs 恢复),
 * 非法数据静默裁剪与写失败不影响内存结果。
 * 单测环境无 Zotero.Prefs: 持久化路径一律走注入的 fake store。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  HISTORY_CAPACITY,
  HISTORY_PREF_KEY,
  clearHistory,
  getHistory,
  loadHistoryFromPrefs,
  recordHistory,
  setHistoryPrefsStore,
  type HistoryItem,
  type HistoryPrefsStore,
} from "../../src/engine/history";

/** 可检查落盘内容的 fake store: data 即 "pref 文件", get/set 直读直写 */
function makeStore(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  const store: HistoryPrefsStore & { data: Record<string, string> } = {
    data,
    get: (key: string) => data[key],
    set: (key: string, value: string) => {
      data[key] = value;
    },
  };
  return store;
}

/** 连续记录 n 条互不相同原文(序号递增), 供容量/顺序断言 */
function recordSeries(n: number): void {
  for (let i = 0; i < n; i += 1) {
    recordHistory(`原文 ${i}`, `译文 ${i}`, "引擎");
  }
}

beforeEach(() => {
  // 每个用例回落"无存储 + 空内存"基线: persist 无 store 时静默 no-op
  setHistoryPrefsStore(null);
  clearHistory();
});

afterEach(() => {
  // 防假时钟泄漏到相邻用例
  vi.useRealTimers();
});

describe("recordHistory 基本行为", () => {
  it("记录形状完整: source/result/engineName/time, 新条目在头部", () => {
    recordHistory("甲文本", "甲译文", "谷歌");
    recordHistory("乙文本", "乙译文", "DeepL");
    const items = getHistory();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: "乙文本",
      result: "乙译文",
      engineName: "DeepL",
    });
    expect(typeof items[0].time).toBe("number");
    expect(Number.isFinite(items[0].time)).toBe(true);
    expect(items[1].source).toBe("甲文本");
  });

  it("getHistory 返回副本: 改动返回值不影响内部态", () => {
    recordHistory("原文", "译文", "引擎");
    const snapshot: HistoryItem[] = getHistory();
    snapshot[0].result = "篡改";
    snapshot.push({ source: "x", result: "y", engineName: "z", time: 0 });
    const fresh = getHistory();
    expect(fresh).toHaveLength(1);
    expect(fresh[0].result).toBe("译文");
  });

  it("空串/纯空白原文不记录, 结果空白也不记录", () => {
    recordHistory("", "译文", "引擎");
    recordHistory("   \n\t ", "译文", "引擎");
    recordHistory("原文", "", "引擎");
    recordHistory("原文", "  \n", "引擎");
    expect(getHistory()).toEqual([]);
  });

  it("原文超过 5000 字符不记录(防 prefs 过大), 恰好 5000 记录(边界)", () => {
    recordHistory("a".repeat(5001), "译文", "引擎");
    expect(getHistory()).toEqual([]);
    recordHistory("a".repeat(5000), "译文", "引擎");
    expect(getHistory()).toHaveLength(1);
  });

  it("store.set 抛错不影响 record 的内存结果", () => {
    setHistoryPrefsStore({
      get: () => undefined,
      set: () => {
        throw new Error("写盘失败");
      },
    });
    expect(() => recordHistory("原文", "译文", "引擎")).not.toThrow();
    const items = getHistory();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "原文", result: "译文" });
  });
});

describe("置顶去重(与首条归一比对)", () => {
  it("归一后同源(仅空白差异)替换首条, 不新增条目", () => {
    recordHistory("Hello   World", "旧译文", "引擎一");
    recordHistory("Hello World", "新译文", "引擎二");
    const items = getHistory();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: "Hello World",
      result: "新译文",
      engineName: "引擎二",
    });
  });

  it("替换时 time 更新为最新(假时钟钉死)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    recordHistory("同源文本", "旧译文", "引擎一");
    vi.setSystemTime(2_000_000);
    recordHistory("同源文本 ", "新译文", "引擎二");
    const items = getHistory();
    expect(items).toHaveLength(1);
    expect(items[0].time).toBe(2_000_000);
  });

  it("不同源仍插头部, 旧条目顺序保持(新 -> 旧)", () => {
    recordHistory("第一篇", "译一", "引擎");
    recordHistory("第二篇", "译二", "引擎");
    recordHistory("第三篇", "译三", "引擎");
    expect(getHistory().map((item) => item.source)).toEqual([
      "第三篇",
      "第二篇",
      "第一篇",
    ]);
  });

  it("只与首条比对: 与非首条同源仍插入新条目(契约口径钉测)", () => {
    recordHistory("甲", "译甲", "引擎");
    recordHistory("乙", "译乙", "引擎");
    recordHistory("甲 ", "译甲新版", "引擎");
    const items = getHistory();
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ source: "甲 ", result: "译甲新版" });
    expect(items[2]).toMatchObject({ source: "甲", result: "译甲" });
  });
});

describe("容量裁剪", () => {
  it("超过 HISTORY_CAPACITY 时裁掉最旧, 最新在头部", () => {
    recordSeries(HISTORY_CAPACITY + 1);
    const items = getHistory();
    expect(items).toHaveLength(HISTORY_CAPACITY);
    expect(items[0].source).toBe(`原文 ${HISTORY_CAPACITY}`);
    expect(items.map((item) => item.source)).not.toContain("原文 0");
  });

  it("恰好 HISTORY_CAPACITY 条时全保留(边界)", () => {
    recordSeries(HISTORY_CAPACITY);
    expect(getHistory()).toHaveLength(HISTORY_CAPACITY);
  });
});

describe("持久化与恢复", () => {
  it("落盘 key 为 smarttranslate.history(Zotero.Prefs 补前缀后即全路径), 内容为 JSON", () => {
    expect(HISTORY_PREF_KEY).toBe("smarttranslate.history");
    const store = makeStore();
    setHistoryPrefsStore(store);
    recordHistory("原文", "译文", "引擎");
    const blob = store.data[HISTORY_PREF_KEY];
    expect(typeof blob).toBe("string");
    const parsed = JSON.parse(blob!) as HistoryItem[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ source: "原文", result: "译文" });
  });

  it("roundtrip: record 落盘后, 重置内存 + 新 store 载入同一份数据可恢复", () => {
    // 会话一: 记录两条, 落盘
    const store1 = makeStore();
    setHistoryPrefsStore(store1);
    recordHistory("第一段原文", "第一段译文", "引擎A");
    recordHistory("第二段原文", "第二段译文", "引擎B");
    const blob = store1.data[HISTORY_PREF_KEY];
    expect(typeof blob).toBe("string");

    // 新"会话": 清注入与内存(此刻无 store, persist no-op, 不会污染落盘数据)
    setHistoryPrefsStore(null);
    clearHistory();
    expect(getHistory()).toEqual([]);

    // 会话二: 同一份落盘数据装进新 store(等价重启后的 pref), 载入恢复
    const store2 = makeStore({ [HISTORY_PREF_KEY]: blob! });
    setHistoryPrefsStore(store2);
    loadHistoryFromPrefs();
    const items = getHistory();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: "第二段原文",
      result: "第二段译文",
      engineName: "引擎B",
    });
    expect(items[1]).toMatchObject({
      source: "第一段原文",
      result: "第一段译文",
      engineName: "引擎A",
    });
  });

  it("非法 JSON 静默: load 不抛错, 内存为空", () => {
    const store = makeStore({ [HISTORY_PREF_KEY]: "不是JSON{{{" });
    setHistoryPrefsStore(store);
    expect(() => loadHistoryFromPrefs()).not.toThrow();
    expect(getHistory()).toEqual([]);
  });

  it("非数组 JSON / 条目形状非法: 坏条目静默跳过, 好条目保留", () => {
    const blob = JSON.stringify([
      "字符串条目",
      null,
      { source: 1, result: "x", time: 1 },
      { source: "缺时间", result: "r" },
      { source: "好条目", result: "好译文", engineName: "引擎", time: 123 },
      { source: "时间非法", result: "r", time: "明天" },
    ]);
    const store = makeStore({ [HISTORY_PREF_KEY]: blob });
    setHistoryPrefsStore(store);
    loadHistoryFromPrefs();
    const items = getHistory();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: "好条目",
      result: "好译文",
      engineName: "引擎",
      time: 123,
    });
  });

  it("落盘数据本身超容: 载入时裁到 HISTORY_CAPACITY", () => {
    const oversized: HistoryItem[] = [];
    for (let i = 0; i < HISTORY_CAPACITY + 5; i += 1) {
      oversized.push({
        source: `条目 ${i}`,
        result: `译 ${i}`,
        engineName: "引擎",
        time: i,
      });
    }
    const store = makeStore({
      [HISTORY_PREF_KEY]: JSON.stringify(oversized),
    });
    setHistoryPrefsStore(store);
    loadHistoryFromPrefs();
    const items = getHistory();
    expect(items).toHaveLength(HISTORY_CAPACITY);
    // 裁剪保序: 留存储数组前 100 条(新 -> 旧), 最旧的 5 条被裁
    expect(items[0].source).toBe("条目 0");
    expect(items[99].source).toBe(`条目 ${HISTORY_CAPACITY - 1}`);
  });

  it("clearHistory 清内存并把空数组落盘", () => {
    const store = makeStore();
    setHistoryPrefsStore(store);
    recordHistory("原文", "译文", "引擎");
    expect(store.data[HISTORY_PREF_KEY]).toContain("原文");
    clearHistory();
    expect(getHistory()).toEqual([]);
    expect(JSON.parse(store.data[HISTORY_PREF_KEY])).toEqual([]);
  });
});
