# 剧情漫画重构：从「图文并排」到「群体拟人化的剧情漫画」

> 2026-09-19。起因：作者反馈「现在就是纯粹的图片文字这样没有区别，只是把文字放在图片当中，没有任何特点」，
> 要求「向搞笑故事贴图转换，通过剧情演绎的连续漫画的形式，也不用很多字，通过 prompt 突出丰富的画面内容和剧情」。
> 决策已拍板（见第八节）：**重点是剧情编排与分镜设计，不是文字卡的形式**。

## 一、诉求拆解

| # | 作者原话 | 对应的工程问题 |
|---|----------|----------------|
| R1 | 只是「图片 + 文字」，没有形式特点 | 信息载体：知识写在文字卡里，画面只是配图 |
| R2 | 文字太多，像语文课本段落 | 每段 2~4 块、每块 30-60 字（提示词主动生产课文） |
| R3 | 语句没有读下去的欲望 | 现在只有「讲解节拍」，没有「叙事节拍」 |
| R4 | 要连续漫画、少字、prompt 突出画面与剧情 | 一格一段 → 多格剧情 |
| R5 | **「图中可以有多种一样的物种或者事物。集体的拟人化行为可能更有意思」** | 画面里要有**群体拟人化演出**，不是单一主角站着讲解 |
| R6 | **「主要是剧情编排和分镜设计比较重要」** | 核心改动在**分镜设计师的编排能力与提示词**，不在渲染形式 |

## 二、现状核查：为什么会像「图片+文字」

实测（作者真实文章 `71e439c5` 第三段，`work/story-comic-prototype.check.test.ts` 产出）：

- 该段 = **2 帧画面 + 4 张文字卡 = 313 字**；段图 1080×2868，**大半个高度是文字带**；
- 全篇 5 帧 / 4 段，段图 1080×2868~3628，一段要滑两屏。

根因（按重要性）：

1. **提示词在主动生产课文**。`STORYBOARD_DESIGNER_SYSTEM_PROMPT` 写作要求第 7 条：「copy 用空行拆成 2-4 个小块，每块 30-60 字」，
   第 6 条叠加总量硬约束（`recommendedTotalWords` 800~2000）。知识被写进文字，画面只是装饰。
2. **节拍是讲解节拍**。写作要求第 2 条：「先用具体场景建立直觉，再解释术语，最后给出概念名称」——教科书三段式。
   R3「没有读下去的欲望」不是措辞问题，是**结构问题**。
3. **画面里没有「事件」**。现有提示词虽要求「角色动作 = 内心状态外化」，但每个分镜只被要求「一个角色 + 一个动作」，
   全篇共用同一主角、像讲解员一样站着演示（真实帧：一只袋熊独自站在石头旁、一位研究员独自蹲着看）。
   **没有复数角色、没有集体行为、没有冲突**——这才是「没有任何特点」的画面根因（R5）。
4. **画面被要求自己写字**。提示词让生图模型画「对白气泡『XXX』」≤20 字，实测那个气泡在手机宽度下只有约 **9px**，且中文可能写错（历史踩过「戴熊」）。
5. **一格一段，撑不起剧情**。`frames` 上限 2，`storyboardFrameCount` 由 route 决定 → 结构上最多两格。
6. **主角一致性靠运气**。参考形象库（`reference_characters` / `/api/characters`）已建好，`content/generate` 也收 `character`，
   但 `content-workspace.tsx` 提交时不传 → 当前不进分镜帧 prompt。

## 三、目标形态：`story_comic`

**一段 = 一个「梗」，用群体拟人化画面演出来，文字只做旁白式点睛。**

| 维度 | 规范 |
|------|------|
| 剧情 | 一段一个梗。格数 2（Phase 1）→ 2~4（Phase 3），格与格是**同一场景的连续动作** |
| 画面主体 | **同一物种、同一造型基准的角色，允许且鼓励复数出现**（3~5 只/个一起演出） |
| 画面内容 | 每格都要有明确的**集体行为**：谁在主导、谁在搬、谁在围观、谁翻车；动作外化情绪 |
| 每格文字 | ≤15 字，**旁白式短句**（陈述或吐槽），不是解释段落 |
| 段总字数 | **≤60 字**（现在是 ~250 字/段），末尾一行点题 ≤22 字 |
| 文字位置 | 沿用现有三个路由（`image_text` / `text_image` / `image_text_image`）——**文字在图前或图后皆可，不强制进图**；如果做「图中」，文字也由我们排 |
| 画面文字 | **画面内不出现任何文字**（气泡、标牌、字幕一律不要） |

**不是**要做的：不强制气泡卡片、不强制把文字叠进画面。文字形态与位置按现有路由走，改的重点是**编排**。

## 四、剧情编排规范（本次的核心，写进提示词）

把「有趣」变成可执行约束，而不是提醒模型「写得有趣点」。

### 4.1 一段一个梗 + 三拍

```
第 1 格 · 抛梗兼演出
  出现一个反常、荒谬或自相矛盾的具体画面，同时让一群角色立刻上手去应对它。
  禁止提问式开场（「你有没有想过…」）、禁止先给结论再举例。
第 2 格 · 落点（Phase 1 到此为止；Phase 3 拆成「张力格 + 落点格」）
  一个角色做出揭示机制的动作或说出一句大白话结论——只讲一条因果链，≤22 字。
```

Phase 3 格数放宽到 4 后，中间插入**张力格**：把荒谬推到极致（角色抢、失败、翻车、得意、互相吐槽），
喜剧张力来自**反应**，所以至少要有一格是角色的情绪特写。

### 4.2 群体拟人化（R5，本次最重要的一条）

写进提示词的分镜设计要求：

- **角色可以复数**：同一物种、同一造型基准的多只（个）角色同时出场，各自动作与表情不同；
- 写明**分工**：谁是主导者、谁在配合、谁在围观、谁翻车——群体行为本身就是笑点；
- 造型基准（外形关键短语）在每格 prompt 里**原样复用**，保证观众认得出是同一物种的同一批角色；
- 群体戏用中景以上景别；情绪落点用近景/特写；
- 相邻格景别必须变化（沿用现有约束）。

### 4.3 机械红线（可自动校验，写进审核项）

- 单句 > 22 字 = 不合格；每格 > 15 字 = 不合格；每段 > 60 字 = 不合格；
- 出现「首先/其次/最后」「因为…所以…」式解释连接词 = 不合格；
- 并列列举（顿号 > 3 项）= 不合格；
- 术语必须先用大白话出现过一次才能使用（沿用现有约束）；
- prompt 里出现「画面文字」「气泡」「字幕」等要求模型画字的字样 = 直接打回。

## 五、决策记录（2026-09-19 拍板）

| # | 问题 | 拍板结果 |
|---|------|----------|
| D1 | 改造范围 | **新文默认 story_comic、旧文不动**。加 `planning.presentation` 开关；旧文（未设置）走 illustrated 原路径，重拼也不变 |
| D2 | 交付粒度 | **沿用现有三个路由**；文字在图前/图中/图后皆可，不做强制形态 |
| D3 | 台词形态 | **不强制气泡卡片**；以漫画旁白式短句为主；文字若进图也由我们排版（画面内禁止出现文字） |
| D4 | 字数档位 | **激进**：每格 ≤15 字、每段 ≤60 字 |
| D5 | 改动重心 | **剧情编排与分镜设计提示词**（群体拟人化 + 一段一梗），渲染形式保持弹性 |

## 六、Phase 1 提示词草案（可直接评审）

替换 `openai-storyboard-designer.ts` 里「分镜设计要求」整段（story_comic 形态专用；illustrated 形态保留现有文本）：

```
分镜设计要求（剧情漫画形态）

一段一个梗，用群体演出把它演出来。每格回答的是「读者看到什么、感受到什么」，不是「画面里有什么」。

剧情编排：
- 角色可以复数：同一物种、同一造型基准的角色同时出场 3~5 只（个），各自动作与表情不同。
  写明分工——谁是主导、谁在配合、谁在围观、谁翻车；群体的集体行为本身就是笑点。
- 每格都要有一个明确事件（谁对谁做了什么、结果如何），禁止「一只角色站着演示」的静态讲解。
- 相邻格是同一场景的下一秒：地点、光线、道具必须连续，不要换景；第二格要有进展或反转。
- 造型基准（外形关键短语）在每格 prompt 里原样复用，一字不改；观众要认得出是同一批角色。

画面（prompt 必须写到可以直接交图）：
- 角色与动作：写清每只角色在做什么，动作要外化它的意图；情绪精确到层次
  （不写「难过」，写「强撑体面但眼神已经垮下来」）。
- 场景与道具：为解释服务的道具必须出现在画面里；相邻格道具保持一致。
- 镜头：相邻格景别必须变化（大远景 / 远景 / 全景 / 中景 / 近景 / 特写 / 俯视 / 仰视 / 过肩）。
  群体戏用中景以上，情绪落点用近景以上。
- 严禁画面出现任何文字、符号、气泡、标牌或字幕——所有文字由我们排版，不要你画。
- 画面底色一律纯白（#FFFFFF）：不铺纸纹、不加渐变、不拍环境实景。

文字：
- 每段（title + copy）总字数不超过 60；每格最多一句、不超过 15 字，写成漫画旁白式的短句
  （陈述或吐槽），不是解释段落。
- 禁止「首先 / 其次 / 最后」「因为…所以…」这类解释连接词；禁止超过 22 字的句子；禁止并列列举超过 3 项。
- 术语第一次出现必须先用大白话说过一遍；整段只留一条因果链，分支细节一律砍掉。
- 段末用一句话点题（不超过 22 字），直接写进该段最后一句，不要额外输出总结模块。
```

配套改动：

- 后置校验（`validateStoryboardDesign`）：新增每格 ≤15 字、每段 ≤60 字、prompt 不含画字要求三项闸门，越界打回重试；
- 文风预设新增 **「搞笑剧情解说」**（`funny_storyteller`）：persona = 会写段子的漫画编剧；
  句式=全部口语短句；讲解方式=一段一个梗、群体演出、一句话点题；humor `high`；density `low`；
  avoid = `["教科书式解释", "超过 22 字的长句", "术语先行", "平铺直叙", "并列列举"]`；
- ⚠️ 修正 `style-profile.ts:72-73` 的历史注释（原文「刻意不引入分镜结构/对白气泡——用户明确不再往分镜化方向加」）：
  本次方向已反转，注释必须改写；但 **`plain_explainer` 预设本身不动**（它是文风层，留给纯文字讲解）。

## 七、变更清单

### A. Phase 1：编排与提示词（核心，当天可看）
- `planning.presentation?: "illustrated" | "story_comic"`，未设置 = illustrated（旧文零迁移）。
- `openai-storyboard-designer.ts`：两套系统提示词（按 presentation 选）+ Phase 1 草案落地 +
  删掉「画面文字：对白气泡/旁白框」条款（改成「画面内不得出现任何文字」）+ 新增三项后置闸门。
- `style-profile.ts`：新增「搞笑剧情解说」预设 + 修正历史注释。
- `content-workspace.tsx` / 第三步 UI：形态开关（措辞：**「讲解式」/「剧情漫画」**）。
- 呈现降级（不依赖引擎改造）：本段台词在段图里改用**旁白条**（单行、窄、可带引号），不再是段落卡片。
- 审核器（`openai-content-reviewer.ts`）：新增 `hookStrength` 维度 + 机械检查（长句、解释连接词、并列列举、字数越界、prompt 是否要求画字）。

### B. Phase 2：呈现微调（按需，非强制）
- 段图排版新增**旁白条/台词条**块（区别于现有「卡片段落」）；
- 可选：**图中旁白**（overlay 图层，文字仍由我们矢量绘制）。
  现有引擎只有竖向堆叠、无 overlay，这是唯一需要动引擎的部分——**因为 D2/D3 拍了不做强制气泡，本阶段可以推迟或不做**。

### C. Phase 3：多格
- `frames` 上限 2 → 4；`storyboardFrameCount` 改为「route 给默认格数、帧数是事实」；
- 落库 / 缺口校验 / 帧面板 UI / 拼接拼序全部按 N 格；格间纵向 1×N。

### D. Phase 4：群体角色一致性
- 把 `characterId` 从第三步 UI 接进 `content/generate`（schema 已支持，只差提交与提示词注入）；
- 造型基准固定 = 多角色也认得出是同一批人；可加「角色数量/阵容」设定（可选）。

### E. Phase 5：验收体系
- Demo 设计器同步产出 story_comic 形状（E2E 依赖 Demo）；
- 手机宽度肉眼对照脚本（沿用本次建立的模式）；
- 字数/红线断言；旧文路径回归。

## 八、兼容与数据结构

- 唯一新增字段：`planning.presentation`（可选）。**不新增资产类型、不新增表**。
- 帧增加 `line`（台词/旁白，可选）：旧帧没有 → 渲染时跳过，不影响已生成图。
- 旧文（无 `presentation`）：全部走 illustrated 原路径，产物一个字不变。

## 九、实施阶段

- **Phase 1**：形态开关 + 新提示词 + 文风预设 + 旁白条呈现 + 审核项（**不依赖引擎改造，当天可看效果**）
- Phase 2：旁白条/台词条块（+ 可选图中旁白 overlay）
- Phase 3：多格 2~4（补齐「张力格」，完整三拍）
- Phase 4：群体角色一致性（参考形象库接入）
- Phase 5：验收体系（Demo 形态、E2E、手机宽度对照、红线断言）

## 十、实施记录

### Phase 1：编排与提示词（2026-09-19 完成）

| # | 改动 | 落点 |
|---|------|------|
| 1 | 呈现形态模型 + 解析 | `articles/domain.ts`：`StoryboardPresentation` / `STORYBOARD_PRESENTATION_LABELS` / `isStoryboardPresentation` / `resolveStoryboardPresentation`；`ArticlePlanning.presentation` |
| 2 | planning 字段登记 | `articles/schemas.ts`：登记 `presentation`；**顺手补上漏登记的 `storyboardTextScaleId`**（整篇 PATCH 会 strip 未登记字段，字号选择此前会被静默丢掉） |
| 3 | 两套系统提示词 | `openai-storyboard-designer.ts`：`STORYBOARD_DESIGNER_STORY_COMIC_PROMPT` / `STORYBOARD_REVISER_STORY_COMIC_PROMPT` + 选词函数 `storyboardDesignerPrompt` / `storyboardReviserPrompt` |
| 4 | 机械红线单一事实源 | 新模块 `content/story-comic-rules.ts`：每段 60 字、每句 22 字、prompt 不许写字、成对解释连接词、顿号 >3 项；`inspectStoryComicSegment` / `inspectStoryComicDesign` |
| 5 | 生成闸门 | `validateStoryboardDesign` 在 story_comic 下叠加第 4 项的检查（容差 1.15，与总字数闸同口径） |
| 6 | 文风预设 | `style-profile.ts` 新增 `funny_storyteller`（humor `high`，density `low`）；`HumorLevel` 增加 `high`；修正 `plain_explainer` 的历史注释（预设本身不动） |
| 7 | 形态开关 | 第三步「生成设置」新增「呈现形态」下拉（剧情漫画 / 讲解式）+ 待生效提示；`GenerateContent` 请求带 `presentation`，`content/generate` 路由校验 |
| 8 | 落库一次写 | `generateContent` 解析形态 → 传设计器 → 随 `applyStoryboardPlan(…, planningPatch)` 与 segments 同时落 planning（不引入第二次乐观锁写） |
| 9 | 修订同源 | `reviseStoryboard` 从文章的 planning 解析形态，传给修订器并跑同一道红线闸 |
| 10 | 审核 | `ContentReviewResult.hookStrength` 新维度（面板「钩子强度」）；`sanitizeContentReview` 在 story_comic 下按第 4 项补 warning 级意见（定位到该段小标题块，不改 status） |
| 11 | Demo | `DemoStoryboardDesigner` 按形态产出：剧情漫画 = 短旁白（一段一个梗）+ 三只柴犬的分工演出 + 画面不写字 |

**默认规则（D1 落地口径）**：`resolveStoryboardPresentation` —— 显式值优先；未设置时「已设计过分镜」= 旧文 → `illustrated`，「没设计过」= 新文 → `story_comic`。旧文零迁移，重拼也不变形。

**误伤修正（实测踩到）**：连接词判据一开始是「出现 最后 / 因为 / 所以 即违规」，把 Demo 的「最后还是最小的那只先找对了门道」判成了教科书连接——改成**成对出现**才算（首先…其次 / 首先…最后 / 因为…所以）+ 书面过渡语句表（由此可见 / 综上所述 / 总之 / 让我们来看看 / 值得注意的是）。规则比提示词松一档是对的：提示词劝模型别这么写，闸门只拦真正读起来像课本的。

**Phase 1 未做（有意挪到 Phase 2）**：段图的「旁白条」块类型。文案已缩到每段 60 字内，现有文字带就是「标题卡 + 1-2 行短句」，视觉占比不再压倒画面；把它做成独立块类型要动渲染引擎（`comic-strip.ts` 的块类型与排版），与 Phase 2 的 overlay 一起做更省事。

**验证**：`tsc` 0 错误；`eslint` 0 问题；单元测试 **879 passed + 2 skipped / 126 文件**；E2E **10 passed / 10 skipped**（1.4 分钟）。

**顺带修掉的验证基建**：E2E 以前必须等本机 dev server 停掉才能跑（Next 16 的 dev 锁落在 `<distDirRoot>/dev/lock`，第二个实例直接退出）。查证发现 `next({ conf: { distDir } })` 在 Next 16 已失效——自定义服务器（`NextCustomServer.prepare`）调用 `getRequestHandlers` 时不转发 `conf`，distDir 被静默忽略。改为：`next.config.ts` 读环境变量 `WO_XI_DIST_DIR`（未设置时行为完全不变），E2E 启动器设 `WO_XI_DIST_DIR=.next/e2e-dev` → 锁落在独立目录，**可与使用中的 3000 端口 dev server 并行跑**。代价：首跑冷编译一次，之后复用缓存；`tsconfig.json` 被 Next 自动加了两个 include（`.next/e2e-dev/**`），留着以保证后续运行幂等。

### Phase 2：台词/旁白条 + 正文居中（2026-09-19 完成）

§八 拍板的「帧增加 `line`（台词/旁白，可选）」落地，字段定名 `speechLine`（结构化两字段：`kind: dialogue|narration` + `text`）。

| # | 改动 | 落点 |
|---|------|------|
| 1 | 数据模型 | `image_assets.speech_line` 列（存 JSON，NULL=无台词，ALTER 迁移幂等）；`SpeechLine` / `isSpeechLineKind`（images/domain）；`asset-row.ts` 单点解析（坏 JSON 回落 null，只损失一条台词不伤文章）；`insertAsset` / `updateAsset` SQL 带列 |
| 2 | 类型贯穿 | `StoryboardFramePlan`（落库输入）→ `ImageAsset.speechLine`（资产）→ `StoryboardDesignFrame`（设计稿）→ `StoryboardFrameSnapshot`（版本快照）四处可选字段；`generate-content.buildSegmentBlocks` / `revise-storyboard`（restoreCurrentDesign、替换段 plans、快照 retained 分支）/ `content-version.enrichStoryboardSnapshotSegments` 全链路透传 |
| 3 | 设计器 | story_comic 提示词：frames 增加可选 `speechLine`——dialogue=角色嘴里短句 ≤10 字，narration=画外音 ≤25 字，「能加笑点才写，宁缺毋滥」；修订提示词同步（未点名段台词原样保留）；Zod 结构闸 max 30，精确红线留给红线闸报（错误信息才带指引） |
| 4 | 红线 | `story-comic-rules.ts`：`STORY_COMIC_MAX_DIALOGUE_CHARS=10` / `STORY_COMIC_MAX_NARRATION_CHARS=25`（容差 1.15 → 判定线 12/29）；`inspectStoryComicSegment` 增 `speechLines` 入参，`inspectStoryComicDesign` 从帧透传——生成闸与真实验收同一口径 |
| 5 | 渲染器 | `comic-strip.ts` 新块类型 `speech`：**旁白=橙底圆角条（#FFB03A）+ 左侧红衣青年简笔头像**（纯 SVG 矢量：肤脸+黑发+红衣，直径 = bodySize×2.1，字号档位变它跟着变）；**对白=白底橙描边条**；与文字卡同款右下硬阴影；条内文字垂直居中加粗 |
| 6 | 拼接接线 | `compose-segment-strips.ts`：帧与台词绑定成组 `[image, speech?]`，按路由（图+文 / 文+图 / 图+文+图）插进段图；**旧帧无台词 → 只有图，零迁移**（§八 的跳过语义） |
| 7 | 编辑 | PATCH `/api/articles/:id/image-assets/:assetId` 接受 `speechLine`（null=清除）；仓储 update 把台词编辑计入 contentEdited → manuallyEdited（防批量顶替，与 altText 同语义）。帧卡片上的台词 inline 编辑 UI 待接（PATCH 链路已通） |
| 8 | 修订一致性 | `revise-storyboard.ts` 的 `sameSegment` 把台词纳入比对：模型改了台词而帧图没换时，段算「变」→ 帧资产随段替换——否则资产上的旧台词会被静默保留，修订等于没生效 |
| 9 | P3 正文居中 | 文字带正文 `text-anchor="middle"` 卡片内居中 + 每行 ≤13 全角字（`TEXT_BAND_MAX_CHARS_PER_LINE=13`，预算 = min(卡片内容宽, bodySize×13)）；标题保持左对齐 + 竖条——混知式「居中短行」，行宽吃满就是课文脸 |

**Demo 同步**：`demoStoryComicFrames` 在 image_text_image 的两帧上分别带 narration（15 字）与 dialogue（7 字）台词、单帧排法刻意不带——E2E 与组件测试同时覆盖「有台词渲染橙条」与「旧帧跳过」两条路径。E2E 无生图服务，段图端到端由 `compose-segment-strips.test.ts`（真仓储 + 台词 round-trip + 带台词段图更高）与 `comic-strip.test.ts`（条块排版/像素取色/头像位）覆盖。

**验证**：tsc 0；eslint 0；单元测试 **890 passed + 2 skipped / 126 文件**（新增 10 个用例）；真模型 live check（`work/story-comic-live.check.test.ts`）复跑通过，模型开始输出台词、拼图含橙条（产物落 `work/story-comic-live-segment.png` / `-phone.png`）。

