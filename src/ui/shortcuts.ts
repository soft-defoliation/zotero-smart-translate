/**
 * Reader 侧栏快捷键(Alt+B)注册。
 * Alt+B 仅在 reader 标签下生效: Zotero Reader 无公开键盘事件 API,
 * 故沿用 menus.ts registerShortcut 的成熟模式 — 窗口级 keydown 监听
 * + 激活标签判定(Zotero_Tabs.selectedID -> Reader.getByTabID),
 * 条目列表/集合等非 reader 标签下不劫持, 保留默认行为。
 */

import { toggleSidebar } from "./sidebar";

/** 聚合一组窗口级卸载步骤为一个总卸载函数, 单个失败不阻断其余(同 menus.ts) */
function combineUnloads(unloads: Array<() => void>): () => void {
  return () => {
    for (const unload of unloads) {
      try {
        unload();
      } catch {
        /* 窗口可能已销毁, 单个清理失败不影响其余 */
      }
    }
  };
}

/**
 * 注册 Alt+B 切换双语侧栏快捷键。返回卸载函数: 按窗口移除 keydown 监听,
 * 监听引用需保存(匿名函数无法 removeEventListener)。
 */
export function registerSidebarShortcut(Zotero: any): () => void {
  const unloads: Array<() => void> = [];
  try {
    for (const win of Zotero.getMainWindows?.() ?? []) {
      const onKeyDown = (ev: any) => {
        if (!ev.altKey || (ev.key ?? "").toUpperCase() !== "B") return;
        // 仅当前激活标签是 reader 时才接管: getByTabID 返回 undefined
        // (条目列表等非 reader 标签)时不劫持 Alt+B
        const tabID = win.Zotero_Tabs?.selectedID;
        const reader = tabID ? Zotero.Reader?.getByTabID?.(tabID) : undefined;
        if (!reader) return;
        ev.preventDefault();
        toggleSidebar(reader);
      };
      win.addEventListener("keydown", onKeyDown);
      unloads.push(() => win.removeEventListener("keydown", onKeyDown));
    }
  } catch {
    /* ignore */
  }
  return combineUnloads(unloads);
}
