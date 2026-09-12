/**
 * 会话级 LRU 翻译缓存测试:
 * - 直接测 cache.ts 的容量淘汰与 key 格式;
 * - 经 data.translateText 集成测命中免请求/不同 key 不串/失败不缓存。
 * fetch 全局 stub, 不做任何真实网络请求。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { translateText } from "../../src/data";
import { setSettings, setSecret } from "../../src/engine/settings";
import {
  buildCacheKey,
  cacheGet,
  cachePut,
  cacheSize,
  clearTranslateCache,
} from "../../src/engine/cache";
import type { Settings } from "../../src/types";

vi.stubGlobal("fetch", vi.fn());

function engineWith(id: string, model: string) {
  return {
    id,
    name: id,
    endPoint: "https://example.invalid/api",
    model,
    temperature: 0.3,
    stream: false,
    prompt: "Translate ${sourceText}",
    customParams: "",
  };
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    engine1: engineWith("smart-engine1", "glm-4.6"),
    engine2: engineWith("smart-engine2", "glm-4.6"),
    engine3: engineWith("smart-engine3", "glm-4.6"),
    activeEngineId: "smart-engine1",
    targetLanguage: "zh-CN",
    sourceLanguage: "en",
    popupWidth: 420,
    popupHeight: 120,
    fontFamily: "system",
    fontCustom: "",
    fontSize: 14,
    lineHeight: 1.6,
    autoTranslate: true,
    skipChinese: true,
    ...overrides,
  };
}

// 非流式成功响应的构造辅助
function okWith(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

describe("cache.ts 纯缓存行为", () => {
  beforeEach(() => {
    clearTranslateCache();
  });

  it("key 为 引擎|模型|源语言|目标语言|原文 五元组", () => {
    expect(buildCacheKey("e1", "m1", "en", "zh-CN", "hi")).toBe(
      "e1|m1|en|zh-CN|hi",
    );
  });

  it("容量 100, 超出淘汰最旧条目", () => {
    for (let i = 0; i < 100; i++) {
      cachePut(`k${i}`, `v${i}`);
    }
    expect(cacheSize()).toBe(100);
    // 第 101 条挤掉迭代序首位的 k0
    cachePut("k100", "v100");
    expect(cacheSize()).toBe(100);
    expect(cacheGet("k0")).toBeUndefined();
    expect(cacheGet("k100")).toBe("v100");
    // LRU 语义: 命中 k1 会把它移到最新, 之后再写入淘汰的是次旧的 k2
    expect(cacheGet("k1")).toBe("v1");
    cachePut("k101", "v101");
    expect(cacheGet("k2")).toBeUndefined();
    expect(cacheGet("k1")).toBe("v1");
  });

  it("重复写入同一 key 不产生重复条目且刷新序位", () => {
    cachePut("a", "1");
    cachePut("b", "2");
    cachePut("a", "1-new");
    expect(cacheSize()).toBe(2);
    expect(cacheGet("a")).toBe("1-new");
  });
});

describe("translateText 缓存接线", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTranslateCache();
    // 直接以内存态写入设置单例(未 bindPrefs 时不落盘, 测试间互不污染)
    setSettings(makeSettings());
    setSecret("smart-engine1", "fake-key");
  });

  it("同一请求第二次命中缓存: fetch 计数为 0 且返回缓存值, onProgress 回放一次", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock.mockResolvedValue(okWith("压电响应"));

    const first = await translateText("piezoelectric response");
    expect(first).toBe("压电响应");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 第二次: 命中缓存, 不再发起请求
    const second = await translateText("piezoelectric response");
    expect(second).toBe("压电响应");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    expect(fetchMock).toHaveBeenCalledTimes(0);

    // 命中路径把缓存值经 onProgress 回放一次
    const progress: string[] = [];
    const third = await translateText("piezoelectric response", (p) =>
      progress.push(p),
    );
    expect(third).toBe("压电响应");
    expect(progress).toEqual(["压电响应"]);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("不同原文不串缓存", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock
      .mockResolvedValueOnce(okWith("译文甲"))
      .mockResolvedValueOnce(okWith("译文乙"));
    expect(await translateText("hello")).toBe("译文甲");
    expect(await translateText("world")).toBe("译文乙");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("同一原文换模型不吃旧结果", async () => {
    const fetchMock = (globalThis as any).fetch;
    fetchMock
      .mockResolvedValueOnce(okWith("旧模型译文"))
      .mockResolvedValueOnce(okWith("新模型译文"));
    expect(await translateText("hello")).toBe("旧模型译文");

    // 换模型: key 中 model 变化, 必须重新请求
    setSettings(makeSettings({ engine1: engineWith("smart-engine1", "glm-4.5") }));
    expect(await translateText("hello")).toBe("新模型译文");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("失败不缓存, 下次调用仍发起真实请求", async () => {
    const fetchMock = (globalThis as any).fetch;
    // 网络层直接拒绝: 非可重试错误, withRetry 立即抛出, 测试快速失败
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(translateText("retry me")).rejects.toThrow("network down");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 恢复后重试: 必须真实发请求(未吃到缓存), 成功后才入缓存
    fetchMock.mockResolvedValueOnce(okWith("重试后的译文"));
    expect(await translateText("retry me")).toBe("重试后的译文");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 成功之后的第三次调用才命中缓存
    fetchMock.mockClear();
    expect(await translateText("retry me")).toBe("重试后的译文");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
