# Unified Content Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将资料、大纲、正文和配图整合到一个按步骤切换的文章工作台，并让正文生成真正调用已选择的 LLM。

**Architecture:** 保留现有大纲审核、版本和图片资产 API；新增基于 `OpenAiJsonClient` 的正文生成器，输入已确认大纲并只输出正文 blocks。`ArticleWorkspace` 成为统一工作流容器，使用 `?step=` 管理当前步骤，`WorkflowStepper` 负责导航和锁定状态。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, SQLite, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-content-workflow-design.md`

## Global Constraints

- 正文生成不得覆盖或重新生成已确认大纲。
- 所有写操作必须携带 `expectedUpdatedAt` 并保留冲突处理。
- API Key 只能在服务端使用；浏览器只接收公开模型配置。
- 无 LLM 配置时保留显式演示 fallback。
- 使用项目现有 Next.js 16 约定和 `node_modules/next/dist/docs/` 指南。
- 每个行为变化先写失败测试，再实现最小代码并运行测试。

### Task 1: Define Article Generation Contract

**Files:**
- Modify: `src/features/generation/content-generator.ts`
- Create: `src/features/generation/schemas.ts`
- Create: `src/features/generation/openai-content-generator.ts`
- Test: `src/features/generation/openai-content-generator.test.ts`

**Interfaces:**
- Consumes: `Article` topic, `KnowledgeBrief`, confirmed `OutlineSection[]`, optional source context, selected model.
- Produces: `GeneratedArticleContent { title, blocks }` and a `ContentGenerator` implementation that calls `OpenAiJsonClient.complete`.

- [ ] **Step 1: Write failing schema and generator tests**

  Cover canonical JSON output `{ title, blocks }`, block ordering/version fields, confirmed outline context in the user payload, selected model forwarding, and rejection of invalid block types or missing content.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run `node_modules/.bin/vitest.cmd run src/features/generation/openai-content-generator.test.ts`.

- [ ] **Step 3: Implement the JSON schema, prompt, and generator**

  Use the existing block domain types. The prompt must state that the model receives an already confirmed outline and must generate paragraphs/headings/callouts only for those sections; it must not invent new sections or images.

- [ ] **Step 4: Run focused tests and verify they pass**

  Run the same Vitest command and confirm all assertions pass.

### Task 2: Wire Real LLM Generation Into the API

**Files:**
- Modify: `src/features/generation/generate-foundation.ts`
- Modify: `src/app/api/articles/[id]/generate/route.ts`
- Modify: `src/server/services.ts`
- Modify: `src/features/generation/demo-generator.ts`
- Test: `src/features/generation/generate-foundation.test.ts`
- Test: `src/app/api/articles/[id]/generate/route.test.ts`
- Test: `src/server/services.test.ts`

**Interfaces:**
- Consumes: Task 1 generator and article/source repositories.
- Produces: `POST /api/articles/[id]/generate` accepting `{ expectedUpdatedAt, model? }`, rejecting unconfirmed outlines, and using the OpenAI generator when LLM is configured.

- [ ] **Step 1: Add failing workflow and route tests**

  Assert that the generator receives the saved brief, outline, length preset, source context, and selected model; an unconfirmed outline returns a client error; a configured LLM selects `OpenAiContentGenerator`; and no-key configuration uses the demo generator.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run `node_modules/.bin/vitest.cmd run src/features/generation/generate-foundation.test.ts src/app/api/articles/[id]/generate/route.test.ts src/server/services.test.ts`.

- [ ] **Step 3: Implement the workflow contract and service selection**

  Change the generation command to read the article brief and confirmed outline, pass them to the generator, preserve the outline in the saved article, and allow the optional model through request validation.

- [ ] **Step 4: Run focused tests and verify they pass**

  Re-run the focused Vitest command.

### Task 3: Add Workflow Stepper and Step State

**Files:**
- Create: `src/components/workflow-stepper.tsx`
- Test: `src/components/workflow-stepper.test.tsx`
- Create or modify: `src/app/articles/[id]/workflow.ts`
- Test: `src/app/articles/[id]/workflow.test.ts`

**Interfaces:**
- Consumes: `Article`, image asset count, and active step query value.
- Produces: typed steps (`sources`, `outline`, `article`, `images`), completion/locked status, and URL-safe active-step parsing.

- [ ] **Step 1: Write failing step-state and component tests**

  Cover draft, outline-ready, article-ready, and image-ready articles; assert locked steps expose a reason and completed steps are selectable.

- [ ] **Step 2: Run focused tests and verify they fail**

  Run `node_modules/.bin/vitest.cmd run src/components/workflow-stepper.test.tsx src/app/articles/[id]/workflow.test.ts`.

- [ ] **Step 3: Implement the pure step-state helper and stepper UI**

  Use accessible buttons/links, visible labels, current/completed/locked states, and no navigation side effects beyond the provided callback.

- [ ] **Step 4: Run focused tests and verify they pass**

  Re-run the focused Vitest command.

### Task 4: Refactor Article Workspace Into the Four-Step Workflow

**Files:**
- Modify: `src/app/articles/[id]/page.tsx`
- Modify: `src/app/articles/[id]/article-workspace.tsx`
- Modify: `src/app/articles/[id]/outline/page.tsx`
- Modify: `src/app/articles/new/new-article-form.tsx`
- Modify: `src/components/generation-panel.tsx`
- Modify: `src/app/globals.css`
- Test: `src/app/articles/[id]/article-workspace.test.tsx`
- Test: `src/app/articles/new/new-article-form.test.tsx`

**Interfaces:**
- Consumes: Task 2 generation API and Task 3 step state/stepper.
- Produces: one article workspace whose active panel changes by `?step=sources|outline|article|images`; old outline URL remains compatible.

- [ ] **Step 1: Add failing workspace interaction tests**

  Assert the top progress bar renders, locked article/images steps do not invoke generation, the article step invokes `/generate` with the selected model after outline confirmation, and the images step invokes the existing image-plan operation.

- [ ] **Step 2: Run focused workspace tests and verify they fail**

  Run `node_modules/.bin/vitest.cmd run src/app/articles/[id]/article-workspace.test.tsx src/app/articles/new/new-article-form.test.tsx`.

- [ ] **Step 3: Implement the unified workspace**

  Move reusable outline controls into an embeddable panel or adapter, add active-step URL synchronization, add the model selector to article generation, and replace the old demo-only GenerationPanel branching with explicit article and image step panels.

- [ ] **Step 4: Implement responsive visual hierarchy**

  Add a full-width progress band, a single primary operation area, clear locked/completed states, and mobile horizontal step navigation. Preserve existing neutral palette and accessible focus states.

- [ ] **Step 5: Run focused workspace tests and verify they pass**

  Re-run the focused Vitest command.

### Task 5: End-to-End Workflow Verification

**Files:**
- Modify: `tests/e2e/article-workflow.spec.ts` or the existing matching E2E file.
- Modify: `README.md` only if the workflow commands or route behavior change.

- [ ] **Step 1: Add an E2E scenario for step navigation and generation boundaries**

  Create an article, verify the stepper, generate/confirm the outline, assert the article step is unlocked, invoke article generation, and verify the images step appears without silently generating images.

- [ ] **Step 2: Run the E2E scenario**

  Run `npm run test:e2e` and fix only workflow-related failures.

- [ ] **Step 3: Run final verification**

  Run `node_modules/.bin/vitest.cmd run`, `node_modules/.bin/eslint.cmd .`, `node_modules/.bin/tsc.cmd --noEmit`, `node_modules/.bin/next.cmd build`, and `npm run test:e2e` sequentially so `.next/types` generation cannot race TypeScript.

- [ ] **Step 4: Review the final diff and report the runtime URL and workflow behavior**

  Confirm no API keys enter client bundles, no demo generation runs when LLM configuration is active, and the final response includes the exact run command and verification results.
