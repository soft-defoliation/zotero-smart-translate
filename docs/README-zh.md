# Smart Translate for Zotero — 中文用户文档

## 安装

1. 关闭 Zotero
2. 打开 Zotero → 工具 → 附加组件
3. 点击齿轮图标 → "从文件安装附加组件"
4. 选择 `.scaffold/build/smart-translate-for-zotero.xpi`
5. 重启 Zotero

## 快速开始

1. 打开任意 PDF 条目，进入阅读器
2. 选中文字，自动出现翻译结果
3. 按 `Ctrl+Shift+T` 翻译标题/摘要
4. 阅读器内按 `Alt+B` 切换双语边栏

## 设置

在首选项中可配置：
- 3 个引擎的 endpoint / model / temperature / prompt
- 目标语言 / 源语言
- 术语表导入导出
- prompt 模板增删改

## 错误码

| 错误码 | 含义 | 处理 |
|---|---|---|
| 429 | 请求过多 | 自动退避 2s→4s→8s，最多 3 次 |
| 1305 | 模型访问量过大 | 同上，或切换备用引擎 |
| 401 | API key 无效 | 立即报错，不重试 |
| 400 | 请求参数错误 | 立即报错，检查 prompt/模型 |

## 已知限制

- 扫描版 PDF 无文本层时需先 OCR
- 批量翻译并发限 2，防止 QPS 超限
- 创新点提炼为辅助工具，需人工核对

## AGPL-3.0 致谢

本插件基于以下开源项目整合：
- [zotero-plugin-scaffold](https://github.com/zotero-plugin-dev/zotero-plugin-scaffold) (AGPL-3.0)
- [zotero-plugin-toolkit](https://github.com/zotero-plugin-dev/zotero-plugin-toolkit) (AGPL-3.0)
- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) (AGPL-3.0)
- [Translate for Zotero](https://github.com/windingwind/zotero-pdf-translate) (AGPL-3.0)
- [Zotero AI-Butler](https://github.com/steven-jianhao-li/zotero-AI-Butler) (AGPL-3.0)
- [zotero-summarizer](https://github.com/suwonyoon/zotero-summarizer) (AGPL-3.0)

## 许可证

Smart Translate for Zotero 是自由软件：你可以在遵守 GNU Affero General Public License 条款下重新分发和/或修改它。
