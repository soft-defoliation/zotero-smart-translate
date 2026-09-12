/**
 * isMostlyChinese 纯函数测试 + skipChinese 设置字段用例
 * (默认 true / 非法类型回落 — 归入本文件因任务边界只允许新建测试文件)。
 */

import { describe, it, expect } from "vitest";
import { isMostlyChinese } from "../../src/engine/lang-detect";
import { bindPrefs, getSettings } from "../../src/engine/settings";
import type { PrefsStore } from "../../src/engine/settings";

describe("isMostlyChinese", () => {
  it("纯中文句判为中文", () => {
    expect(isMostlyChinese("铁电材料在外电场下发生极化翻转。")).toBe(true);
  });

  it("纯英文句判为非中文", () => {
    expect(
      isMostlyChinese("Ferroelectric materials exhibit piezoelectric response."),
    ).toBe(false);
  });

  it("中英混排学术句按实际占比判定: CJK 10/非空白 23 约 0.43 > 0.3, 判为中文", () => {
    // 铁电体(3) + ferroelectric(13) + 材料的压电响应(7) = 非空白 23 字符,
    // 其中 CJK 10 字符; 该句本质是中文句(夹杂英文术语), 判为中文并跳过不算误杀
    expect(isMostlyChinese("铁电体 ferroelectric 材料的压电响应")).toBe(true);
  });

  it("英文句偶含个别中文字符: 占比远低于 0.3, 不误杀", () => {
    // The/term/appears/here 共 18 个字母 + 铁电体 3 个 CJK: 3/21 约 0.14 < 0.3
    expect(isMostlyChinese("The term 铁电体 appears here")).toBe(false);
  });

  it("空串判为非中文", () => {
    expect(isMostlyChinese("")).toBe(false);
  });

  it("纯符号/标点/空白判为非中文", () => {
    expect(isMostlyChinese("!!!???...,;;;")).toBe(false);
    expect(isMostlyChinese("   ")).toBe(false);
  });

  it("只采样前 200 字符, 采样段全英文则判为非中文", () => {
    const englishSample = "a".repeat(200);
    expect(isMostlyChinese(`${englishSample}中文中文中文`)).toBe(false);
  });

  it("中文标点计入分母不计分子, 高占比句仍判为中文", () => {
    // 10 个汉字 + 1 个中文句号: 10/11 约 0.91 > 0.3
    expect(isMostlyChinese("铁电材料具有压电效应。")).toBe(true);
  });
});

// settings 模块为单例: 本组用例放在文件末尾, 避免污染上面的纯函数用例
describe("skipChinese 设置", () => {
  class FakePrefsStore implements PrefsStore {
    private map = new Map<string, unknown>();
    get(key: string): unknown {
      return this.map.get(key);
    }
    set(key: string, value: unknown): void {
      this.map.set(key, value);
    }
  }

  it("默认值为 true", () => {
    bindPrefs(new FakePrefsStore());
    expect(getSettings().skipChinese).toBe(true);
  });

  it("非法类型(字符串)回落默认 true", () => {
    const store = new FakePrefsStore();
    // 模拟 prefs-pane 写出脏数据: skipChinese 为字符串
    store.set(
      "smarttranslate.settings",
      JSON.stringify({ ...getSettings(), skipChinese: "yes" }),
    );
    bindPrefs(store);
    expect(getSettings().skipChinese).toBe(true);
  });

  it("合法 false 原样保留(用户显式关闭)", () => {
    const store = new FakePrefsStore();
    store.set(
      "smarttranslate.settings",
      JSON.stringify({ ...getSettings(), skipChinese: false }),
    );
    bindPrefs(store);
    expect(getSettings().skipChinese).toBe(false);
  });
});
