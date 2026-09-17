# 分镜优先重设计：纯段图流交付

## 背景与已定决策

2026-09-17 与作者对齐的三个决策：

1. **交付形态 = 纯段图流**：公众号最终发出去的就是一组漫画段图，全部文字烘进图里，没有可复制的正文段落。
2. **文案来源 = AI 一次出全套分镜**：AI 设计分镜时直接产出「画面描述 + 成稿文案」配对草稿，作者逐格调优，不设独立成文环节。
3. **推进方式 = 先出设计文档**：本文档确认后再动手。

## 现状核查：差距到底在哪

核查结论先行：**生成能力已经到位，差距在「叙事与交付」。**

### 已经实现、不需要重做的部分

- `StoryboardDesigner.design()`（`src/features/content/ports.ts`）**已经一次产出全套分镜设计**：
  `StoryboardDesign { title, segments: [{ sectionKey, title, route, copy, frames: [{ prompt, altText }] }] }`。
  每段自带呈现路由（图+文 / 文+图 / 图+文+图）、成稿文案、完整生图 prompt。
- 字数硬约束已在设计器内（`openai-storyboard-designer.ts`：全部 title+copy 总字数 ≤ recommendedTotalWords，服务端容差闸二次把关）。
- 第三步步骤名已是「设计分镜」（`workflow.ts`），段落卡（`storyboard-segment-list.tsx`）已支持逐段看文案、改文案、改路由；段图拼好后文案自动锁定。
- 分段拼接（`compose-segment-strips.ts`）：每段一张段图、字体可选、整批落库、文案块快照可还原。
- 就绪判定单一事实源 `inspect-segment-strips.ts`：第三步段卡警告与第四步按钮可用态共用。

### 真正的差距（本设计要解决的）

| # | 差距 | 位置 |
|---|------|------|
| G1 | 「生成完整正文」叙事：`buildSegmentBlocks` 把每段 copy 展开成 heading+paragraph 正文块，UI 把这堆块当「文章主角」，作者感知是「生成了正文文章」而非「拿到了分镜脚本」 | `generate-content.ts`、`content-workspace.tsx`（按钮、空态、引导文案） |
| G2 | 发布门拒掉纯段图：`hasText = blocks.some(block => block.type !== "image")`，全拼成段图后 blocks 只剩 image 块 → `no_content` 拒推 | `publish-article-draft.ts:102` |
| G3 | 段图渲染带 figcaption：`renderBlock` 的 image 分支会给每张图输出 `<figcaption>`（内容是「文章标题｜段图｜段标题」），纯段图流下每张图下面都挂一行灰字 | `render-wechat-html.ts:59-64` |
| G4 | digest 缺失：`WechatDraftInput.digest` 端口与官方发布器都已预留透传，但 `publishArticleDraft` 从不填；现状靠微信抓正文前 54 字，纯段图流下正文没有文字可抓，摘要会是空的 | `publish-article-draft.ts`、`wechat-draft.ts:20` |
| G5 | knowledge_card 与纯段图流冲突：它是唯一被有意排除在可烘块之外的文本块（「可复制、可引用」），纯段图流下它要么消失要么另作安排 | `plan-comic-strip.ts:14`、`CONSUMABLE_BLOCK_TYPES` |

## 目标流程（四步不变，第三步重定义）

```
1. 资料来源        不变
2. 文章大纲        不变（大纲 = 分镜的章节骨架 + 字数约束的输入）
3. 设计分镜        「生成分镜脚本」：AI 一次出全套（段→路由→帧prompt+成稿文案）
                   → 作者逐段调文案 / 调路由 / 调帧 prompt → 审核 → 确认
4. 配图            逐帧生成（不变）→ 拼段图（不变）→ 推送草稿（改为纯段图流）
```

第三步的心智模型：**文案块只是「烘图脚手架」**。它们存在是为了给段卡提供单份可编辑的文案源（文案只存一份，段卡按 `copyBlockIds` 引用），拼段图时被吃进图里，发布时**绝不作为文本输出**。

## 交付形态：纯段图流的定义

一篇推送到公众号草稿箱的文章 = **封面图 + N 张段图**（每段一张，图内 = 分镜帧画面 + 烘字文案），此外**没有任何正文文本段**。

- 段图按 `storyboardSegments.order` 顺序整宽呈现。
- 段图**不带 figcaption**。
- 摘要（digest）显式提供，不依赖微信抓取。
- 标题仍用 `article.title`（微信 ≤64 字，现状已是）。

## 数据结构：几乎不动

这是本设计最省的部分——`planning.storyboardSegments`、`copyBlockIds`、段图资产（type=comic_strip + consumedContent 快照）全部沿用，**零迁移**：

| 数据 | 重设计后的定位 | 变更 |
|------|--------------|------|
| `blocks`（heading/paragraph 等） | 拼图前的文案脚手架；拼图后被段图 image 块替换（consumedContent 快照保留还原能力） | 无结构变更，仅语义注释 |
| `planning.storyboardSegments` | 段结构 + 路由 + 帧引用的单一事实源 | 不变 |
| 段图资产（comic_strip） | **发布物本体** | 不变 |
| 封面资产（cover） | 草稿 thumb 来源 | 不变 |
| `article_revisions`（scope=content） | 版本快照对象从「正文文章」变为「分镜脚本」（blocks 本身，无需换字段） | 不变 |

## 变更清单

### A. 发布层（核心，Phase 1）

**A1. 新增段图流就绪判定**（`inspect-publish-readiness.ts`，与 `inspect-segment-strips` 同构的纯函数、客户端安全）：

- 文章有 `storyboardSegments` → 走段图流：
  - 每个段都有已拼段图资产（段图 `consumedContent.blocks[0].segmentId` ↔ 段 id 对上，或段数=段图数的严格校验）；
  - 封面已生成（沿用现有门）；
  - 残留可读文本块（还原视图上不属于任何段的非 image 块）→ 返回警告清单，**不静默丢弃**（见决策点 D3）。
- 文章无 `storyboardSegments` → 走现状混合路径（旧文兼容，见下）。

**A2. `publish-article-draft.ts`**：

- `hasText` 门替换：有段设计时改查「全段已拼段图」，不再要求非图片文本块；`no_content` 保留给「既无段设计又无文本块」的旧路径。
- 新增失败/警告种类：`strips_not_ready`（某段未拼图）、`residual_text`（残留文本块清单，需作者确认后 force 推送）。
- digest：按决策点 D2 生成并填入 `WechatDraftInput.digest`。
- 推送记录不变（内容指纹已覆盖新 HTML）。

**A3. `render-wechat-html.ts`**：

- 新增段图流渲染分支（或独立函数 `renderWechatStripFlowHtml`）：只输出段图 image 块序列，**无 figcaption**、无正文文本渲染。
- 通用 `renderWechatHtml` 保留给旧文混合路径。
- **预览与推送必须同源**：`wechat-preview.tsx:133` 与推送共用渲染入口，改渲染必须两端同时切换，保证所见即所推；PDF 导出（`buildPrintDocument`）同源继承。

### B. 第三步 UI 与叙事（Phase 2）

**B1. 文案与按钮**（`content-workspace.tsx`）：

- 「生成完整正文」→「生成分镜脚本」（含空态「还没有正文。确认大纲后点击…」→「还没有分镜脚本…」、生成中态、引导文案 L459 一并改）；`article-workspace.test.tsx`、`content-workspace.test.tsx` 同步。
- 生成完成后的成功提示改为「分镜脚本已生成：N 段，共 M 帧待生成」。

**B2. 中栏主角切换**：

- 段落卡（`storyboard-segment-list`）保持为文案与路由的编辑主场（现状已支持未拼图时逐段编辑）。
- 独立块编辑器（`block-editor`）降级为次要入口（折叠或收进「高级编辑」），避免作者把脚手架当文章全文来经营；段卡内联编辑已覆盖 95% 场景。
- 字数统计保留现状口径（还原视图、剔除图片块）——它衡量的是「将要烘进图里的文案总量」，语义仍然成立，UI 文案改为「分镜文案字数」。

**B3. 审核门（最小迁移）**：

关键事实：**文案只存一份（blocks 里），审块 = 审文案**。`review-content` 的 issues.blockIds 指向文案块，段卡可按块 id 高亮。因此审核门**不做大迁移**：

- 审核对象、两道门语义（blocked 拒确认 / needs_revision 需勾选警告）、`article_reviews` 表、版本机制全部不动。
- 仅改表述：面板标题与提示语从「正文审核」改为「分镜文案审核」；审核维度里 `outlineCoverage`（大纲覆盖）等语义照旧成立。

### C. knowledge_card（按决策点 D1 执行）

现状：设计器不再生成 knowledge_card 块（ storyboard 流程的产物只有 heading+paragraph）；旧文里已有的 knowledge_card 行为不受影响。若拍板需要「收尾行动清单」，推荐方案见 D1。

### D. 保留不动的部分

- 第四步配图面板：逐帧生成、占位图、解卡入口、重规划让位语义（97dffcd / 0dd10a2 的成果全部继承）。
- 拼接引擎、字体选择、取消段图（旧漫画长图 DELETE 接口对段图同样成立）。
- 乐观并发（expectedUpdatedAt 409）、不可变修订、僵尸 generating 自愈。
- 段图文件命名、`saveComicStripsBatch` 整批落库语义。

## 旧文兼容（按决策点 D4）

按**有无 `planning.storyboardSegments`** 分流，零数据迁移：

- **有段设计**（新流文章，或已点过「生成分镜脚本」的旧文）→ 纯段图流发布。
- **无段设计**（从未进过新第三步的旧文）→ 现状混合路径：通用 `renderWechatHtml` + `hasText` 门原样保留，行为零变化。
- 旧文想升级：回第三步点「生成分镜脚本」即进入新流（会走既有重设计分镜的让位语义）。

## 验证策略

- **单元**：`inspect-publish-readiness`（全段已拼/缺段/残留文本/旧文分流）；`publish-article-draft`（纯段图成功、strips_not_ready、residual_text + force、digest 传入、旧文回归不变）；`render-wechat-html`（段图无 figcaption、旧文渲染回归）。
- **组件**：`content-workspace`（按钮文案、空态、生成完成提示）；`wechat-preview`（段图流预览与推送 HTML 同源）。
- **E2E 约束**：无生图 key → 帧永远待生成、段图拼不出来，E2E 只能覆盖「第三步面板接管 + 按钮改名」；段图发布端到端靠单元 + 组件测试覆盖（与现有段图拼接的测试策略一致）。
- 全量门：vitest / tsc / eslint / `CODEBUDDY_SAFE_DELETE_ENABLED=0 next build` / `node tests/helpers/run-e2e.mjs`（3000 端口独占）。

## 待拍板决策点

| # | 问题 | 选项 | 建议 |
|---|------|------|------|
| D1 | knowledge_card（收尾行动清单）在纯段图流下的去向 | A. 不再生成，行动清单文字烘进最后一段文案<br>B. 保留为推送前「残留文本警告」的一部分，作者自行取舍<br>C. 生成一张知识卡片图（新资产类型）作为收尾段图 | **A**：最贴合「无可复制正文」；行动清单本来就是文案的一部分 |
| D2 | 公众号摘要（digest）来源 | A. 自动截取第一段文案前 ~50 字，推送前可编辑<br>B. 推送时手填<br>C. 继续不传（纯图下微信抓不到，摘要为空） | **A**：零额外负担，摘要不至于开天窗 |
| D3 | 段设计文章里的残留文本块（作者手加的块、旧导语等） | A. 推送前返回警告清单，作者确认（force）后**保留为段图之间的文本**<br>B. 警告后作者须手动删掉或并入段文案才可推<br>C. 静默丢弃（否决——丢内容） | **A**：不丢内容、不堵死混合形态，默认把选择权留给作者 |
| D4 | 旧文兼容 | A. 按有无 storyboardSegments 分流（推荐）<br>B. 全局切纯段图 + 警告 | **A**：零迁移、零行为突变 |
| D5 | 第三步块编辑器的去留 | A. 折叠为「高级编辑」入口<br>B. 完全移除（文案只能段卡内编辑） | **A**：留逃生门，段卡编辑覆盖绝大多数场景 |

## 实施阶段

1. **Phase 1 — 发布层纯段图化**：A1-A3（就绪判定、发布门、渲染器、digest）。这是「发出去的样子」的核心，先行交付。
2. **Phase 2 — 第三步叙事与 UI**：B1-B2 + D1/D5 执行。
3. **Phase 3 — 审核表述与收尾**：B3 + 全量回归 + 文档同步。

每阶段独立可验证、独立提交；全程沿用四步统一工作台与既有分层约定（`features` / `api` / `components`），不新建独立页面。

## 实施记录（2026-09-17）

三阶段已全部完成，5 个决策点均按「建议」列执行：

- **D1**：设计器 schema 结构上只有 segments，不可能再产出 knowledge_card；OpenAI 提示词新增第 7 条（末段必须自然收尾，总结/行动清单烘进末段文案，不输出正文之外的独立模块），并有稳定锚点测试；demo 设计器本就把一句话总结烘进末段 copy。
- **D2**：`inspectPublishReadiness.suggestedDigest`（第一段 copy 跳过标题块、去空白截 50 字），推送时透传给微信草稿接口；legacy 路径仍不传 digest。
- **D3**：残留块默认拒推（`residual_text`），force 放行后保留为段图之间的图文。
- **D4**：按有无 `storyboardSegments` 分流，legacy 路径行为零变化。
- **D5 落实结论**：段设计文章的中栏已由 `StoryboardSegmentList` 段卡主导，`BlockEditor` 只在「无 segments 的旧文」与「历史版本预览」时渲染——「折叠为高级编辑」要防的场景（把脚手架当全文经营）在新流下已不存在；旧文路径 BlockEditor 是唯一内容视图，折叠反而藏内容。故 D5 以现状架构满足，不新增折叠交互。

Phase 2 叙事落点：第三步按钮/空态/引导卡统一为「生成分镜脚本」，生成成功提示交代「N 段，共 M 帧待生成」；Phase 3 表述落点：审核面板「正文审核」→「分镜文案审核」、按钮「审核正文」→「审核文案」，两道门禁语义未动。
