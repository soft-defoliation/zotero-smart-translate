/**
 * 菜单/快捷键注册的卸载函数测试(P1-5 卸载清理):
 * - registerItemMenu 返回卸载函数: 移除 popupshowing 监听 + 清除动态菜单项;
 * - registerShortcut 返回卸载函数: 按窗口移除 keydown 监听。
 * 用最小 fake win/menu/menuitem 模拟 XUL DOM, 只验证引用与调用序列,
 * 真实 Zotero 窗口行为归 tester 真机验证。
 */

import { describe, it, expect } from "vitest";
import { registerItemMenu, registerShortcut } from "../../src/ui/menus";

/** 最小 menuitem fake: 记录监听与 remove 调用 */
class FakeMenuItem {
  className = "";
  removed = false;
  listeners = new Map<string, Set<() => void>>();
  setAttribute(_key: string, _value: string): void {}
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  remove(): void {
    this.removed = true;
  }
}

/** 最小 #zotero-itemmenu fake: children 数组 + popupshowing 计数 */
class FakeMenu {
  children: FakeMenuItem[] = [];
  listeners = new Map<string, Set<(ev?: unknown) => void>>();
  addEventListener(type: string, fn: (ev?: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (ev?: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  appendChild(child: FakeMenuItem): void {
    this.children.push(child);
  }
  querySelector(sel: string): FakeMenuItem | undefined {
    const cls = sel.replace(/^\./, "");
    return this.children.find((c) => c.className === cls);
  }
  /** 触发 popupshowing(模拟用户弹开右键菜单) */
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** 最小主窗口 fake(listeners 供用例直接触发 window 级事件) */
function makeFakeWin() {
  const menu = new FakeMenu();
  const listeners = new Map<string, Set<(ev?: unknown) => void>>();
  return {
    menu,
    listeners,
    closed: false,
    document: {
      getElementById(id: string) {
        return id === "zotero-itemmenu" ? menu : null;
      },
      createXULElement() {
        return new FakeMenuItem();
      },
      createElement() {
        return new FakeMenuItem();
      },
    },
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

function makeFakeZotero(win: ReturnType<typeof makeFakeWin>) {
  return { getMainWindows: () => [win] };
}

describe("registerItemMenu 卸载函数", () => {
  it("popupshowing 创建菜单项后, 卸载应移除监听并清掉菜单项", () => {
    const win = makeFakeWin();
    const unregister = registerItemMenu(makeFakeZotero(win), () => {});
    expect(typeof unregister).toBe("function");
    expect(win.menu.listenerCount("popupshowing")).toBe(1);

    // 模拟弹开菜单: 两项动态创建
    win.menu.fire("popupshowing");
    expect(
      win.menu.children.filter((c) => c.className === "smarttranslate-menuitem")
        .length,
    ).toBe(1);
    expect(
      win.menu.children.filter(
        (c) => c.className === "smarttranslate-reading-menuitem",
      ).length,
    ).toBe(1);

    unregister();
    expect(win.menu.listenerCount("popupshowing")).toBe(0);
    // 两个菜单项都被 remove
    expect(win.menu.children.every((c) => c.removed)).toBe(true);
  });

  it("未弹开过菜单时卸载不抛错", () => {
    const win = makeFakeWin();
    const unregister = registerItemMenu(makeFakeZotero(win), () => {});
    expect(() => unregister()).not.toThrow();
  });
});

describe("registerShortcut 卸载函数", () => {
  it("卸载后 keydown 监听被移除, 触发不再回调", () => {
    const win = makeFakeWin();
    let fired = 0;
    const unregister = registerShortcut(makeFakeZotero(win), () => {
      fired += 1;
    });
    expect(win.listenerCount("keydown")).toBe(1);

    // 卸载前: Ctrl+Shift+T 命中回调
    win.fire("keydown", {
      ctrlKey: true,
      shiftKey: true,
      key: "T",
      preventDefault: () => {},
    });
    expect(fired).toBe(1);

    unregister();
    expect(win.listenerCount("keydown")).toBe(0);

    // 卸载后监听已移除, 重复触发不再回调
    win.fire("keydown", {
      ctrlKey: true,
      shiftKey: true,
      key: "T",
      preventDefault: () => {},
    });
    expect(fired).toBe(1);
  });
});
