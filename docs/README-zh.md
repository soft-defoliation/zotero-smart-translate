# Smart Translate for Zotero — 中文用户文档

## 安装

### 安装发布版

1. 从 [GitHub Releases](https://github.com/soft-defoliation/zotero-smart-translate/releases) 下载 `smart-translate-for-zotero.xpi` (xpi 资产挂在 `v{version}` tag 上)
2. 打开 Zotero → 工具 → 插件 → 右上角齿轮图标 → "Install Plugin From File..." (从文件安装附加组件)
3. 选择下载的 `.xpi`, 重启 Zotero

### 自动更新

插件带自动更新清单:
`https://github.com/soft-defoliation/zotero-smart-translate/releases/download/release/update.json`

Zotero 会自动检查更新; 也可手动触发: 工具 → 插件 → 右上角齿轮 → "Check for Updates"。

### 从源码构建

```bash
npm install
npm run build
```

构建产物: `.scaffold/build/smart-translate-for-zotero.xpi`

## 快速开始

1. 打开任意 PDF 条目, 进入阅读器
2. 选中文字, 自动出现流式翻译弹窗: 单击可复制, 双击复制全文, "＋拼接"可把跨页多段合并成一次翻译
3. 按 `Ctrl+Shift+T` 翻译标题; 右键条目选 "SmartTranslate: 翻译标题（写入条目）" 可把译文写进条目
4. 右键条目选 "SmartTranslate: 翻译摘要（写入条目）"; 在条目列表的列选择器中开启"标题译文/摘要译文"两列即可直接看到译文
5. 阅读器内按 `Alt+B` 切换双语侧栏
6. 右键条目选 "SmartTranslate: 阅读助手（摘要/创新点/方法）", 结果写入子笔记
7. 多选条目后右键 "SmartTranslate: 批量翻译导出（双语 Markdown）", 译文落盘到指定文件夹

注: 引号内的菜单名是界面原文, 含全角括号属正常。

## 功能一览

- **AI 划词翻译**: OpenAI 兼容接口, SSE 流式输出; 3 个引擎配置, 自动故障转移 (连续 3 次靠备用引擎救活会粘性切换), 指数退避重试; 中文选区自动跳过, 不发请求
- **会话级缓存**: 整段 LRU 100 条 + 句子级记忆 500 条; 多句文本编号逐句翻译, 重复句 0 请求秒回
- **划词弹窗**: 可复制 (三级 fallback), 拖拽调尺寸并持久化, 拼接模式, 双击复制全文
- **标题/摘要写入条目**: 译文持久化到 Extra 字段 (`titleTranslation`/`abstractTranslation`, 与 zotero-plugin-toolkit/T4Z 行格式互通, 换插件数据不丢); 条目列表注册"标题译文/摘要译文"两列
- **批注写回**: 翻译结果按设置写回批注 comment / 双语 / 关闭
- **条目侧栏双语面板**: 可拖拽分割条, 字体族/字号/行高可调, 支持复制原文/译文/全部
- **阅读助手**: 全文摘要 (map-reduce 分章), 创新点提取, 方法结构化 (铁电体系 schema), 结果写子笔记
- **批量翻译导出**: 多选条目 → 双语 Markdown 落盘
- **术语表**: 铁电/高压领域 20+ 种子术语注入翻译
- **快捷键**: `Ctrl+Shift+T` 翻译标题
- **兼容**: Zotero 7.0 - 10.*

## 设置

在首选项中可配置:
- 3 个引擎的 endpoint / model / temperature / prompt
- 目标语言 / 源语言
- 术语表导入导出
- prompt 模板增删改

## 错误码

| 错误码 | 含义 | 处理 |
|---|---|---|
| 429 | 请求过多 | 自动退避 2s→4s→8s, 最多 3 次 |
| 1305 | 模型访问量过大 | 同上, 或切换备用引擎 |
| 401 | API key 无效 | 立即报错, 不重试 |
| 400 | 请求参数错误 | 立即报错, 检查 prompt/模型 |

## 已知限制

- 扫描版 PDF 无文本层时需先 OCR
- 批量翻译并发限 2, 防止 QPS 超限
- 创新点提炼为辅助工具, 需人工核对

## AGPL-3.0 致谢

本插件基于以下开源项目整合, 划词弹窗与翻译机制参考了 Translate for Zotero:
- [zotero-plugin-scaffold](https://github.com/zotero-plugin-dev/zotero-plugin-scaffold) (AGPL-3.0)
- [zotero-plugin-toolkit](https://github.com/zotero-plugin-dev/zotero-plugin-toolkit) (AGPL-3.0)
- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) (AGPL-3.0)
- [Translate for Zotero](https://github.com/windingwind/zotero-pdf-translate) (AGPL-3.0)
- [Zotero AI-Butler](https://github.com/steven-jianhao-li/zotero-AI-Butler) (AGPL-3.0)
- [zotero-summarizer](https://github.com/suwonyoon/zotero-summarizer) (AGPL-3.0)

## 许可证

Smart Translate for Zotero 是自由软件: 你可以在遵守 GNU Affero General Public License 条款下重新分发和/或修改它。
