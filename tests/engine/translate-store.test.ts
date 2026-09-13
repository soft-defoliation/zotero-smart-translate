/**
 * translate-store 纯数据逻辑测试: 状态流转 + 面板注册表。
 * node 环境 globalThis.Zotero 未定义, getShared* 回落模块私有实例;
 * 本文件直接测 create* 工厂, 每个用例独立实例, 无单例状态耦合。
 */

import { describe, it, expect } from "vitest";
import {
  createTranslateStore,
  createPanelRegistry,
} from "../../src/engine/translate-store";

describe("createTranslateStore 状态流转", () => {
  it("初始为 idle 空记录", () => {
    const store = createTranslateStore();
    const record = store.getRecord();
    expect(record.status).toBe("idle");
    expect(record.raw).toBe("");
    expect(record.result).toBe("");
    expect(record.engineId).toBe("");
    expect(record.engineName).toBe("");
    expect(record.fromSelection).toBe(false);
    expect(record.updatedAt).toBe(0);
    expect(record.errorMessage).toBe("");
  });

  it("idle -> begin -> finish: running 后置 done 并更新结果与时间", () => {
    const store = createTranslateStore();
    const gen = store.begin("hello", "smart-engine1", "Engine 1");
    const running = store.getRecord();
    expect(running.status).toBe("running");
    expect(running.raw).toBe("hello");
    expect(running.engineId).toBe("smart-engine1");
    expect(running.engineName).toBe("Engine 1");
    expect(running.result).toBe("");

    store.setPartial(gen, "hel");
    expect(store.getRecord().result).toBe("hel");

    store.finish(gen, "你好");
    const done = store.getRecord();
    expect(done.status).toBe("done");
    expect(done.result).toBe("你好");
    expect(done.updatedAt).toBeGreaterThan(0);
  });

  it("begin 应清空上次结果与错误, fromSelection 默认 false", () => {
    const store = createTranslateStore();
    const first = store.begin("a", "e1", "E1", true);
    store.finish(first, "A");
    store.begin("b", "e2", "E2");
    const record = store.getRecord();
    expect(record.status).toBe("running");
    expect(record.result).toBe("");
    expect(record.errorMessage).toBe("");
    expect(record.raw).toBe("b");
    expect(record.fromSelection).toBe(false);
  });

  it("fail 置 error 并保留旧译文(设计稿: 失败不清空译文框)", () => {
    const store = createTranslateStore();
    const gen = store.begin("hello", "e1", "E1");
    store.setPartial(gen, "你好");
    store.fail(gen, "网络请求失败");
    const record = store.getRecord();
    expect(record.status).toBe("error");
    expect(record.errorMessage).toBe("网络请求失败");
    expect(record.result).toBe("你好");
  });

  it("非 running 态的 setPartial 应被忽略", () => {
    const store = createTranslateStore();
    const gen = store.begin("x", "e1", "E1");
    store.finish(gen, "X");
    store.setPartial(gen, "late");
    expect(store.getRecord().result).toBe("X");
  });

  it("fromSelection=true 应标记划词同步来源", () => {
    const store = createTranslateStore();
    store.begin("selected text", "e1", "E1", true);
    expect(store.getRecord().fromSelection).toBe(true);
  });

  it("旧代际的 setPartial/resolveEngine/finish 全部被丢弃", () => {
    const store = createTranslateStore();
    const gen1 = store.begin("旧原文", "e1", "E1");
    const gen2 = store.begin("新原文", "e2", "E2");
    expect(gen2).toBeGreaterThan(gen1);
    // 新代际的进度先落地
    store.setPartial(gen2, "新进度");
    expect(store.getRecord().result).toBe("新进度");

    // 旧代的迟到回调一律不生效: result/引擎元信息/状态都保持新代际的值
    store.setPartial(gen1, "旧进度");
    store.resolveEngine(gen1, "old-engine", "Old Engine", true);
    store.finish(gen1, "旧结果");
    const record = store.getRecord();
    expect(record.result).toBe("新进度");
    expect(record.status).toBe("running");
    expect(record.raw).toBe("新原文");
    expect(record.engineId).toBe("e2");
    expect(record.engineName).toBe("E2");
    expect(record.failover).toBe(false);
  });

  it("当前代际 finish 正常置 done", () => {
    const store = createTranslateStore();
    const gen = store.begin("hello", "e1", "E1");
    store.setPartial(gen, "你好");
    store.finish(gen, "你好世界");
    const record = store.getRecord();
    expect(record.status).toBe("done");
    expect(record.result).toBe("你好世界");
  });

  it("新 begin 后旧 finish 不把状态改回 done", () => {
    const store = createTranslateStore();
    const gen1 = store.begin("第一次", "e1", "E1");
    store.finish(gen1, "第一次结果");
    expect(store.getRecord().status).toBe("done");

    // 第二次翻译接管: 界面回到 running
    const gen2 = store.begin("第二次", "e1", "E1");
    store.finish(gen1, "迟到的第一次结果");
    const record = store.getRecord();
    expect(record.status).toBe("running");
    expect(record.result).toBe("");

    // 当前代际完成才落 done
    store.finish(gen2, "第二次结果");
    expect(store.getRecord().status).toBe("done");
    expect(store.getRecord().result).toBe("第二次结果");
  });
});

describe("translate-store 取消与代际 signal", () => {
  it("getSignal 返回当前代际 signal, 未 begin 过时为 undefined", () => {
    const store = createTranslateStore();
    expect(store.getSignal()).toBeUndefined();
    store.begin("a", "e1", "E1");
    const first = store.getSignal();
    expect(first).toBeDefined();
    expect(first!.aborted).toBe(false);
    // 新 begin 换新控制器: signal 是新代际的
    store.begin("b", "e2", "E2");
    expect(store.getSignal()).toBeDefined();
    expect(store.getSignal()).not.toBe(first);
  });

  it("新 begin 真实中止旧代际 signal(旧请求被取消而非后台走完)", () => {
    const store = createTranslateStore();
    store.begin("旧原文", "e1", "E1");
    const oldSignal = store.getSignal();
    expect(oldSignal!.aborted).toBe(false);
    store.begin("新原文", "e2", "E2");
    expect(oldSignal!.aborted).toBe(true);
    // 新代际 signal 不受影响
    expect(store.getSignal()!.aborted).toBe(false);
  });

  it("cancelCurrent: running 时中止当前 signal 并返回 true", () => {
    const store = createTranslateStore();
    expect(store.cancelCurrent()).toBe(false);
    store.begin("hello", "e1", "E1");
    const signal = store.getSignal();
    expect(store.cancelCurrent()).toBe(true);
    expect(signal!.aborted).toBe(true);
  });

  it("cancelCurrent: 非 running 态返回 false, 新一轮 running 恢复可取消", () => {
    const store = createTranslateStore();
    const gen = store.begin("hello", "e1", "E1");
    store.finish(gen, "你好");
    // done 态: 无在途请求可取消
    expect(store.cancelCurrent()).toBe(false);
    expect(store.getRecord().status).toBe("done");
    // 新一轮 begin 回到 running: 再次可取消
    store.begin("again", "e1", "E1");
    expect(store.getRecord().status).toBe("running");
    expect(store.cancelCurrent()).toBe(true);
  });

  it("代际令牌机制不受 abort 影响: 旧代际回调依旧被丢弃", () => {
    const store = createTranslateStore();
    const gen1 = store.begin("旧原文", "e1", "E1");
    // 新 begin 中止旧代际(signal.aborted = true), 但 gen1 的回调失效逻辑不变
    const gen2 = store.begin("新原文", "e2", "E2");
    store.setPartial(gen2, "新进度");
    store.setPartial(gen1, "旧进度");
    store.fail(gen1, "旧失败");
    const record = store.getRecord();
    expect(record.result).toBe("新进度");
    expect(record.status).toBe("running");
    expect(record.errorMessage).toBe("");
  });
});

describe("createPanelRegistry", () => {
  it("add 后 refreshAll 逐一调用, remove 后不再调用", async () => {
    const registry = createPanelRegistry();
    let countA = 0;
    let countB = 0;
    registry.add("uid-a", () => {
      countA += 1;
      return Promise.resolve();
    });
    registry.add("uid-b", async () => {
      countB += 1;
    });
    await registry.refreshAll();
    expect(countA).toBe(1);
    expect(countB).toBe(1);

    registry.remove("uid-a");
    await registry.refreshAll();
    expect(countA).toBe(1);
    expect(countB).toBe(2);
  });

  it("同一 uid 重复 add 应覆盖而不是叠加", async () => {
    const registry = createPanelRegistry();
    let count = 0;
    registry.add("uid", () => Promise.resolve());
    registry.add("uid", () => {
      count += 1;
      return Promise.resolve();
    });
    await registry.refreshAll();
    expect(count).toBe(1);
  });

  it("单个 refresh 抛错不阻断其余面板", async () => {
    const registry = createPanelRegistry();
    let okCount = 0;
    registry.add("bad", () => Promise.reject(new Error("section gone")));
    registry.add("good", () => {
      okCount += 1;
      return Promise.resolve();
    });
    await registry.refreshAll();
    expect(okCount).toBe(1);
  });
});
