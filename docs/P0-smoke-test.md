# Zotero Smart Translate — P0 冒烟测试清单

## 安装步骤

1. 关闭 Zotero
2. 打开 Zotero → 工具 → 附加组件
3. 点击齿轮图标 → "从文件安装附加组件"
4. 选择: `D:/Hermes/projects/zotero-smart-translate/.scaffold/build/smart-translate-for-zotero.xpi`
5. 确认安装
6. 重启 Zotero

## 预期结果

- Zotero 窗口弹出提示: "SmartTranslate startup OK"
- 工具栏出现 Smart Translate 图标（TODO: Task 29）
- 右键菜单/工具菜单出现 Smart Translate 选项（TODO: Task 29）

## 验证命令

在 Zotero Debug Output Logging 中搜索:
- `SmartTranslate startup OK`
- `SmartTranslate initialized`

## Reader API 兼容性检查

由于 toolkit 官方只声明到 Zotero 8，本插件需要验证以下 API 在 Zotero 10.0.1 上可用：

1. `Zotero.Reader.getReader(windowID)` → 获取 reader 实例
2. `readerInstance.renderTextSelectionPopup()` → 划词弹窗
3. `readerInstance.getAnnotation(id)` → 获取批注
4. `Zotero.Reader.createAnnotation()` → 创建批注

若上述任一 API 不可用，降级方案：
- 使用 Translate for Zotero 2.4.7 的 API 调用方式作为参照
- 或直接调 Zotero 内部 API（不稳定，标记为 unstable）

## 下一步

- [ ] 冒烟测试通过
- [ ] Reader API 兼容性确认
- [ ] 进入 P1 开发（服务适配层）
