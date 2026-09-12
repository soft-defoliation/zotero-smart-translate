/**
 * bindPrefs 往返与容错测试 — fake PrefsStore 模拟 Zotero.Prefs。
 * 注意: settings 模块为单例状态, 本文件内用例按声明顺序执行并复用状态。
 */

import { describe, it, expect } from "vitest";
import {
  bindPrefs,
  getSettings,
  setSettings,
  setActiveEngine,
  setPopupSize,
  setPanelSplitRatio,
  getSecret,
  setSecret,
} from "../../src/engine/settings";
import type { PrefsStore } from "../../src/engine/settings";
import type { Settings } from "../../src/types";

const PREF_KEY = "smarttranslate.settings";
const SECRET_KEY = "smarttranslate.secretObj";

class FakePrefsStore implements PrefsStore {
  private map = new Map<string, unknown>();

  get(key: string): unknown {
    return this.map.get(key);
  }

  set(key: string, value: unknown): void {
    this.map.set(key, value);
  }
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  const engine = (id: string) => ({
    id,
    name: id,
    endPoint: "https://example.invalid/api",
    model: "glm-4.6",
    temperature: 0.3,
    stream: false,
    prompt: "Translate ${sourceText}",
    customParams: "",
  });
  return {
    engine1: engine("smart-engine1"),
    engine2: engine("smart-engine2"),
    engine3: engine("smart-engine3"),
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
    // v2 新增必填字段: makeSettings 是 Settings 工厂, 缺字段会在严格
    // 类型检查下报错(存量缺陷, tsconfig exclude tests 曾掩盖)
    skipChinese: true,
    panelSplitRatio: 0.5,
    writebackMode: "off",
    ...overrides,
  };
}

describe("bindPrefs", () => {
  it("应从 pref 加载 settings 与 secrets", () => {
    const store = new FakePrefsStore();
    store.set(PREF_KEY, JSON.stringify(makeSettings({ activeEngineId: "smart-engine3" })));
    store.set(SECRET_KEY, JSON.stringify({ "smart-engine1": "key-1" }));

    bindPrefs(store);

    expect(getSettings().activeEngineId).toBe("smart-engine3");
    expect(getSecret("smart-engine1")).toBe("key-1");
  });

  it("写操作应同步写回 pref 并可恢复", () => {
    const store = new FakePrefsStore();
    bindPrefs(store);

    setSettings(makeSettings({ activeEngineId: "smart-engine2" }));
    setActiveEngine("smart-engine2");
    setSecret("smart-engine2", "key-2");

    const savedSettings = JSON.parse(store.get(PREF_KEY) as string) as Settings;
    expect(savedSettings.activeEngineId).toBe("smart-engine2");
    const savedSecrets = JSON.parse(store.get(SECRET_KEY) as string) as Record<string, string>;
    expect(savedSecrets["smart-engine2"]).toBe("key-2");

    // 写 -> 读恢复: 用另一个 store 重放持久化值再绑定
    const store2 = new FakePrefsStore();
    store2.set(PREF_KEY, store.get(PREF_KEY)!);
    store2.set(SECRET_KEY, store.get(SECRET_KEY)!);
    bindPrefs(store2);

    expect(getSettings().activeEngineId).toBe("smart-engine2");
    expect(getSecret("smart-engine2")).toBe("key-2");
  });

  it("坏 JSON 应静默回退默认值", () => {
    const store = new FakePrefsStore();
    store.set(PREF_KEY, "{oops");
    store.set(SECRET_KEY, "not-json");

    bindPrefs(store);

    const settings = getSettings();
    expect(settings.activeEngineId).toBe("smart-engine1");
    expect(settings.engine1.model).toBe("glm-4.6");
    expect(getSecret("smart-engine1")).toBe("");
  });

  it("pref 为空串时应保持默认值", () => {
    const store = new FakePrefsStore();
    store.set(PREF_KEY, "");
    store.set(SECRET_KEY, "");

    bindPrefs(store);

    expect(getSettings().activeEngineId).toBe("smart-engine1");
    expect(getSecret("smart-engine1")).toBe("");
  });

  it("setPopupSize 应持久化弹窗尺寸且重放后可恢复", () => {
    const store = new FakePrefsStore();
    bindPrefs(store);

    // 模拟 reader 弹窗拖拽 resize 后的尺寸回写
    setPopupSize(520, 220);
    expect(getSettings().popupWidth).toBe(520);
    expect(getSettings().popupHeight).toBe(220);

    const saved = JSON.parse(store.get(PREF_KEY) as string) as Settings;
    expect(saved.popupWidth).toBe(520);
    expect(saved.popupHeight).toBe(220);

    // 写 -> 读恢复: 用另一个 store 重放持久化值再绑定
    const store2 = new FakePrefsStore();
    store2.set(PREF_KEY, store.get(PREF_KEY)!);
    bindPrefs(store2);
    expect(getSettings().popupWidth).toBe(520);
    expect(getSettings().popupHeight).toBe(220);
  });

  it("非法 popupWidth/Height 应回落默认值 420/120", () => {
    const store = new FakePrefsStore();
    // 字符串宽 + null 高(经 JSON 往返后即半初始化数据的典型形态)
    const bad = makeSettings({
      popupWidth: "420px" as unknown as number,
      popupHeight: null as unknown as number,
    });
    store.set(PREF_KEY, JSON.stringify(bad));

    bindPrefs(store);

    expect(getSettings().popupWidth).toBe(420);
    expect(getSettings().popupHeight).toBe(120);
  });

  it("setPopupSize 传入非有限数字时应拒绝写回", () => {
    const store = new FakePrefsStore();
    bindPrefs(store);
    setPopupSize(500, 200);

    setPopupSize(NaN, 200);
    setPopupSize(500, Infinity);

    expect(getSettings().popupWidth).toBe(500);
    expect(getSettings().popupHeight).toBe(200);
  });

  it("旧版持久化数据缺失 v2 字段时应补默认值", () => {
    const store = new FakePrefsStore();
    // 模拟 v1 数据: 只有基础字段, 无字体/自动翻译/侧栏占比字段
    const legacy = JSON.parse(JSON.stringify(makeSettings())) as Record<string, unknown>;
    for (const key of ["fontFamily", "fontCustom", "fontSize", "lineHeight", "autoTranslate", "panelSplitRatio"]) {
      delete legacy[key];
    }
    store.set(PREF_KEY, JSON.stringify(legacy));

    bindPrefs(store);

    const settings = getSettings();
    expect(settings.fontFamily).toBe("system");
    expect(settings.fontCustom).toBe("");
    expect(settings.fontSize).toBe(14);
    expect(settings.lineHeight).toBe(1.6);
    expect(settings.autoTranslate).toBe(true);
    expect(settings.panelSplitRatio).toBe(0.5);
  });

  it("fontSize/lineHeight 越界应 clamp 到 10-24 / 1.2-2.0", () => {
    const store = new FakePrefsStore();
    // 越界上限: 30 收敛到 24, 5 收敛到 2.0
    store.set(PREF_KEY, JSON.stringify(makeSettings({ fontSize: 30, lineHeight: 5 })));
    bindPrefs(store);
    expect(getSettings().fontSize).toBe(24);
    expect(getSettings().lineHeight).toBe(2.0);

    // 越界下限: 2 抬升到 10, 0.5 抬升到 1.2
    store.set(PREF_KEY, JSON.stringify(makeSettings({ fontSize: 2, lineHeight: 0.5 })));
    bindPrefs(store);
    expect(getSettings().fontSize).toBe(10);
    expect(getSettings().lineHeight).toBe(1.2);
  });

  it("v2 字段非法类型应回落默认值", () => {
    const store = new FakePrefsStore();
    const bad = makeSettings({
      fontFamily: 42 as unknown as string,
      fontCustom: null as unknown as string,
      fontSize: "big" as unknown as number,
      lineHeight: NaN,
      autoTranslate: "yes" as unknown as boolean,
    });
    store.set(PREF_KEY, JSON.stringify(bad));

    bindPrefs(store);

    const settings = getSettings();
    expect(settings.fontFamily).toBe("system");
    expect(settings.fontCustom).toBe("");
    expect(settings.fontSize).toBe(14);
    expect(settings.lineHeight).toBe(1.6);
    expect(settings.autoTranslate).toBe(true);
  });

  it("autoTranslate=false 与合法字体字段应原样保留", () => {
    const store = new FakePrefsStore();
    // 布尔校验必须放行合法 false: typeof 判断而非真值判断
    store.set(
      PREF_KEY,
      JSON.stringify(
        makeSettings({ autoTranslate: false, fontFamily: "yahei", fontCustom: "Fira Code" }),
      ),
    );
    bindPrefs(store);

    const settings = getSettings();
    expect(settings.autoTranslate).toBe(false);
    expect(settings.fontFamily).toBe("yahei");
    expect(settings.fontCustom).toBe("Fira Code");
  });

  it("写回模式: 缺失回落 off, 枚举非法回落 off, 合法值保留", () => {
    const store = new FakePrefsStore();

    // 旧版数据缺失该字段 -> 默认 off(不写回)
    const legacy = JSON.parse(JSON.stringify(makeSettings())) as Record<string, unknown>;
    delete legacy.writebackMode;
    store.set(PREF_KEY, JSON.stringify(legacy));
    bindPrefs(store);
    expect(getSettings().writebackMode).toBe("off");

    // 枚举外的值(含旧批注路线的 comment/bilingual)一律回落 off
    store.set(
      PREF_KEY,
      JSON.stringify(makeSettings({ writebackMode: "comment" as unknown as "off" })),
    );
    bindPrefs(store);
    expect(getSettings().writebackMode).toBe("off");

    store.set(
      PREF_KEY,
      JSON.stringify(makeSettings({ writebackMode: 42 as unknown as "off" })),
    );
    bindPrefs(store);
    expect(getSettings().writebackMode).toBe("off");

    // 两个合法收集模式原样保留
    store.set(PREF_KEY, JSON.stringify(makeSettings({ writebackMode: "note" })));
    bindPrefs(store);
    expect(getSettings().writebackMode).toBe("note");

    store.set(
      PREF_KEY,
      JSON.stringify(makeSettings({ writebackMode: "note-bilingual" })),
    );
    bindPrefs(store);
    expect(getSettings().writebackMode).toBe("note-bilingual");
  });

  it("panelSplitRatio 越界应 clamp 到 0.2-0.8, 非法类型回落默认 0.5", () => {
    const store = new FakePrefsStore();
    store.set(PREF_KEY, JSON.stringify(makeSettings({ panelSplitRatio: 0.95 })));
    bindPrefs(store);
    expect(getSettings().panelSplitRatio).toBe(0.8);

    store.set(PREF_KEY, JSON.stringify(makeSettings({ panelSplitRatio: 0.05 })));
    bindPrefs(store);
    expect(getSettings().panelSplitRatio).toBe(0.2);

    // 非法(字符串/NaN/Infinity)回落默认 0.5
    store.set(
      PREF_KEY,
      JSON.stringify(makeSettings({ panelSplitRatio: "0.7" as unknown as number })),
    );
    bindPrefs(store);
    expect(getSettings().panelSplitRatio).toBe(0.5);

    store.set(PREF_KEY, JSON.stringify(makeSettings({ panelSplitRatio: NaN })));
    bindPrefs(store);
    expect(getSettings().panelSplitRatio).toBe(0.5);

    store.set(PREF_KEY, JSON.stringify(makeSettings({ panelSplitRatio: Infinity })));
    bindPrefs(store);
    expect(getSettings().panelSplitRatio).toBe(0.5);
  });

  it("setPanelSplitRatio 应持久化且拒绝非有限数字", () => {
    const store = new FakePrefsStore();
    bindPrefs(store);

    setPanelSplitRatio(0.7);
    expect(getSettings().panelSplitRatio).toBe(0.7);
    const saved = JSON.parse(store.get(PREF_KEY) as string) as Settings;
    expect(saved.panelSplitRatio).toBe(0.7);

    setPanelSplitRatio(NaN);
    setPanelSplitRatio(Infinity);
    expect(getSettings().panelSplitRatio).toBe(0.7);
  });

  it("popupWidth/popupHeight 越界应 clamp 到 280-800 / 80-600", () => {
    const store = new FakePrefsStore();
    // 越界上限/下限各取一个典型值: 99999 收敛到 800, 1 抬升到 80
    store.set(
      PREF_KEY,
      JSON.stringify(makeSettings({ popupWidth: 99999, popupHeight: 1 })),
    );
    bindPrefs(store);
    expect(getSettings().popupWidth).toBe(800);
    expect(getSettings().popupHeight).toBe(80);

    // 区间中部的合法值不受 clamp 影响(既有行为回归)
    store.set(
      PREF_KEY,
      JSON.stringify(makeSettings({ popupWidth: 420, popupHeight: 120 })),
    );
    bindPrefs(store);
    expect(getSettings().popupWidth).toBe(420);
    expect(getSettings().popupHeight).toBe(120);
  });
});
