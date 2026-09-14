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
2. 选中文字, 自动出现流式翻译弹窗: 单击可复制, 双击复制全文, "＋拼接"可把跨页多段合并成一次翻译; 翻译进行中弹窗出现"停止"按钮, 点击即中止 (已流出的部分译文保留, 状态显示"已取消")
3. 按 `Ctrl+Shift+T` 翻译标题; 右键条目选 "SmartTranslate: 翻译标题（写入条目）" 可把译文写进条目
4. 右键条目选 "SmartTranslate: 翻译摘要（写入条目）"; 在条目列表的列选择器中开启"标题译文/摘要译文"两列即可直接看到译文, 条目右侧 Info 区底部也会出现"标题译文/摘要译文"两行
5. 多选 3 条以上条目, 右键 "SmartTranslate: 翻译标题（写入条目）" 可逐条批量写回, 进度窗结束后显示"完成 X/Y · 跳过 Z · 失败 W"
6. 阅读器内按 `Alt+B` 切换双语侧栏
7. 右键条目选 "SmartTranslate: 阅读助手（摘要/创新点/方法）", 结果写入子笔记
8. 多选条目后右键 "SmartTranslate: 批量翻译导出（双语 Markdown）", 译文落盘到指定文件夹
9. 条目侧栏底部点"历史"展开最近 100 条翻译记录; 点击任一条把原文/译文回填双框 (不自动翻译), "清空"一键清空, 重启 Zotero 后记录仍在
10. 编辑 → 设置 → SmartTranslate: "翻译风格"下拉可切 标准/学术/直译/流畅/自定义; "术语库"文本框每行一条 `原文 = 译文`, 保存后立即生效

注: 引号内的菜单名是界面原文, 含全角括号属正常。未配置 API Key 时, 划词弹窗与侧栏的错误提示旁会出现"打开设置"按钮, 一键跳到插件设置页。

## 功能一览

- **AI 划词翻译**: OpenAI 兼容接口, SSE 流式输出; 3 个引擎配置, 自动故障转移 (连续 3 次靠备用引擎救活会粘性切换), 指数退避重试; 中文选区自动跳过, 不发请求
- **翻译取消**: 翻译进行中, 划词弹窗与侧栏出现"停止"按钮, 点击即中止在途请求; 已流出的部分译文保留, 状态显示"已取消" (中性提示, 非错误)
- **未配置密钥引导**: 未配置 API Key 时, 划词弹窗与侧栏的错误提示旁出现"打开设置"按钮, 一键跳到插件设置页
- **会话级缓存**: 整段 LRU 100 条 + 句子级记忆 500 条; 多句文本编号逐句翻译, 重复句 0 请求秒回
- **划词弹窗**: 可复制 (三级 fallback), 拖拽调尺寸并持久化, 拼接模式, 双击复制全文
- **标题/摘要写入条目**: 译文持久化到 Extra 字段 (`titleTranslation`/`abstractTranslation`, 与 zotero-plugin-toolkit/T4Z 行格式互通, 换插件数据不丢); 条目列表注册"标题译文/摘要译文"两列, 条目 Info 区底部同步显示"标题译文/摘要译文"两行 (英文界面为 Title (Translation)/Abstract (Translation)), 两者共用同一数据源
- **多选批量写入条目**: 条目列表多选 → 右键 "SmartTranslate: 翻译标题（写入条目）/翻译摘要（写入条目）" → 顺序逐条翻译并写回, 进度窗显示进度, 结束显示"完成 X/Y · 跳过 Z · 失败 W" (附件条目的标题也会处理, 写入附件自身)
- **双语界面标签**: 界面文案采用 FTL 体系 (zh-CN/en-US), 跟随 Zotero 界面语言
- **批注写回**: 翻译结果按设置写回批注 comment / 双语 / 关闭
- **条目侧栏双语面板**: 可拖拽分割条, 字体族/字号/行高可调, 支持复制原文/译文/全部
- **翻译历史**: 条目侧栏底部"历史"区 (默认收起), 展开显示最近 100 条持久化记录; 每条显示原文前 40 字符与时间, 悬停看完整原文+译文; 点击把原文/译文回填双框 (不自动翻译); "清空"一键清空; 记录持久化到 prefs, 重启 Zotero 后仍在; 单条原文超 5000 字符不记录, 批量翻译导出不写入历史
- **翻译风格**: 设置"翻译行为"组新增"翻译风格"下拉 — 标准 (默认, 与之前行为完全一致)/学术/直译/流畅/自定义; 选"自定义"出现 prompt 文本框, 留空等同标准; 风格影响划词翻译与标题/摘要翻译, 不影响阅读助手 (摘要/创新点); 切走再切回"自定义"prompt 不丢
- **阅读助手**: 全文摘要 (map-reduce 分章), 创新点提取, 方法结构化 (铁电体系 schema), 结果写子笔记
- **批量翻译导出**: 多选条目 → 双语 Markdown 落盘
- **术语库**: 设置面板"术语库"组, 多行文本框每行一条 `原文 = 译文`, `#` 开头为注释行; 同名条目 (不区分大小写) 覆盖内置铁电/高压词表 (20 条种子术语), 其余条目追加在词表末尾; 保存后立即生效 (无需重启), 缺 `=` 或缺一侧的坏行自动跳过不阻断
- **快捷键**: `Ctrl+Shift+T` 翻译标题
- **兼容**: Zotero 7.0 - 10.*

## 设置

在 编辑 → 设置 → SmartTranslate 首选项中可配置, 共 4 组:
- 翻译服务: 引擎切换, 接口地址 / 模型 / API Key, 源语言 / 目标语言
- 弹窗外观: 字体族 / 字号 / 行高 / 弹窗尺寸
- 翻译行为: 划词后自动翻译 / 检测到中文时跳过 / 引擎失败自动切换 / 写回模式 / 翻译风格 (标准/学术/直译/流畅/自定义)
- 术语库: 每行一条 `原文 = 译文`, `#` 开头为注释行, 同名覆盖内置铁电词表, 保存后立即生效

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
