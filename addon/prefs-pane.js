/**
 * SmartTranslate 首选项面板脚本 — 由 prefs.xhtml 根元素 onload 触发 init()。
 * 读写约定与 src/engine/settings.ts 对齐:
 * - settings JSON 存于 Zotero.Prefs "smarttranslate.settings" (自动带 extensions.zotero. 前缀)
 * - API Key 按引擎 id 存于 secretObj JSON ("smarttranslate.secretObj")
 * 任一控件 change 即整体写回对应 JSON pref。
 * v2: 新增字体三参数/自动翻译/源语言下拉/目标语言下拉;
 * v3: 新增写回模式下拉(off/note/note-bilingual, 枚举校验对齐主线程);
 * v4: 新增自动故障转移开关(autoFailover, 布尔校验对齐主线程);
 * 数字输入统一 NaN 防御并 clamp 到与 settings.ts 一致的区间后再写。
 */
var SmartTranslatePane = {
  ENGINE_KEYS: ["engine1", "engine2", "engine3"],

  // 引擎骨架常量, 对齐 src/engine/settings.ts 的 defaultEngine;
  // 刻意不含 prompt/customParams, 主线程 mergeSettings 会按默认值补全
  ENGINE_SKELETON: {
    engine1: {
      id: "smart-engine1",
      name: "Engine 1",
      endPoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      model: "glm-4.6",
      temperature: 0.3,
      stream: true,
    },
    engine2: {
      id: "smart-engine2",
      name: "Engine 2",
      endPoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      model: "glm-4.6",
      temperature: 0.3,
      stream: true,
    },
    engine3: {
      id: "smart-engine3",
      name: "Engine 3",
      endPoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      model: "glm-4.6",
      temperature: 0.3,
      stream: true,
    },
  },

  // 数字控件合法区间(与 src/engine/settings.ts 及设计稿保持一致)
  NUM_RANGES: {
    "st-fontsize": { min: 10, max: 24 },
    "st-lineheight": { min: 1.2, max: 2.0 },
    "st-popwidth": { min: 280, max: 800 },
    "st-popheight": { min: 80, max: 600 },
  },

  // 写回模式合法枚举(与 src/engine/settings.ts 的 WRITEBACK_MODES 对齐),
  // 未知值一律回落 off, 避免把面板里的脏数据写进 settings 后主线程无法识别
  WRITEBACK_MODES: ["off", "note", "note-bilingual"],

  // 惰性补齐缺失的引擎对象与 activeEngineId: 首装时 pref 为空串,
  // readJson 回退 {}, 若不补骨架, persist 会静默丢弃用户填写的配置
  ensureEngines() {
    for (const key of this.ENGINE_KEYS) {
      const existing = this.settings[key];
      if (
        !existing ||
        typeof existing !== "object" ||
        Array.isArray(existing)
      ) {
        // 浅拷贝骨架, 避免多个引擎共享同一对象引用
        this.settings[key] = { ...this.ENGINE_SKELETON[key] };
      }
    }
    if (!this.settings.activeEngineId) {
      this.settings.activeEngineId = this.settings.engine1.id;
    }
    // 补默认目标语言: 首装时 settings 无该字段, 若不补,
    // persist 会把 targetLanguage 写成空串, 覆盖主线程默认 zh-CN
    if (!this.settings.targetLanguage) {
      this.settings.targetLanguage = "zh-CN";
    }
    this.ensureScalarDefaults();
  },

  // 补齐 v2 新增标量字段的默认值(对齐 DEFAULT_SETTINGS);
  // autoTranslate 等布尔字段必须用 typeof 判断, 不能用 !x(会把合法 false 误判为缺失)
  ensureScalarDefaults() {
    const s = this.settings;
    if (!s.sourceLanguage) s.sourceLanguage = "en";
    if (typeof s.popupWidth !== "number" || !Number.isFinite(s.popupWidth)) {
      s.popupWidth = 420;
    }
    if (typeof s.popupHeight !== "number" || !Number.isFinite(s.popupHeight)) {
      s.popupHeight = 120;
    }
    if (typeof s.fontFamily !== "string" || !s.fontFamily.trim()) {
      s.fontFamily = "system";
    }
    if (typeof s.fontCustom !== "string") s.fontCustom = "";
    if (typeof s.fontSize !== "number" || !Number.isFinite(s.fontSize)) {
      s.fontSize = 14;
    }
    if (typeof s.lineHeight !== "number" || !Number.isFinite(s.lineHeight)) {
      s.lineHeight = 1.6;
    }
    if (typeof s.autoTranslate !== "boolean") s.autoTranslate = true;
    if (typeof s.skipChinese !== "boolean") s.skipChinese = true;
    // 自动故障转移: 默认开, 仅接受布尔(缺字段/非法值一律补 true)
    if (typeof s.autoFailover !== "boolean") s.autoFailover = true;
    // 写回模式: 枚举外(含旧版缺失/非字符串)一律补 off, 与主线程 mergeSettings 同判据
    if (this.WRITEBACK_MODES.indexOf(s.writebackMode) === -1) {
      s.writebackMode = "off";
    }
  },

  // 读取 JSON pref, 坏数据/空值回退 fallback
  readJson(key, fallback) {
    try {
      const raw = Zotero.Prefs.get(key);
      if (!raw || typeof raw !== "string") return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (e) {
      Zotero.logError(e);
      return fallback;
    }
  },

  // 由 activeEngineId 反查 settings 键 (engine1/2/3), 兜底 engine1
  currentKey() {
    const activeId = this.settings.activeEngineId;
    for (const key of this.ENGINE_KEYS) {
      if (this.settings[key] && this.settings[key].id === activeId) return key;
    }
    return "engine1";
  },

  init() {
    this.settings = this.readJson("smarttranslate.settings", {});
    this.secrets = this.readJson("smarttranslate.secretObj", {});
    this.ensureEngines();
    this.bindEvents();
    this.refresh();
  },

  bindEvents() {
    // 切换引擎: 更新 activeEngineId, 刷新输入框后写回
    document
      .getElementById("st-engine")
      .addEventListener("change", () => {
        const key = this.selectedEngineKey();
        const engine = this.settings[key];
        if (engine && engine.id) this.settings.activeEngineId = engine.id;
        this.refresh();
        this.persist();
      });
    // 其余控件: change 即写回(数字与布尔字段的清洗在 persist 内统一做)
    for (const id of [
      "st-endpoint",
      "st-model",
      "st-apikey",
      "st-srclang",
      "st-targetlang",
      "st-fontfamily",
      "st-fontcustom",
      "st-fontsize",
      "st-lineheight",
      "st-popwidth",
      "st-popheight",
      "st-autotranslate",
      "st-skipchinese",
      "st-autofailover",
      "st-writeback",
    ]) {
      document.getElementById(id).addEventListener("change", () => this.persist());
    }
    // 字体族切到 custom 时展开自定义字体行, 切走时收起
    document
      .getElementById("st-fontfamily")
      .addEventListener("change", () => this.updateFontCustomVisibility());
  },

  selectedEngineKey() {
    return document.getElementById("st-engine").value;
  },

  // 字体族选 custom 时显示自定义字体行(label+input 同步切换 display), 否则隐藏
  updateFontCustomVisibility() {
    const isCustom =
      document.getElementById("st-fontfamily").value === "custom";
    const display = isCustom ? "" : "none";
    document.getElementById("st-fontcustom-label").style.display = display;
    document.getElementById("st-fontcustom").style.display = display;
  },

  // select 兼容: 存储值不在既有选项中时动态补一个同值选项(如旧数据的目标语言),
  // 避免刷新后 select 静默落在第一项、persist 时覆盖掉用户旧配置
  ensureSelectOption(id, value) {
    const select = document.getElementById(id);
    if (!select || !value) return;
    for (const opt of select.options) {
      if (opt.value === value) {
        select.value = value;
        return;
      }
    }
    // 本窗口控件均为 html: 命名空间, 必须用 createElementNS 建 option
    const opt = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    );
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
    select.value = value;
  },

  // 数字输入统一清洗: 空串/非有限数字返回 fallback, 有限数字夹取到 [min, max]
  parseClampedNumber(id, fallback) {
    const range = this.NUM_RANGES[id];
    const raw = String(document.getElementById(id).value ?? "").trim();
    if (!raw) return fallback;
    const num = Number(raw);
    if (!Number.isFinite(num)) return fallback;
    if (!range) return num;
    return Math.min(range.max, Math.max(range.min, num));
  },

  // 用当前 settings/secrets 填充控件
  refresh() {
    const key = this.currentKey();
    document.getElementById("st-engine").value = key;
    const engine = this.settings[key] ?? {};
    document.getElementById("st-endpoint").value = engine.endPoint ?? "";
    document.getElementById("st-model").value = engine.model ?? "";
    const secretId = engine.id ?? "";
    document.getElementById("st-apikey").value = this.secrets[secretId] ?? "";
    // 语言下拉: 先补兼容选项(存储值不在枚举内时不丢数据), 再选中当前值
    this.ensureSelectOption("st-srclang", this.settings.sourceLanguage ?? "en");
    this.ensureSelectOption("st-targetlang", this.settings.targetLanguage ?? "zh-CN");
    const familySelect = document.getElementById("st-fontfamily");
    familySelect.value = this.settings.fontFamily ?? "system";
    // 存储值为未知枚举时 select 赋值会落空, 回退 system 保证恒有合法选中项
    if (!familySelect.value) familySelect.value = "system";
    this.updateFontCustomVisibility();
    document.getElementById("st-fontcustom").value = this.settings.fontCustom ?? "";
    document.getElementById("st-fontsize").value = this.settings.fontSize ?? 14;
    document.getElementById("st-lineheight").value = this.settings.lineHeight ?? 1.6;
    document.getElementById("st-popwidth").value = this.settings.popupWidth ?? 420;
    document.getElementById("st-popheight").value = this.settings.popupHeight ?? 120;
    document.getElementById("st-autotranslate").checked =
      this.settings.autoTranslate !== false;
    document.getElementById("st-skipchinese").checked =
      this.settings.skipChinese !== false;
    // 与 autoTranslate 同口径: 显式 false 才取消勾选, 缺字段按默认开
    document.getElementById("st-autofailover").checked =
      this.settings.autoFailover !== false;
    // 写回模式: 枚举外的存量值由 ensureScalarDefaults 先收敛, 此处只需选中
    const writebackSelect = document.getElementById("st-writeback");
    writebackSelect.value = this.settings.writebackMode;
    if (!writebackSelect.value) writebackSelect.value = "off";
  },

  // 从控件读回并整体写回 settings 与 secretObj
  persist() {
    // 双保险: 写回前再补一次骨架, 保证 JSON 恒含 engine1/2/3 与 activeEngineId
    this.ensureEngines();
    const key = this.selectedEngineKey();
    const engine = this.settings[key];
    if (engine) {
      engine.endPoint = document.getElementById("st-endpoint").value;
      engine.model = document.getElementById("st-model").value;
      // API Key 按 activeEngineId 对应的引擎 id 写入 secretObj
      if (engine.id) {
        this.secrets[engine.id] = document.getElementById("st-apikey").value;
      }
    }
    // 语言下拉: 选中值即最终值(兼容选项由 ensureSelectOption 保证存在)
    this.settings.sourceLanguage = document.getElementById("st-srclang").value;
    this.settings.targetLanguage = document.getElementById("st-targetlang").value;
    // 弹窗外观: 数字字段经 NaN 防御 + clamp 后写回, 与主线程 mergeSettings 区间一致
    this.settings.fontFamily = document.getElementById("st-fontfamily").value;
    this.settings.fontCustom = document.getElementById("st-fontcustom").value;
    this.settings.fontSize = this.parseClampedNumber("st-fontsize", this.settings.fontSize);
    this.settings.lineHeight = this.parseClampedNumber("st-lineheight", this.settings.lineHeight);
    this.settings.popupWidth = this.parseClampedNumber("st-popwidth", this.settings.popupWidth);
    this.settings.popupHeight = this.parseClampedNumber("st-popheight", this.settings.popupHeight);
    this.settings.autoTranslate =
      document.getElementById("st-autotranslate").checked === true;
    this.settings.skipChinese =
      document.getElementById("st-skipchinese").checked === true;
    this.settings.autoFailover =
      document.getElementById("st-autofailover").checked === true;
    // 写回模式: 下拉值即最终值(非法值已由 ensureScalarDefaults 收敛)
    this.settings.writebackMode =
      document.getElementById("st-writeback").value || "off";
    Zotero.Prefs.set("smarttranslate.settings", JSON.stringify(this.settings));
    Zotero.Prefs.set("smarttranslate.secretObj", JSON.stringify(this.secrets));
    // 通知主线程立即重载设置, 保存后无需重启 Zotero;
    // 可选链保证插件未加载/已卸载时不抛错
    Zotero.SmartTranslate?.hooks?.onPrefsChanged?.();
  },
};

// 显式挂到 window, 保证 xhtml onload 处理器可解析
window.SmartTranslatePane = SmartTranslatePane;
