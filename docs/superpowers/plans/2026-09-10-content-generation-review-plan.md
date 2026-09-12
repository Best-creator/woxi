# 正文生成、审核与版本历史 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已确认大纲之上建立独立正文工作台，按人物语言风格一次生成完整结构化正文，完成独立质量审核、正文版本回溯、公众号预览和现有配图能力衔接。

**Architecture:** 复用纲要计划提供的共享 JSON LLM 客户端、模型白名单和不可变修订仓储。正文生成器只返回标题和带 `sectionKey` 的内容块，服务端负责 ID 与章节关联；正文审核绑定不可变正文修订，当前正文通过 `contentOutlineRevisionId` 明确依赖哪个确认大纲版本。

**Tech Stack:** Next.js 16.3.4 App Router、React 19、TypeScript 5.9、Node.js 26 `node:sqlite`、Zod 4、Vitest、Testing Library、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-10-llm-content-generation-design.md`

**Prerequisite:** 完成并验证 `docs/superpowers/plans/2026-09-10-outline-generation-review-plan.md`。

## Global Constraints

- 正文页面固定为 `/articles/{id}/content`，未确认大纲时必须服务端重定向到纲要页。
- 正文必须基于当前确认的大纲整篇一次生成，不按章节独立调用模型。
- 人物语言风格只影响正文生成和风格审核，不改变事实、知识边界或确认后的大纲顺序。
- 允许块类型仅为 `heading`、`paragraph`、`quote`、`callout`、`knowledge_card`；图片由现有配图流程负责。
- 正文审核必须是独立 LLM 调用，检查清晰度、零基础友好度、连贯性、吸引力、大纲覆盖、资料一致性和风格匹配。
- `blocked` 阻止标记为 `content_ready`；`needs_revision` 允许用户显式忽略警告。`ready_to_publish` 保留给后续配图和发布流程。
- 首版审核只提供诊断、问题块定位和人工修改，不自动覆盖正文。
- 自动保存不创建版本；生成、审核前内容变化和主动保存创建去重后的不可变正文版本。
- 恢复旧正文产生新版本；大纲变化时旧正文保留但标记为基于旧大纲。
- 密钥只保留在服务端，所选模型必须通过服务端白名单。
- LLM 请求地址固定为 `{LLM_BASE_URL}/v1/chat/completions`。
- 所有写请求携带 `expectedUpdatedAt` 并使用事务和乐观并发控制。
- 保持现有公众号预览、图片资产、自动保存竞态保护和移动端只读行为。
- 实现 Route Handler 前阅读 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`、`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` 和 `node_modules/next/dist/docs/01-app/02-guides/redirecting.md`。
- 当前仓库没有有效 `HEAD` 且 `.git` 不可写；不要尝试提交。每个任务以目标测试通过作为检查点。

---

### Task 1: 人物语言风格领域模型

**Files:**
- Create: `src/features/content/style-profile.ts`
- Create: `src/features/content/style-profile.test.ts`
- Create: `src/features/content/schemas.ts`
- Modify: `src/features/articles/domain.ts`
- Modify: `src/features/articles/schemas.ts`
- Modify: `src/features/articles/sqlite-repository.ts`
- Modify: `src/features/articles/sqlite-repository.test.ts`
- Modify: `src/features/images/sqlite-repository.ts`
- Modify: `src/features/images/sqlite-repository.test.ts`
- Modify: `src/server/db.ts`
- Modify: `tests/fixtures/article.ts`

**Interfaces:**
- Produces: `StylePreset`
- Produces: `StyleProfile`
- Produces: `STYLE_PRESETS: Record<Exclude<StylePreset, "custom">, StyleProfile>`
- Extends: `Article` with `styleProfile: StyleProfile`
- Extends: `ArticleStatus` with `content_ready`

- [ ] **Step 1: 写预设解析和持久化失败测试**

```ts
expect(resolveStyleProfile("friend_chat", "少用反问句")).toMatchObject({
  preset: "friend_chat",
  tone: "亲切、自然、像朋友聊天",
  customInstructions: "少用反问句"
});

expect(resolveStyleProfile("custom", "像耐心的高中老师一样解释")).toMatchObject({
  preset: "custom",
  customInstructions: "像耐心的高中老师一样解释"
});
```

仓储测试保存并重新读取 `styleProfile`，证明旧数据库缺列时迁移后使用“通俗科普老师”默认值。

- [ ] **Step 2: 运行测试并确认红灯**

Run: `pnpm vitest run src/features/content/style-profile.test.ts src/features/articles/sqlite-repository.test.ts`

Expected: FAIL，风格模块和文章字段尚不存在。

- [ ] **Step 3: 定义风格类型和预设**

```ts
export type StylePreset =
  | "popular_science_teacher"
  | "rational_analyst"
  | "friend_chat"
  | "storyteller"
  | "knowledge_cards"
  | "custom";

export interface StyleProfile {
  preset: StylePreset;
  persona: string;
  tone: string;
  readerAddress: string;
  sentenceStyle: string;
  explanationStyle: string;
  humorLevel: "none" | "light" | "moderate";
  questionFrequency: "low" | "moderate" | "high";
  contentDensity: "low" | "medium" | "high";
  customInstructions: string;
  avoid: string[];
}
```

五个预设必须写成完整常量，自定义说明限 1000 字；`avoid` 最多 12 项、每项最多 100 字。

- [ ] **Step 4: 持久化风格配置**

为 `articles` 表增加幂等 `style_json` 列，仓储读旧行时使用 `STYLE_PRESETS.popular_science_teacher`。更新 `ArticleStatus` 和 article Zod schema，加入 `content_ready`，并保证客户端只能提交合法枚举和长度受限字符串。同步更新图片仓储的 Article 映射，使图片事务返回相同的 `styleProfile`。

- [ ] **Step 5: 验证领域与仓储测试**

Run: `pnpm vitest run src/features/content/style-profile.test.ts src/features/articles/sqlite-repository.test.ts src/app/api/articles/[id]/route.test.ts`

Expected: PASS，旧 article fixture 和 PATCH 接口继续工作。

---

### Task 2: 正文修订快照与大纲依赖

**Files:**
- Modify: `src/features/revisions/domain.ts`
- Modify: `src/features/revisions/repository.ts`
- Modify: `src/features/revisions/sqlite-repository.ts`
- Modify: `src/features/revisions/sqlite-repository.test.ts`
- Create: `src/features/content/content-version.ts`
- Create: `src/features/content/content-version.test.ts`
- Create: `src/features/images/merge-image-blocks.ts`
- Create: `src/features/images/merge-image-blocks.test.ts`
- Modify: `src/features/images/sqlite-repository.ts`

**Interfaces:**
- Produces: `ContentRevisionSnapshot`
- Produces: `createContentSnapshot(article, sourceContextSnapshot): ContentRevisionSnapshot`
- Produces: `isContentBasedOnCurrentOutline(article): boolean`
- Consumes: revision repository from the outline plan

- [ ] **Step 1: 写正文独立编号和依赖判断失败测试**

```ts
const article = articleFixture({
  planning: {
    lengthPreset: "standard",
    recommendedTotalWords: 1200,
    confirmedOutlineRevisionId: "outline-v2",
    contentOutlineRevisionId: "outline-v1"
  },
  blocks: twoBlocks()
});
const snapshot = createContentSnapshot(article, "资料快照");

expect(snapshot.outlineRevisionId).toBe("outline-v1");
expect(isContentBasedOnCurrentOutline(article)).toBe(false);
```

增加恢复正文 v1 后产生 v3、v2 仍存在，以及正文版本号不受大纲版本号影响的仓储测试。

- [ ] **Step 2: 运行测试并确认红灯**

Run: `pnpm vitest run src/features/content/content-version.test.ts src/features/revisions/sqlite-repository.test.ts`

Expected: FAIL，正文快照和依赖函数尚不存在。

- [ ] **Step 3: 实现完整正文快照**

```ts
export interface ContentRevisionSnapshot {
  title: string;
  textBlocks: ContentBlock[];
  outlineRevisionId: string;
  styleProfile: StyleProfile;
  recommendedTotalWords: number;
  sourceContextSnapshot: string;
}

export function isContentBasedOnCurrentOutline(article: Article) {
  return Boolean(
    article.planning.confirmedOutlineRevisionId &&
    article.planning.contentOutlineRevisionId ===
      article.planning.confirmedOutlineRevisionId
  );
}
```

正文快照没有确认大纲 ID、推荐总字数或非图片正文块时必须拒绝创建。`createContentSnapshot` 过滤所有 `type === "image"` 的块，正文内容哈希也只基于标题、非图片块、人物风格和依赖的大纲修订 ID。

- [ ] **Step 4: 实现正文恢复原子操作**

恢复流程在一个事务中读取目标正文修订、复制标题/非图片块/风格/大纲依赖到当前 article、重新合并当前启用的图片资产引用、更新 `updatedAt`，再以 `reason: "restored"` 创建去重后的新正文修订。目标修订不属于当前文章或 scope 不是 `content` 时返回 not found。

将图片仓储现有的“按锚点重建 image blocks”逻辑提取为纯函数 `mergeImageBlocks(textBlocks, assets)`，由图片仓储和正文恢复共同调用。图片规划或图片状态变化不得改变正文审核的内容哈希。

- [ ] **Step 5: 验证版本行为**

Run: `pnpm vitest run src/features/content/content-version.test.ts src/features/revisions/sqlite-repository.test.ts`

Expected: PASS，恢复不删除历史，大纲依赖可准确判定。

---

### Task 3: 正文生成器与审核器

**Files:**
- Create: `src/features/content/ports.ts`
- Create: `src/features/content/openai-content-generator.ts`
- Create: `src/features/content/openai-content-generator.test.ts`
- Create: `src/features/content/openai-content-reviewer.ts`
- Create: `src/features/content/openai-content-reviewer.test.ts`
- Create: `src/features/content/demo-content-agents.ts`
- Create: `src/features/content/demo-content-agents.test.ts`
- Modify: `src/server/services.ts`
- Modify: `src/server/services.test.ts`

**Interfaces:**
- Produces: `ContentGenerator.generate(input): Promise<GeneratedContent>`
- Produces: `ContentReviewer.review(input): Promise<ContentReviewResult>`
- Consumes: `OpenAiJsonClient`, confirmed outline, style profile and article types

- [ ] **Step 1: 写整篇生成协议失败测试**

```ts
const generated = await generator.generate({
  topic: "机会成本",
  targetAudience: "对该知识点零基础的普通读者",
  sourceContext: "机会成本是放弃的最佳替代方案。",
  brief,
  outline: [{
    id: "section-1",
    title: "机会成本是什么",
    goal: "建立直观定义",
    recommendedWords: 400,
    order: 0
  }],
  recommendedTotalWords: 1000,
  styleProfile: STYLE_PRESETS.friend_chat,
  model: "grok-4.6"
});

expect(generated.blocks).toEqual(expect.arrayContaining([
  expect.objectContaining({ sectionKey: "section-1", type: "paragraph" })
]));
```

断言只发出一次 `fetch`、user message 同时包含全部章节、图片类型被拒绝、未知 section key 被拒绝、空文章被拒绝。

- [ ] **Step 2: 写正文审核协议失败测试**

审核结果覆盖七个维度，`sourceFidelity` 在无资料时必须为 `null`，每个 `blockIds` 必须属于输入正文。`blocked` 必须至少包含一个 blocking issue。

- [ ] **Step 3: 运行 Agent 测试并确认红灯**

Run: `pnpm vitest run src/features/content/openai-content-generator.test.ts src/features/content/openai-content-reviewer.test.ts src/features/content/demo-content-agents.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 4: 实现 schema、Prompt 和 Agent**

```ts
export const generatedContentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  blocks: z.array(z.object({
    sectionKey: z.string().min(1).max(64),
    type: z.enum(["heading", "paragraph", "quote", "callout", "knowledge_card"]),
    content: z.string().trim().min(1).max(5000),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional()
  })).min(4).max(80)
});
```

生成 Prompt 必须要求：遵循已确认章节顺序；面向零基础读者；先场景再解释术语；章节之间自然承接；避免重复和凑字；风格不得改变事实；只返回标题与 blocks JSON。审核 Prompt 必须独立判断清晰度、零基础友好度、连贯性、吸引力、大纲覆盖、资料一致性和风格匹配。

正文生成超时 120 秒，正文审核超时 90 秒。Demo 实现生成确定性正文并返回 `passed`，确保无 Key 开发和 E2E 不访问网络。

- [ ] **Step 5: 注册服务并验证**

`getContentGenerator()` 和 `getContentReviewer()` 有 LLM 配置时返回 OpenAI 实现，无配置时返回新的 Demo content agents。移除旧 `DemoContentGenerator` 的服务绑定，但在旧兼容路由删除前保留源文件。

Run: `pnpm vitest run src/features/content src/server/services.test.ts`

Expected: PASS，模型选择和 Demo 回退都被覆盖。

---

### Task 4: 正文用例与 Route Handlers

**Files:**
- Create: `src/features/content/generate-content.ts`
- Create: `src/features/content/generate-content.test.ts`
- Create: `src/features/content/review-content.ts`
- Create: `src/features/content/review-content.test.ts`
- Create: `src/features/content/restore-content-version.ts`
- Create: `src/features/content/restore-content-version.test.ts`
- Create: `src/features/content/approve-content.ts`
- Create: `src/features/content/approve-content.test.ts`
- Create: `src/features/content/workflow-repository.ts`
- Create: `src/features/content/sqlite-workflow-repository.ts`
- Create: `src/features/content/sqlite-workflow-repository.test.ts`
- Create: `src/app/api/articles/[id]/content/generate/route.ts`
- Create: `src/app/api/articles/[id]/content/generate/route.test.ts`
- Create: `src/app/api/articles/[id]/content/review/route.ts`
- Create: `src/app/api/articles/[id]/content/review/route.test.ts`
- Create: `src/app/api/articles/[id]/content/approve/route.ts`
- Create: `src/app/api/articles/[id]/content/approve/route.test.ts`
- Create: `src/app/api/articles/[id]/content/versions/route.ts`
- Create: `src/app/api/articles/[id]/content/versions/[versionId]/restore/route.ts`
- Create: `src/app/api/articles/[id]/content/versions/route.test.ts`

**Interfaces:**
- Produces: content generate、review、approve、list 和 restore 领域结果
- Produces: `ContentWorkflowRepository`，负责文章与正文修订的原子写入
- Consumes: article/source/revision repositories and content agents

- [ ] **Step 1: 写正文生成用例失败测试**

```ts
const result = await generateContent({
  articleId: article.id,
  expectedUpdatedAt: article.updatedAt,
  model: "grok-4.6",
  styleProfile: STYLE_PRESETS.friend_chat
}, dependencies);

expect(result).toMatchObject({
  kind: "generated",
  article: {
    status: "editing",
    planning: {
      contentOutlineRevisionId: "outline-revision-2"
    }
  },
  revision: { scope: "content", version: 1 }
});
```

覆盖未确认大纲、大纲审核 `blocked`、文章版本冲突、Agent 失败、无效 section key 和事务失败均不写正文修订。

- [ ] **Step 2: 写正文审核和恢复失败测试**

覆盖：当前正文基于旧大纲时拒绝审核；手工编辑或改变启用资料后审核自动创建新正文修订；重复审核不重复版本；手工 POST 保存版本；问题引用未知 block 时拒绝；恢复旧正文产生新版本并恢复对应风格和大纲依赖；`blocked` 拒绝批准；`needs_revision` 只有 `acknowledgeWarnings` 为 true 时才能批准；批准后状态为 `content_ready` 而不是 `ready_to_publish`。

- [ ] **Step 3: 运行目标测试并确认红灯**

Run: `pnpm vitest run src/features/content src/app/api/articles/[id]/content`

Expected: FAIL，用例和路由尚不存在。

- [ ] **Step 4: 实现转换、阶段工作流仓储、事务和 HTTP 映射**

传入正文 Prompt 时使用持久化 `OutlineSection.id` 作为 `sectionKey`。服务端把 LLM 返回的 `sectionKey` 映射到确认大纲的真实 `sectionId`，为正文块生成 UUID、连续 order 和 `version: 1`。

`SqliteContentWorkflowRepository` 与 article/revision repositories 共享同一个 `DatabaseSync`，提供 `saveGeneratedContent`、`checkpointContent` 和 `restoreContent`。每个方法在 `BEGIN IMMEDIATE` 与 `COMMIT` 之间更新当前文章，并调用纲要计划提供的 `createRevisionIfChangedInTransaction` 创建或复用正文修订；异常时 `ROLLBACK`。网络调用必须发生在事务开始之前，禁止嵌套事务。

```ts
const generateContentRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).optional(),
  styleProfile: styleProfileSchema
});

const reviewContentRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).optional()
});

const approveContentRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  acknowledgeWarnings: z.boolean().default(false)
});

const saveContentVersionRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime()
});
```

输入错误和流程门禁为 400，不存在 404，版本冲突 409，模型调用失败 502，成功 200。

- [ ] **Step 5: 验证用例和 API**

Run: `pnpm vitest run src/features/content src/app/api/articles/[id]/content`

Expected: PASS，失败不会覆盖当前正文或版本历史。

---

### Task 5: 独立正文工作台 UI

**Files:**
- Create: `src/app/articles/[id]/content/page.tsx`
- Create: `src/app/articles/[id]/content/content-workspace.tsx`
- Create: `src/app/articles/[id]/content/content-workspace.test.tsx`
- Create: `src/components/style-profile-control.tsx`
- Create: `src/components/style-profile-control.test.tsx`
- Create: `src/components/content-review-panel.tsx`
- Create: `src/components/content-review-panel.test.tsx`
- Modify: `src/components/version-history.tsx`
- Modify: `src/components/version-history.test.tsx`
- Modify: `src/components/block-editor.tsx`
- Modify: `src/components/block-editor.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: public model config, current confirmed outline, content APIs, content revisions and reviews
- Produces: accessible content generation/edit/review/version UI

- [ ] **Step 1: 写正文工作台交互失败测试**

```tsx
render(<ContentWorkspace
  initialArticle={confirmedArticle}
  initialSources={[]}
  initialImageAssets={[]}
  initialVersions={[]}
  initialReview={null}
  llmConfig={{
    enabled: true,
    availableModels: ["grok-4.6", "writer-large"],
    defaultModel: "grok-4.6"
  }}
  generateContent={generateContent}
/>);

await user.selectOptions(screen.getByLabelText("正文模型"), "writer-large");
await user.selectOptions(screen.getByLabelText("人物语言风格"), "friend_chat");
await user.click(screen.getByRole("button", { name: "生成完整正文" }));
expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
  model: "writer-large",
  styleProfile: expect.objectContaining({ preset: "friend_chat" })
}));
```

增加审核问题定位、编辑或改变启用资料后审核过期、基于旧大纲警告、主动保存版本、版本恢复、审核批准门禁、生成和保存竞态、移动端只读测试。

- [ ] **Step 2: 运行 UI 测试并确认红灯**

Run: `pnpm vitest run src/components/style-profile-control.test.tsx src/components/content-review-panel.test.tsx src/components/version-history.test.tsx src/app/articles/[id]/content/content-workspace.test.tsx`

Expected: FAIL，页面和控件尚不存在。

- [ ] **Step 3: 实现服务端页面门禁和数据装配**

`page.tsx` 读取文章后检查 `confirmedOutlineRevisionId`；缺失时 `redirect(`/articles/${id}/outline`)`。并行读取资料、图片资产、正文版本、当前版本最新审核和公开模型配置。只将模型名称传给客户端。纲要工作台确认成功后使用 `router.push(`/articles/${article.id}/content`)` 进入此页面。

- [ ] **Step 4: 实现工作台布局与审核定位**

桌面布局保持左侧只读确认大纲、中央正文编辑器、右侧模型/风格/生成/审核/版本操作。移动端单列，正文块只读，按钮和选择控件不得溢出。

审核 issue 的 `blockIds` 映射到块 DOM id；点击问题使用 `scrollIntoView({ block: "center" })` 并短暂突出目标块。审核只显示建议，不提供自动替换按钮。审核通过或用户显式忽略 `needs_revision` 后显示“确认内容”命令，调用 approve API 并把状态更新为 `content_ready`。

- [ ] **Step 5: 验证 UI 测试**

Run: `pnpm vitest run src/components src/app/articles/[id]/content/content-workspace.test.tsx`

Expected: PASS，现有预览和图片组件测试保持通过。

---

### Task 6: 路由切换、旧工作台退役与配图衔接

**Files:**
- Modify: `src/app/articles/[id]/page.tsx`
- Modify: `src/app/articles/[id]/article-workspace.tsx`
- Modify: `src/app/articles/[id]/article-workspace.test.tsx`
- Modify: `src/components/generation-panel.tsx`
- Modify: `src/app/articles/[id]/outline/outline-workspace.tsx`
- Modify: `src/features/images/plan-images.ts`
- Modify: `src/features/images/plan-images.test.ts`
- Modify: `src/app/api/articles/[id]/generate/route.ts`
- Modify: `src/app/api/articles/[id]/generate/route.test.ts`

**Interfaces:**
- Produces: legacy article route redirect
- Preserves: existing image planning APIs and preview behavior

- [ ] **Step 1: 写重定向和旧大纲正文失效测试**

未确认大纲访问 `/articles/{id}` 应重定向 `/outline`；已确认大纲应重定向 `/content`。确认新的大纲版本后，`contentOutlineRevisionId` 不再等于当前确认大纲，图片规划应返回流程错误而不是为过期正文配图。

- [ ] **Step 2: 运行相关测试并确认红灯**

Run: `pnpm vitest run src/app/articles/[id] src/features/images/plan-images.test.ts`

Expected: FAIL，旧路径仍渲染单页工作台且配图未检查大纲依赖。

- [ ] **Step 3: 把旧路径改为服务端重定向**

```ts
export default async function ArticleEntryPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const article = await getArticleRepository().findById(id);
  if (!article) notFound();
  redirect(article.planning.confirmedOutlineRevisionId
    ? `/articles/${id}/content`
    : `/articles/${id}/outline`);
}
```

将 `article-workspace.tsx` 中仍需使用的自动保存和图片响应竞态逻辑迁入 `content-workspace.tsx` 后删除旧组件和旧测试。`generation-panel.tsx` 收缩为配图面板或将其内容直接并入正文工作台，避免保留两个正文生成入口。

- [ ] **Step 4: 保留旧生成 API 的明确兼容行为**

旧 `POST /api/articles/{id}/generate` 返回 410 和 `{ "error": "请使用分阶段纲要与正文生成接口" }`，不再生成 Demo 全文。更新内部调用和测试，确保页面不会请求旧端点。

配图规划增加 `isContentBasedOnCurrentOutline` 门禁；旧文章没有版本信息时仍允许查看和编辑，但必须先完成新纲要确认与正文生成后才能重新分析配图。

- [ ] **Step 5: 验证路由与配图回归**

Run: `pnpm vitest run src/app/articles/[id] src/features/images src/components/image-planning-panel.test.tsx src/components/wechat-preview.test.tsx`

Expected: PASS，只有一个正文生成入口，过期正文不能产生新配图计划。

---

### Task 7: 全流程 E2E、README 与最终验证

**Files:**
- Create: `tests/e2e/content-workflow.spec.ts`
- Modify: `tests/e2e/outline-workflow.spec.ts`
- Modify: `tests/e2e/foundation-flow.spec.ts`
- Modify: `tests/helpers/run-e2e.mjs`
- Modify: `README.md`

**Interfaces:**
- Produces: 从创建文章到纲要审核、正文生成、正文审核、版本恢复、配图和预览的离线可重复验收流程

- [ ] **Step 1: 写正文 E2E 失败用例**

```ts
test("generates, reviews and restores a content version", async ({ page }) => {
  await page.goto("/articles/new");
  await page.getByLabel("知识点", { exact: true }).fill("什么是机会成本");
  await page.getByRole("button", { name: "创建文章" }).click();
  await page.getByRole("button", { name: "生成理解与大纲" }).click();
  await page.getByRole("button", { name: "审核大纲" }).click();
  await page.getByRole("button", { name: "确认大纲" }).click();
  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+\/content$/);
  await page.getByLabel("人物语言风格").selectOption("friend_chat");
  await page.getByRole("button", { name: "生成完整正文" }).click();
  await page.getByRole("button", { name: "审核正文" }).click();
  await expect(page.getByText("审核通过")).toBeVisible();
  await page.getByRole("button", { name: "确认内容" }).click();
  await expect(page.getByText("正文 v1")).toBeVisible();
});
```

扩展用例：保存正文 v2 后恢复 v1 产生 v3；修改并重新确认大纲后旧正文显示“基于旧大纲”；移动端正文只读且无横向溢出。

- [ ] **Step 2: 运行 E2E 并确认红灯**

Run: `pnpm test:e2e -- --grep "generates, reviews and restores"`

Expected: FAIL，完整流程尚未全部接通。

- [ ] **Step 3: 更新旧 E2E 和测试服务配置**

测试保持 `LLM_API_KEY=""`、`LLM_MODEL=""` 和 `LLM_MODELS=""`，只使用确定性 Demo agents。把原 `foundation-flow` 的正文、配图和预览断言迁入新 content workflow，删除对“生成演示初稿”和旧单页 URL 的依赖。

- [ ] **Step 4: 更新 README**

README 说明两页面工作流、两道审核门、长度档位、人物风格、模型白名单、版本创建与恢复规则、无资料核验提示、环境变量，以及真实配图仍未接入的边界。

- [ ] **Step 5: 完整自动验证**

Run: `pnpm test`

Expected: 所有 Vitest 测试 PASS。

Run: `pnpm lint`

Expected: ESLint 退出码 0。

Run: `pnpm build`

Expected: Next.js 16.3.4 build 成功，两个页面和全部 Route Handlers 编译通过。

Run: `pnpm test:e2e`

Expected: 桌面全流程和移动端布局通过，仅按 project 条件跳过的用例显示 skipped。

- [ ] **Step 6: 本地真实 LLM 冒烟测试**

使用 `env/.env.local` 已配置的模型，从纲要页生成并审核一个短篇大纲，再进入正文页生成和审核正文。确认终端只记录路由状态和耗时，不打印请求头、API Key、完整资料或完整模型响应；超时或失败时当前草稿和历史版本不变化。
