/**
 * 自动故障转移测试(契约 20260911-01):
 * - isFailoverEligible 错误分类(429/401/403/5xx/TypeError 可转移, 400/停用终闸不可转移)
 * - buildEngineCandidates 候选链(active 优先/空密钥跳过/全空返空)
 * - translateText 候选链集成(stub fetch): 401 转移成功 / 400 不转移 / 网络错误转移 /
 *   当前引擎无密钥直接用备用 / 全无密钥抛中文错误 / 开关关闭不转移
 * - 粘性切换: 连续 3 次救活后记住引擎并持久化, 第 4 次直奔该引擎; 直接成功清零计数
 * - settings.autoFailover 默认与校验
 * - translate-store.resolveEngine 故障转移标记
 *
 * 隔离策略: data.ts 持有模块级连续转移计数与缓存单例, 用例之间用
 * vi.resetModules() + 动态 import 取全新模块图, 避免用例顺序互相污染
 * (retry/settings 也必须从同一新模块图取, 否则 instanceof 判定跨实例失效)。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EngineConfig, Settings } from "../../src/types";

const PREF_KEY = "smarttranslate.settings";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

/** 取全新模块图: retry(错误类) + settings + data, 三者共享同一实例注册表 */
async function newEnv() {
  vi.resetModules();
  const retry = await import("../../src/engine/retry");
  const settings = await import("../../src/engine/settings");
  const data = await import("../../src/data");
  const store = await import("../../src/engine/translate-store");
  return { retry, settings, data, store };
}

function engine(id: string, name: string): EngineConfig {
  return {
    id,
    name,
    endPoint: "https://example.invalid/api",
    model: "glm-4.6",
    temperature: 0.3,
    // 非流式: stub fetch 只提供 json(), 走响应体解析分支
    stream: false,
    prompt: "Translate ${sourceText}",
    customParams: "",
  };
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
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
    ...overrides,
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

/** 成功响应 stub(非流式 json 分支) */
function okResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  };
}

/** 失败响应 stub: body 刻意不含 1210, 避免触发 gpt-service 的降级重试 */
function errResponse(status: number, body: string) {
  return { ok: false, status, text: async () => body };
}

/** 绑定假 pref 并把三引擎密钥设为 engine1/engine2 有、engine3 空 */
async function setupChainEnv() {
  const env = await newEnv();
  const prefs = new FakePrefsStore();
  env.settings.bindPrefs(prefs);
  env.settings.setSettings(makeSettings());
  env.settings.setActiveEngine("smart-engine1");
  env.settings.setSecret("smart-engine1", "key-1");
  env.settings.setSecret("smart-engine2", "key-2");
  env.settings.setSecret("smart-engine3", "");
  return { ...env, prefs };
}

function ids(engines: EngineConfig[]): string[] {
  return engines.map((e) => e.id);
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("isFailoverEligible 错误分类", () => {
  it("RateLimitError / 401 / 403 / 429 / 5xx / TypeError 均可转移", async () => {
    const { retry, data } = await newEnv();
    expect(data.isFailoverEligible(new retry.RateLimitError("限流", 429))).toBe(true);
    expect(data.isFailoverEligible(new retry.APIError("密钥失效", 401))).toBe(true);
    expect(data.isFailoverEligible(new retry.APIError("无访问权限", 403))).toBe(true);
    expect(data.isFailoverEligible(new retry.APIError("配额已用尽", 429))).toBe(true);
    expect(data.isFailoverEligible(new retry.APIError("服务端故障", 503))).toBe(true);
    expect(data.isFailoverEligible(new retry.APIError("服务端故障", 500))).toBe(true);
    expect(data.isFailoverEligible(new TypeError("fetch failed"))).toBe(true);
  });

  it("400 与其他错误不可转移", async () => {
    const { retry, data } = await newEnv();
    expect(data.isFailoverEligible(new retry.APIError("请求参数有误", 400))).toBe(false);
    // 无状态码的 APIError(配置类中文错误)同样不转移
    expect(data.isFailoverEligible(new retry.APIError("引擎未配置"))).toBe(false);
    expect(data.isFailoverEligible(new Error("boom"))).toBe(false);
    expect(data.isFailoverEligible("boom")).toBe(false);
    expect(data.isFailoverEligible(undefined)).toBe(false);
  });

  it("停用终闸的 500 靠 code 标记与 503 区分, 不参与转移", async () => {
    const env = await newEnv();
    env.data.data.alive = false;
    let caught: unknown;
    try {
      await env.data.translateText("hello");
    } catch (e) {
      caught = e;
    } finally {
      env.data.data.alive = true;
    }
    // 状态码保持 500(不破坏既有断言), 但带可识别标记
    expect(caught).toMatchObject({
      statusCode: 500,
      code: env.data.ALIVE_GATE_CODE,
    });
    expect(env.data.isFailoverEligible(caught)).toBe(false);
    // 同为 500 的服务端故障仍可转移, 证明区分没有误伤
    expect(env.data.isFailoverEligible(new env.retry.APIError("服务端故障", 500))).toBe(true);
  });
});

describe("buildEngineCandidates 候选链", () => {
  const all: Record<string, string> = {
    "smart-engine1": "key-1",
    "smart-engine2": "key-2",
    "smart-engine3": "key-3",
  };

  it("active 优先, 其余按 engine1/2/3 顺序跟随", async () => {
    const { data } = await newEnv();
    const settings = makeSettings({ activeEngineId: "smart-engine2" });
    expect(ids(data.buildEngineCandidates(settings, all))).toEqual([
      "smart-engine2",
      "smart-engine1",
      "smart-engine3",
    ]);
  });

  it("跳过未配置密钥或纯空白的引擎", async () => {
    const { data } = await newEnv();
    const settings = makeSettings();
    expect(
      ids(
        data.buildEngineCandidates(settings, {
          "smart-engine1": "key-1",
          "smart-engine2": "   ",
        }),
      ),
    ).toEqual(["smart-engine1"]);
  });

  it("全部无密钥时返回空数组", async () => {
    const { data } = await newEnv();
    expect(data.buildEngineCandidates(makeSettings(), {})).toEqual([]);
  });

  it("当前引擎无密钥时备用引擎排在最前", async () => {
    const { data } = await newEnv();
    const settings = makeSettings();
    expect(
      ids(data.buildEngineCandidates(settings, { "smart-engine3": "key-3" })),
    ).toEqual(["smart-engine3"]);
  });
});

describe("translateText 候选链集成", () => {
  it("engine1 401 → engine2 成功: 返回备用译文并回调 failover=true", async () => {
    const env = await setupChainEnv();
    const resolved: Array<[string, string, boolean]> = [];
    fetchMock
      .mockResolvedValueOnce(errResponse(401, '{"error":"invalid api key"}'))
      .mockResolvedValueOnce(okResponse("备用译文"));

    const out = await env.data.translateText("hello world", undefined, {
      onEngineResolved: (id, name, failover) => resolved.push([id, name, failover]),
    });

    expect(out).toBe("备用译文");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 第二跳带的是备用引擎的密钥
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer key-2");
    expect(resolved).toEqual([
      ["smart-engine1", "Engine 1", false],
      ["smart-engine2", "Engine 2", true],
    ]);
  });

  it("400 不可转移: 原样抛出且只打一次请求", async () => {
    const env = await setupChainEnv();
    fetchMock.mockResolvedValueOnce(errResponse(400, '{"error":"bad model"}'));

    await expect(env.data.translateText("hello world")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("网络 TypeError 可转移", async () => {
    const env = await setupChainEnv();
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okResponse("备用译文"));

    await expect(env.data.translateText("net down")).resolves.toBe("备用译文");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("当前引擎无密钥但备用有: 直接用备用, 不再抛未配置密钥", async () => {
    const env = await newEnv();
    env.settings.bindPrefs(new FakePrefsStore());
    env.settings.setSettings(makeSettings());
    env.settings.setActiveEngine("smart-engine1");
    env.settings.setSecret("smart-engine1", "");
    env.settings.setSecret("smart-engine2", "key-2");

    const resolved: Array<[string, string, boolean]> = [];
    fetchMock.mockResolvedValueOnce(okResponse("备用译文"));

    const out = await env.data.translateText("no key", undefined, {
      onEngineResolved: (id, name, failover) => resolved.push([id, name, failover]),
    });

    expect(out).toBe("备用译文");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual([["smart-engine2", "Engine 2", true]]);
  });

  it("全部无密钥: 抛原有中文错误且不发请求", async () => {
    const env = await newEnv();
    env.settings.bindPrefs(new FakePrefsStore());
    env.settings.setSettings(makeSettings());
    env.settings.setActiveEngine("smart-engine1");

    await expect(env.data.translateText("no key at all")).rejects.toThrow(
      /未配置 API 密钥/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("autoFailover=false: 当前引擎失败直接抛出, 不转移", async () => {
    const env = await setupChainEnv();
    env.settings.setSettings({ ...env.settings.getSettings(), autoFailover: false });
    fetchMock.mockResolvedValueOnce(errResponse(401, '{"error":"invalid api key"}'));

    await expect(env.data.translateText("no failover")).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("completeText 同构走候选链(engine1 401 → engine2 成功)", async () => {
    const env = await setupChainEnv();
    fetchMock
      .mockResolvedValueOnce(errResponse(401, '{"error":"invalid api key"}'))
      .mockResolvedValueOnce(okResponse("备用分析结果"));

    await expect(env.data.completeText("summarize this")).resolves.toBe(
      "备用分析结果",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer key-2");
  });
});

describe("粘性切换与连续计数", () => {
  it("连续 3 次靠故障转移救活后记住 engine2 并持久化, 第 4 次直奔 engine2", async () => {
    const env = await setupChainEnv();

    for (let i = 0; i < 3; i++) {
      fetchMock
        .mockResolvedValueOnce(errResponse(401, '{"error":"invalid api key"}'))
        .mockResolvedValueOnce(okResponse(`译文${i}`));
      await expect(env.data.translateText(`text-${i}`)).resolves.toBe(`译文${i}`);
    }

    expect(env.settings.getSettings().activeEngineId).toBe("smart-engine2");
    expect(
      (JSON.parse(env.prefs.get(PREF_KEY) as string) as Settings).activeEngineId,
    ).toBe("smart-engine2");

    // 第 4 次: 换新原文避开缓存, 只打一次请求且直奔 engine2
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(okResponse("译文3"));
    await expect(env.data.translateText("text-3")).resolves.toBe("译文3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer key-2");
  });

  it("当前引擎直接成功会清零连续计数, 后续 2 次转移不再触发切换", async () => {
    const env = await setupChainEnv();

    // 2 次故障转移(未达阈值)
    for (let i = 0; i < 2; i++) {
      fetchMock
        .mockResolvedValueOnce(errResponse(401, '{"error":"invalid api key"}'))
        .mockResolvedValueOnce(okResponse(`译文${i}`));
      await env.data.translateText(`fail-${i}`);
    }
    expect(env.settings.getSettings().activeEngineId).toBe("smart-engine1");

    // 1 次当前引擎直接成功 → 计数清零(累计 2*2+1 = 5 次请求)
    fetchMock.mockResolvedValueOnce(okResponse("直译结果"));
    await expect(env.data.translateText("direct-ok")).resolves.toBe("直译结果");
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // 再 2 次故障转移: 若计数未清零, 累计 4 次会触发切换; 清零后仅累计 2 次
    for (let i = 0; i < 2; i++) {
      fetchMock
        .mockResolvedValueOnce(errResponse(401, '{"error":"invalid api key"}'))
        .mockResolvedValueOnce(okResponse(`译文${i + 2}`));
      await env.data.translateText(`fail-again-${i}`);
    }
    expect(env.settings.getSettings().activeEngineId).toBe("smart-engine1");
  });
});

describe("settings.autoFailover", () => {
  it("默认开启", async () => {
    const { settings } = await newEnv();
    expect(settings.getSettings().autoFailover).toBe(true);
  });

  it("字段缺失/非法类型回落 true, 合法 false 保留", async () => {
    const { settings } = await newEnv();
    const prefs = new FakePrefsStore();

    // 旧版数据无该字段(JSON 序列化后即缺失) → 默认 true
    const legacy = makeSettings();
    delete (legacy as unknown as Record<string, unknown>).autoFailover;
    prefs.set(PREF_KEY, JSON.stringify(legacy));
    settings.bindPrefs(prefs);
    expect(settings.getSettings().autoFailover).toBe(true);

    // 非法类型一律回落 true
    prefs.set(
      PREF_KEY,
      JSON.stringify({ ...makeSettings(), autoFailover: "yes" }),
    );
    settings.bindPrefs(prefs);
    expect(settings.getSettings().autoFailover).toBe(true);

    // 合法 false 必须保留(typeof 判断而非真值判断)
    prefs.set(
      PREF_KEY,
      JSON.stringify({ ...makeSettings(), autoFailover: false }),
    );
    settings.bindPrefs(prefs);
    expect(settings.getSettings().autoFailover).toBe(false);
  });
});

describe("translate-store.resolveEngine", () => {
  it("running 态覆盖引擎元信息并带 failover 标记, finish 后保留", async () => {
    const { store } = await newEnv();
    const s = store.createTranslateStore();
    // 代际令牌: begin 返回 gen, 后续回调必须原样带回(新签名首参)
    const gen = s.begin("原文", "smart-engine1", "Engine 1");
    s.resolveEngine(gen, "smart-engine2", "Engine 2", true);
    expect(s.getRecord()).toMatchObject({
      engineId: "smart-engine2",
      engineName: "Engine 2",
      failover: true,
    });
    s.finish(gen, "译文");
    expect(s.getRecord()).toMatchObject({
      status: "done",
      engineName: "Engine 2",
      failover: true,
    });
  });

  it("非 running 态的迟到回调被忽略, begin 重置 failover", async () => {
    const { store } = await newEnv();
    const s = store.createTranslateStore();
    const gen = s.begin("原文", "smart-engine1", "Engine 1");
    s.resolveEngine(gen, "smart-engine2", "Engine 2", true);
    s.finish(gen, "译文");

    // 结束后的迟到回调不得覆盖已渲染的记录(同代际但已非 running 态)
    s.resolveEngine(gen, "smart-engine3", "Engine 3", false);
    expect(s.getRecord()).toMatchObject({
      engineId: "smart-engine2",
      failover: true,
    });

    // 新一次 begin 先按当前引擎占位, 故障转移标记复位
    s.begin("新原文", "smart-engine1", "Engine 1");
    expect(s.getRecord()).toMatchObject({
      engineId: "smart-engine1",
      failover: false,
      status: "running",
    });
  });
});
