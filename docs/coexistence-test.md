# Smart Translate for Zotero — 共存测试清单

## 与 Translate for Zotero 共存

- [ ] 两者同时启用，Zotero 启动无报错
- [ ] 划词翻译：两者划词弹窗不互相遮挡
- [ ] 快捷键：`Ctrl+Shift+T` 仅触发 SmartTranslate，Translate for Zotero 保留原有快捷键
- [ ] 菜单项：右键菜单中两者条目清晰可辨
- [ ] 边栏：两者边栏/面板可独立切换
- [ ] 批量翻译：两者队列互不影响

## 测试环境

- Zotero 10.0.1
- Translate for Zotero v2.4.7
- Smart Translate for Zotero v0.1.0

## 已知冲突

- 两者均使用 `renderTextSelectionPopup`，需通过 addonID 隔离
- `Ctrl+Shift+T` 需确认未被其他插件占用
