/**
 * 翻译取消(AbortController 贯穿)测试(契约 20260913-06):
 * - signal 从 translateText 一路透传到 fetch(整段路径);
 * - fetch reject AbortError: 不重试(恰 1 次请求)、不换引擎(故障转移排除)、
 *   统一转 CancelledError 上抛;
 * - 取消路径不写任何缓存(整段与句子缓存都不写)。
 *
 * 隔离策略与 data-failover.test.ts 相同: data.ts 持有模块级缓存单例,
 * 用例之间 vi.resetModules() + 动态 import 取全新模块图,
 * 错误类(retry/errors)必须从同一新模块图取, 否则 instanceof 判定跨实例失效。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Settings } from "../../src/types";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

async function newEnv() {
  vi.resetModules();
  const retry = await import("../../src/engine/retry");
  const errors = await import("../../src/engine/errors");
  const settings = await import("../../src/engine/settings");
  const cache = await import("../../src/engine/cache");
  const data = await import("../../src/data");
  return { retry, errors, settings, cache, data };
}

function engine(id: string, name: string) {
  return {
    id,
    name,
    endPoint: "https://example.invalid/api",
    model: "glm-4.6",
    temperature: 0.3,
    stream: false,
    prompt: "Translate ${sourceText}",
    customParams: "",
  };
}

function makeSettings(): Settings {
  return {
    engine1: engine("smart-engine1", "Engine 1"),
    engine2: engine("smart-engine2", "Engine 2"),
    engine3: engine("smart-engine3", "Engine 3"),
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
    autoFailover: true,
    panelSplitRatio: 0.5,
    writebackMode: "off",
  };
}

class FakePrefsStore {
  private map = new Map<string, unknown>();
  get(key: string): unknown {
    return this.map.get(key);
  }
  set(key: string, value: unknown): void {
    this.map.set(key, value);
  }
}

/** AbortError 模拟: fetch 被 abort 后以 name="AbortError" 的错误拒绝 */
function makeAbortError(): Error {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
}

function okResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  };
}

/** 建好双引擎有密钥的候选链环境(供故障转移排除断言使用) */
async function setupEnv() {
  const env = await newEnv();
  env.settings.bindPrefs(new FakePrefsStore());
  env.settings.setSettings(makeSettings());
  env.settings.setActiveEngine("smart-engine1");
  env.settings.setSecret("smart-engine1", "key-1");
  env.settings.setSecret("smart-engine2", "key-2");
  env.settings.setSecret("smart-engine3", "");
  env.cache.clearTranslateCache();
  return env;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("translateText 取消链路", () => {
  it("signal 应透传到 fetch; 成功路径正常返回", async () => {
    const env = await setupEnv();
    fetchMock.mockResolvedValueOnce(okResponse("译文"));
    const controller = new AbortController();
    const out = await env.data.translateText("hello", undefined, {
      signal: controller.signal,
    });
    expect(out).toBe("译文");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // fetch init 里携带的就是调用方传入的 signal
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("fetch reject AbortError: 转 CancelledError 上抛且不重试(恰 1 次请求)", async () => {
    const env = await setupEnv();
    fetchMock.mockRejectedValueOnce(makeAbortError());

    await expect(
      env.data.translateText("hello", undefined, {
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(env.errors.CancelledError);
    // 退避重试层把 AbortError 排除在可重试之外: 用户取消绝不再发请求
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("取消不触发故障转移: engine1 被取消后 engine2 不被打扰", async () => {
    const env = await setupEnv();
    fetchMock.mockRejectedValueOnce(makeAbortError());

    await expect(
      env.data.translateText("hello", undefined, {
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(env.errors.CancelledError);
    // 若 AbortError 参与故障转移, 这里会是 2 次请求
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("取消路径不写缓存: 失败后 cacheSize 为 0", async () => {
    const env = await setupEnv();
    fetchMock.mockRejectedValueOnce(makeAbortError());
    await expect(
      env.data.translateText("hello", undefined, {
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(env.errors.CancelledError);
    // 整段缓存与句子缓存都没有被取消路径污染
    expect(env.cache.cacheSize()).toBe(0);
    expect(env.cache.segmentCacheSize()).toBe(0);
  });

  it("已 abort 的 signal 进入时: 模拟 fetch 立即拒绝, 不走故障转移", async () => {
    const env = await setupEnv();
    const controller = new AbortController();
    controller.abort();
    // stub fetch 尊重 signal: 已 abort 即以 AbortError 拒绝(真实 fetch 同语义)
    fetchMock.mockImplementation((_url: unknown, init: any) =>
      init?.signal?.aborted
        ? Promise.reject(makeAbortError())
        : Promise.resolve(okResponse("不应到达")),
    );
    await expect(
      env.data.translateText("hello", undefined, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(env.errors.CancelledError);
    // 取消不换引擎: 只有 engine1 一次调用
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(env.cache.cacheSize()).toBe(0);
  });
});

describe("isFailoverEligible 取消排除", () => {
  it("CancelledError 与 AbortError 均不可转移", async () => {
    const { retry, errors, data } = await newEnv();
    expect(data.isFailoverEligible(new errors.CancelledError())).toBe(false);
    expect(data.isFailoverEligible(makeAbortError())).toBe(false);
    // 对照: TypeError(网络失败)仍可转移, 证明排除条件没有误伤
    expect(data.isFailoverEligible(new TypeError("fetch failed"))).toBe(true);
    expect(typeof retry.isAbortError).toBe("function");
  });
});
