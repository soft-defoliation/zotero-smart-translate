/**
 * 最近翻译存储 + 侧栏面板注册表 — 纯数据模块, 不依赖 Zotero, 可单测。
 *
 * [双 bundle 模块双实例决策 — 契约 20260908-24-executor "关键决策"]
 * 主 bundle(smarttranslate.js, 运行于 bootstrap 沙箱)与 panel bundle
 * (panel.js, loadSubScript 进主窗口)各自打包了一份本模块。若两边各自 new
 * store, 划词弹窗(主 bundle)写入的译文, 侧栏(panel bundle)永远读不到,
 * "弹窗关了译文还在"的同步就断了。规避: 主 bundle onStartup 把实例挂到
 * Zotero.SmartTranslate.store / .panels; 两边一律经 getSharedStore()/
 * getSharedPanels() 读写 — 全局桥可达时返回共享实例, 不可达时(单测/node
 * 环境)回落本模块私有实例, 调用方无感。
 */

export type TranslateStatus = "idle" | "running" | "done" | "error";

/** 最近一次翻译的快照, 侧栏据此渲染("最近翻译"语义, 弹窗关了译文还在) */
export interface TranslateRecord {
  raw: string;
  result: string;
  engineId: string;
  engineName: string;
  status: TranslateStatus;
  /** 是否来自划词弹窗同步(状态行据此显示"已同步划词翻译") */
  fromSelection: boolean;
  updatedAt: number;
  /** error 态的一句话原因(完整错误由侧栏放进悬停 title) */
  errorMessage: string;
  /** 结果由故障转移(非当前引擎)产出: 侧栏状态行据此加"（故障转移）"后缀 */
  failover?: boolean;
}

export type PanelRefresh = () => Promise<void>;

export interface TranslateStore {
  getRecord(): TranslateRecord;
  /**
   * 置 running: 记录本次原文/引擎并清空上次结果, fromSelection 由来源标记。
   * 返回本次翻译的代际令牌(gen), 后续回调必须原样带回。
   * 代际令牌: 新 begin 使旧流的全部回调失效, 界面永远跟随最近一次翻译。
   */
  begin(
    raw: string,
    engineId: string,
    engineName: string,
    fromSelection?: boolean,
  ): number;
  /** 流式进度: 覆盖当前 result(代际匹配且 running 态才生效) */
  setPartial(gen: number, partial: string): void;
  /**
   * 请求真正发出的引擎确定后由 onEngineResolved 回调写入 —
   * begin 时先用当前引擎占位, 回调到达后覆盖为实际使用的引擎
   * (failover=非当前引擎), 代际匹配且 running 态才生效。
   */
  resolveEngine(
    gen: number,
    engineId: string,
    engineName: string,
    failover: boolean,
  ): void;
  /** 置 done(仅代际匹配才生效) */
  finish(gen: number, result: string): void;
  /** 置 error: 记录原因, 保留旧译文(设计稿: 失败不清空译文框), 仅代际匹配才生效 */
  fail(gen: number, message: string): void;
}

export interface PanelRegistry {
  add(uid: string, refresh: PanelRefresh): void;
  remove(uid: string): void;
  /** 依次调所有已注册面板的 refresh, 单个失败不阻断其余 */
  refreshAll(): Promise<void>;
}

export function createTranslateStore(): TranslateStore {
  // 代际令牌: 新 begin 使旧流的全部回调失效, 界面永远跟随最近一次翻译。
  // 旧请求不做 Abort(继续在后台走完), 只靠 gen 校验丢弃迟到回调。
  let generation = 0;
  let record: TranslateRecord = {
    raw: "",
    result: "",
    engineId: "",
    engineName: "",
    status: "idle",
    fromSelection: false,
    updatedAt: 0,
    errorMessage: "",
    failover: false,
  };
  return {
    getRecord: () => record,
    begin(raw, engineId, engineName, fromSelection = false) {
      generation += 1;
      record = {
        ...record,
        raw,
        engineId,
        engineName,
        status: "running",
        fromSelection,
        updatedAt: Date.now(),
        errorMessage: "",
        result: "",
        // 新一次翻译先按当前引擎占位, 故障转移由 resolveEngine 覆盖
        failover: false,
      };
      return generation;
    },
    setPartial(gen, partial) {
      // 代际不符的迟到回调直接作废(旧流不得污染新一次翻译)
      if (gen !== generation) return;
      // 非 running 态忽略: 防迟到的流式回调污染 done/error 后的结果
      if (record.status !== "running") return;
      record = { ...record, result: partial };
    },
    resolveEngine(gen, engineId, engineName, failover) {
      // 同 setPartial: 旧代际的迟到回调不得覆盖当前记录
      if (gen !== generation) return;
      if (record.status !== "running") return;
      record = { ...record, engineId, engineName, failover };
    },
    finish(gen, result) {
      // 仅代际匹配才置 done: 新 begin 后旧流的 finish 不得把状态改回去
      if (gen !== generation) return;
      record = { ...record, result, status: "done", updatedAt: Date.now() };
    },
    fail(gen, message) {
      // 仅代际匹配才置 error(同 finish 的代际口径)
      if (gen !== generation) return;
      // 保留 result: 设计稿要求 error 态保留旧译文
      record = {
        ...record,
        status: "error",
        errorMessage: message,
        updatedAt: Date.now(),
      };
    },
  };
}

export function createPanelRegistry(): PanelRegistry {
  const activePanels = new Map<string, PanelRefresh>();
  return {
    add: (uid, refresh) => {
      activePanels.set(uid, refresh);
    },
    remove: (uid) => {
      activePanels.delete(uid);
    },
    async refreshAll() {
      for (const refresh of [...activePanels.values()]) {
        try {
          await refresh();
        } catch {
          /* 单个面板刷新失败(如 section 已销毁)不阻断其余 */
        }
      }
    },
  };
}

// 模块私有实例: 全局桥不可达时的回落(单测/node 环境), 正常运行被桥覆盖
const localStore = createTranslateStore();
const localPanels = createPanelRegistry();

/** 主 bundle 与 panel bundle 共用的 store 读入口(见文件头"双实例决策") */
export function getSharedStore(): TranslateStore {
  const bridge = (globalThis as any).Zotero?.SmartTranslate;
  return bridge?.store ?? localStore;
}

/** 主 bundle 与 panel bundle 共用的面板表读入口 */
export function getSharedPanels(): PanelRegistry {
  const bridge = (globalThis as any).Zotero?.SmartTranslate;
  return bridge?.panels ?? localPanels;
}

/** 便捷导出: 刷新所有已打开的侧栏 section(弹窗翻译流程各节点调用) */
export function refreshAllPanels(): Promise<void> {
  return getSharedPanels().refreshAll();
}
