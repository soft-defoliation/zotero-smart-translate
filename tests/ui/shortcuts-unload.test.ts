/**
 * Alt+B 侧栏快捷键(registerSidebarShortcut)注册/卸载测试:
 * - reader 标签下 Alt+B -> toggleSidebar 调用一次且 preventDefault;
 * - 非 reader 标签(Reader.getByTabID 无结果)不劫持 Alt+B;
 * - 卸载后 keydown 监听移除, 再触发不回调。
 * 用最小 fake win + vi.mock sidebar 模块, 只验证引用与调用序列,
 * 真实 Zotero 窗口行为归 tester 真机验证。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/ui/sidebar", () => ({
  toggleSidebar: vi.fn(),
}));

import { toggleSidebar } from "../../src/ui/sidebar";
import { registerSidebarShortcut } from "../../src/ui/shortcuts";

const toggleSidebarMock = vi.mocked(toggleSidebar);

/** 最小主窗口 fake: keydown 监听收集 + 激活标签 id */
function makeFakeWin(selectedID: string | undefined) {
  const listeners = new Map<string, Set<(ev?: unknown) => void>>();
  return {
    Zotero_Tabs: { selectedID },
    addEventListener(type: string, fn: (ev?: unknown) => void): void {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (ev?: unknown) => void): void {
      listeners.get(type)?.delete(fn);
    },
    listenerCount(type: string): number {
      return listeners.get(type)?.size ?? 0;
    },
    fire(type: string, ev?: unknown): void {
      for (const fn of Array.from(listeners.get(type) ?? [])) fn(ev);
    },
  };
}

/** 最小 Zotero fake: getByTabID 按用例返回 reader 或 undefined */
function makeFakeZotero(win: ReturnType<typeof makeFakeWin>, reader: any) {
  return {
    getMainWindows: () => [win],
    Reader: { getByTabID: vi.fn(() => reader) },
  };
}

describe("registerSidebarShortcut(Alt+B 侧栏快捷键)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reader 标签下 Alt+B 触发 toggleSidebar 一次并 preventDefault", () => {
    const win = makeFakeWin("tab-1");
    const reader = { id: "reader-1" };
    const fakeZotero = makeFakeZotero(win, reader);
    const unregister = registerSidebarShortcut(fakeZotero);
    expect(win.listenerCount("keydown")).toBe(1);

    // 小写 b 也要命中(key 统一 toUpperCase 比较)
    const preventDefault = vi.fn();
    win.fire("keydown", { altKey: true, key: "b", preventDefault });
    expect(fakeZotero.Reader.getByTabID).toHaveBeenCalledWith("tab-1");
    expect(toggleSidebarMock).toHaveBeenCalledTimes(1);
    expect(toggleSidebarMock).toHaveBeenCalledWith(reader);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("非 reader 标签(getByTabID 无结果)下 Alt+B 不劫持不 preventDefault", () => {
    const win = makeFakeWin("zotero-pane");
    const fakeZotero = makeFakeZotero(win, undefined);
    registerSidebarShortcut(fakeZotero);

    const preventDefault = vi.fn();
    win.fire("keydown", { altKey: true, key: "B", preventDefault });
    expect(toggleSidebarMock).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("卸载后 keydown 监听被移除, 再触发不回调", () => {
    const win = makeFakeWin("tab-1");
    const fakeZotero = makeFakeZotero(win, { id: "reader-1" });
    const unregister = registerSidebarShortcut(fakeZotero);

    unregister();
    expect(win.listenerCount("keydown")).toBe(0);
    win.fire("keydown", { altKey: true, key: "B", preventDefault: vi.fn() });
    expect(toggleSidebarMock).not.toHaveBeenCalled();
  });
});
