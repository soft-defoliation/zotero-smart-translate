import { describe, it, expect } from "vitest";
import { getSettings, setSettings, getEngine, setActiveEngine, getActiveEngine, getSecret, setSecret, serializeSecrets, loadSecrets, resolveFontFamily } from "../../src/engine/settings";
import type { Settings } from "../../src/types";

// system 枚举对应的无衬线栈(与设计稿字体族枚举表一致)
const SYSTEM_STACK =
  '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';

describe("Settings", () => {
  it("should return default settings", () => {
    const settings = getSettings();
    expect(settings.engine1.endPoint).toContain("open.bigmodel.cn");
    expect(settings.engine1.model).toBe("glm-4.6");
    expect(settings.activeEngineId).toBe("smart-engine1");
    // 弹窗尺寸默认 420/120, 供选区弹窗 textarea 初始宽高使用
    expect(settings.popupWidth).toBe(420);
    expect(settings.popupHeight).toBe(120);
    // v2 弹窗外观默认值: 无衬线栈 + 14px + 1.6; 自动翻译默认开(主代理裁决 1)
    expect(settings.fontFamily).toBe("system");
    expect(settings.fontCustom).toBe("");
    expect(settings.fontSize).toBe(14);
    expect(settings.lineHeight).toBe(1.6);
    expect(settings.autoTranslate).toBe(true);
    // 写回收集默认关闭: 未明确选择前不往文献里写笔记
    expect(settings.writebackMode).toBe("off");
  });

  it("should persist active engine", () => {
    setActiveEngine("smart-engine2");
    expect(getSettings().activeEngineId).toBe("smart-engine2");
    setActiveEngine("smart-engine1");
  });

  it("should round-trip secrets", () => {
    setSecret("smart-engine1", "secret-123");
    expect(getSecret("smart-engine1")).toBe("secret-123");
    const blob = serializeSecrets();
    loadSecrets(blob);
    expect(getSecret("smart-engine1")).toBe("secret-123");
  });
});

describe("resolveFontFamily", () => {
  // 以当前默认设置为底, 逐用例覆盖 fontFamily/fontCustom
  function withFont(overrides: Partial<Settings>): Settings {
    return { ...getSettings(), ...overrides };
  }

  it("system 枚举映射到无衬线栈", () => {
    expect(resolveFontFamily(withFont({ fontFamily: "system" }))).toBe(SYSTEM_STACK);
  });

  it("其余枚举各自映射到设计稿字体栈", () => {
    expect(resolveFontFamily(withFont({ fontFamily: "yahei" }))).toBe(
      '"Microsoft YaHei", "PingFang SC", sans-serif',
    );
    expect(resolveFontFamily(withFont({ fontFamily: "simsun" }))).toBe(
      '"SimSun", "Songti SC", "Noto Serif CJK SC", serif',
    );
    expect(resolveFontFamily(withFont({ fontFamily: "kaiti" }))).toBe(
      '"KaiTi", "STKaiti", "Kaiti SC", serif',
    );
    expect(resolveFontFamily(withFont({ fontFamily: "sourcehansans" }))).toBe(
      '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
    );
    expect(resolveFontFamily(withFont({ fontFamily: "sourcehanserif" }))).toBe(
      '"Source Han Serif SC", "Noto Serif CJK SC", "SimSun", serif',
    );
  });

  it("custom 取 fontCustom 的原始 CSS 值", () => {
    expect(
      resolveFontFamily(withFont({ fontFamily: "custom", fontCustom: "Georgia, serif" })),
    ).toBe("Georgia, serif");
  });

  it("custom 且 fontCustom 为空白时回落 system 栈", () => {
    expect(
      resolveFontFamily(withFont({ fontFamily: "custom", fontCustom: "   " })),
    ).toBe(SYSTEM_STACK);
  });

  it("未知枚举 key 回落 system 栈", () => {
    expect(resolveFontFamily(withFont({ fontFamily: "no-such-font" }))).toBe(SYSTEM_STACK);
  });
});
