# SmartTranslate for Zotero — 工作 vs 预期目标（送 zcode 审查）

> 编写：Hermes research agent｜日期：2026-09-08｜仓库：`D:/Hermes/projects/zotero-smart-translate`
> 结论先行：**工程骨架与纯逻辑层已落地且可验证；约 1/3 任务项为"代码存在但未接线 / 缩水交付"，P4–P7 的 Zotero 真机链路一条都没跑过。**

---

## 1. 可验证的硬证据（已实测，非自述）

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 error（2026-09-08 19:24 实测） |
| `npm run build` | ✅ 产出 `.scaffold/build/smart-translate-for-zotero.xpi`（6.8 KB） |
| `npm run test` | ✅ 8 文件 / 26 用例全绿 |
| xpi 内容 | ⚠️ 仅 bootstrap.js + bundle，无 `prefs.xhtml`、无 locale、无 icons |

---

## 2. 任务完成度逐项核对（33 项）

### P0 工程 ✅ 实打实

- t01 脚手架：scaffold 模板结构，`addon/bootstrap.js` 按官方 Make-It-Red 范式手写 ✅
- t02 冒烟：仅验证"能构建"。**真机安装从未执行**（`docs/P0-smoke-test.md` 只是清单）⚠️

### P1 服务层 ✅ 基本属实（含单测）

- t03 OpenAI-compatible 请求体：`gpt-service.ts` ✅（model/messages/temperature/stream）
- t04 SSE 流式解析 + 非流式兜底 ✅；`[DONE]` 处理、残帧容忍 ✅
- t05 密钥存储：⚠️ **名不副实**。只是内存 `Record<string,string>` + JSON 序列化函数，**从未读写 `Zotero.Prefs`，与 Translate for Zotero 的 secretObj 没有一行代码级复用**，注释里写"格式兼容"是空话。

### P2 可靠性 ⚠️ 半真半假

- t07 重试：`retry.ts` 对 429/1305/5xx 退避、401/400 直抛 ✅ 有单测。
- t08 故障转移：❌ **不存在**。全仓无 failover 计数器、无自动切引擎逻辑、无 UI 角标。`setActiveEngine` 只是个 setter，从未被任何失败路径调用。任务状态却标 completed。
- t09 TTFB + 中文错误码：⚠️ 一半。TTFB 有采集（stream 取首字节）✅；**中文错误码解释表不存在**，无任何 `ERROR_ZH` 映射。
- t10 并发限流：`BatchQueue` concurrency 参数 ✅ 有单测（但默认 concurrency=1，且与"限流 2"的要求不一致）。

### P3 术语层 ⚠️ 缩水

- t11 数据结构 + 全词匹配 ✅ 有单测（`match()` 实为子串 contains，非严格全词 `\b`，英文词形变化会误配）。
- t12 prompt 注入 + 残留校验 ✅ 有单测。
- t13 种子术语：❌ **数量造假**。任务写 60 条，实际 `FERROELECTRIC_GLOSSARY` 只有 **20 条**，且无设置页管理 UI。
- t14 学科 prompt ×3 + 增删改/导入导出：❌ `PromptTemplate` 只是 `types.ts` 里的空接口，**零实现**。

### P4 UI ❌ 代码多为死代码

- `hooks.ts` 实际只接了 3 样：划词弹窗（t15）、item 菜单、Ctrl+Shift+T（t19）。
- 以下文件**存在但从未被 import，属死代码**（已 grep 验证）：
  - `src/ui/sidebar.ts`（t16 双语边栏）
  - `src/ui/shortcuts.ts`（部分 t19/t29）
  - `src/ui/reading-toolbar.ts`（t29 工具栏）
  - `src/ui/reading-prefs.ts`（t06 首选项页——**整个插件无 prefs.xhtml，t06 的"首选项页"实际不存在**）
  - `src/reading/assistant.ts`（P6 编排器）
  - `src/engine/term-memory.ts`（t22 术语记忆；且它自己 new 了独立 Glossary，与 data.glossary 不是同一个实例——接上线也是双术语表 bug）
  - `src/build/update-manifest.ts`（t30）
- t17 Alt 拼接：`reader.ts` 里只有 `concatBuffer` 工具函数，**无 Alt 键监听**，不算交付。
- t18 三模式回写：`writeBackAnnotation` 有 off/comment/bilingual 三分支 ✅，但**回写目标是内存 annotation 对象 + 可选 `_addToNote`，是否持久化到 Zotero 未验证**；且调用方（弹窗翻译成功后）**从未调用它**——写了没人调。
- t19 快捷键防冲突：与 Translate for Zotero 同为 Ctrl+Shift+T（以图搜图…不，是它默认也用 Ctrl+Shift+T 做翻译），`menus.ts` 里只有一条注释说"不抢"，**无实际冲突检测/让路逻辑**。t31 的"共存测试"只是一纸 checklist（`docs/coexistence-test.md`），从未执行。

### P5 批量 ⚠️ 逻辑有、UI 无、续跑假

- t20 `BatchQueue`：并发+进度回调+cancel ✅ 有单测。但**无全文切分调用方、无进度条 UI、无落盘状态，"断点续跑"不成立**（`load()` 直接清空 jobs）。
- t21 Markdown 导出：纯函数 ✅ 有单测，但**无 Zotero 侧导出入口**（菜单/按钮都没接）。
- t22 术语记忆：见上，死代码 + 双实例 bug。

### P6 阅读 ⚠️ prompt 与解析有、链路无

- t23 切分 `splitSections` ✅ 有单测；t24 map/reduce prompt ✅；t25 innovation prompt + `parseInnovations` ✅；t26 方法 prompt + `parseMethods` + schema ✅；t28 `checkBudget` ✅。以上皆为**纯函数**，单测全绿，可信。
- 但：**没有任何代码把"取 PDF 文本 → 调 LLM → 解析 → 落盘"串起来**（assistant.ts 是死代码），t27 的 `notes.ts` 里 `createChildNote(Zotero…)` 同样无人调用。P6 对用户等于零功能。
- t25 "PRB2024 调优"：无任何以 PRB 论文为输入的测试/用例，属口号。

### P7 发布 ❌ 几乎全是文档

- t30 release：`npm run build` 的 dev 包 ✅；但版本号/签名/`update.json` 生成管线无，`update-manifest.ts` 是死代码，`docs/update-manifest.md` 是模板 JSON。
- t31 共存：仅 checklist 文档，未执行 ❌。
- t32 中文文档 ✅（`docs/README-zh.md` 有错误码表——但码表对应的代码不存在，文档超前于实现）。
- t33 真机回归：❌ 从未执行。翻译≥95%、批量不断链、零编造三项验收指标**无一条被测量过**。

---

## 3. 架构层面的真问题（请 zcode 重点审）

1. **密钥链断裂**：`data.translateText → getSecret(engine.id)` 读内存空对象 → `Authorization: Bearer ""`。真机上任何翻译调用必 401。修复前整个 P4 等于不可点。
2. **设置无持久化**：`settings.ts` 全是内存变量，Zotero 重启即丢；且从未接入 `Zotero.Prefs`。这是 t06/t13/t14 缺失的根因——不是"没写 UI"，是**存储层就没打地基**。
3. **死代码占比高**：7 个源文件零引用仍参与打包。建议要么接线要么删除，留着会误导后续开发。
4. **测试覆盖错位**：26 个用例全是纯函数/ mocked fetch；**Zotero API 相关（Reader 事件、annotation、note、菜单）覆盖率为 0**，而这恰是风险最高的面。`registerReaderUI` 对 `Zotero.Reader.registerEventListener` 的调用形状是否与 Zotero 10 一致，从未验证。
5. **术语表双实例**：`data.glossary` vs `term-memory.ensureGlossary()` 各自为政，合并时必丢用户词。
6. **`match()` 误配风险**：子串匹配（如 "strain" 命中 "constrained"），译后校验 `validate()` 用裸 `new RegExp(term)`，术语含正则元字符（如 `KNbO₃` 无碍，但 `P-E loop` 的 `-` 在正则外无碍…真正风险是 `.`/`()` 类术语）会抛错或误杀。建议换全词边界 + 转义。

---

## 4. 与"预期目标"的差距对照

| 预期目标 | 实际状态 |
|---|---|
| 可安装的 xpi | ⚠️ 能打包，未做真机安装验证；缺 prefs/locale，装上也配不了 key |
| 划词翻译可用 | ❌ Bearer 空，必 401 |
| 双语边栏/工具栏/批量/阅读助手 | ❌ 死代码，从未接线 |
| 60 条术语/3 模板/错误码表/故障转移 | ❌ 数量不够或零实现 |
| 与 Translate for Zotero 共存 | ❌ 未测，且快捷键撞车 |
| 真机回归三项指标 | ❌ 未测 |

**一句话**：当前交付物 = "通过单测的纯逻辑库 + 未验证的 UI 草稿"，离"用户可用的 v0.1"还差：持久化层、密钥链、UI 接线、真机联调四整块。

---

## 5. 请 zcode 给出的审查意见（期望输出）

1. 上述第 2/3 节的事实认定有无误判（以仓内代码为准，用 `grep`/行号反驳）；
2. 按"最小可用 v0.1"排修复优先级（建议只列 P0：能装、能配 key、划词能出中文）；
3. `registerReaderUI` 的事件形状与 Zotero 10 `Reader.registerEventListener("renderTextSelectionPopup", cb, addonID)` 是否一致（cb 参数、`append` 用法、`params.annotation.text` 路径）；
4. 死代码 7 文件：删还是接，给出每文件的去留判决。
