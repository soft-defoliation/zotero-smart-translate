/**
 * 划词弹窗监听卸载测试(P1-5 卸载清理):
 * registerReaderUI 登记的 renderTextSelectionPopup handler 必须能经
 * unregisterReaderUI 以同一引用移除; 注册失败(老版本无此事件)时卸载
 * 不应误调 unregister。handler 内部的弹窗构建/翻译互斥逻辑依赖完整
 * Zotero event, 归 tester 真机验证, 此处只测注册/卸载配对。
 */

import { describe, it, expect } from "vitest";
import {
  registerReaderUI,
  unregisterReaderUI,
} from "../../src/ui/reader";

/** 最小 Zotero.Reader fake: 记录注册/注销的 type 与 handler 引用 */
function makeFakeReader() {
  const registered: Array<{ type: string; handler: unknown; pluginID?: string }> = [];
  const unregistered: Array<{ type: string; handler: unknown }> = [];
  return {
    registered,
    unregistered,
    registerEventListener(
      type: string,
      handler: unknown,
      pluginID?: string,
    ): void {
      registered.push({ type, handler, pluginID });
    },
    unregisterEventListener(type: string, handler: unknown): void {
      unregistered.push({ type, handler });
    },
  };
}

describe("registerReaderUI/unregisterReaderUI 配对", () => {
  it("卸载应以同一 handler 引用调 unregisterEventListener", () => {
    const reader = makeFakeReader();
    const Zotero = { Reader: reader };
    registerReaderUI(Zotero, "addon-id-test");
    expect(reader.registered).toHaveLength(1);
    expect(reader.registered[0].type).toBe("renderTextSelectionPopup");
    expect(reader.registered[0].pluginID).toBe("addon-id-test");

    unregisterReaderUI();
    expect(reader.unregistered).toHaveLength(1);
    expect(reader.unregistered[0].type).toBe("renderTextSelectionPopup");
    // 引用一致: Zotero 侧以函数引用为键, 换包装函数会移除失败
    expect(reader.unregistered[0].handler).toBe(reader.registered[0].handler);

    // 重复卸载是幂等 no-op
    unregisterReaderUI();
    expect(reader.unregistered).toHaveLength(1);
  });

  it("注册抛错(老版本)时卸载不误调 unregister 且不抛", () => {
    let unregisterCalls = 0;
    const Zotero = {
      Reader: {
        registerEventListener() {
          throw new Error("no such event");
        },
        unregisterEventListener() {
          unregisterCalls += 1;
        },
      },
    };
    expect(() => registerReaderUI(Zotero, "addon-id-test")).not.toThrow();
    expect(() => unregisterReaderUI()).not.toThrow();
    expect(unregisterCalls).toBe(0);
  });

  it("Zotero.Reader 缺失时注册/卸载均为 no-op", () => {
    expect(() => registerReaderUI({}, "addon-id-test")).not.toThrow();
    expect(() => unregisterReaderUI()).not.toThrow();
  });
});
