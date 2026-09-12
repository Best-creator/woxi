# 阶段 2：知识与大纲闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有文章工作台中加入资料来源管理、可编辑 Knowledge Brief 和大纲确认流程，并让演示生成器读取已启用的文本资料。

**Architecture:** 继续使用 Next.js 模块化单体和 Node 内置 SQLite。资料通过独立 `SourceRepository` 与 `SourceParser` 边界接入，文章 Brief、大纲和确认状态仍由现有文章仓储以一次乐观锁保存；页面组件只调用业务 API，不直接读取数据库或解析文件。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、Zod、Node `node:sqlite`、原生 CSS、Vitest、Testing Library、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-09-stage-2-knowledge-outline-design.md`

## Global Constraints

- 单人、本地 SQLite、无需真实模型密钥。
- 资料第一版支持 TXT 和 Markdown 文本录入。
- 网页、PDF、DOCX 保存为 `unsupported`，本轮不引入解析器或网络抓取依赖。
- 文章继续以结构化 `ContentBlock[]` 保存，所有文章保存沿用 `updated_at` 乐观锁。
- 移动端只读，不提供资料、Brief 或大纲编辑控件。
- 所有用户可见界面使用中文；代码标识符和路径使用英文。
- 每项行为先写失败测试，确认失败后再写最小实现。

---

### Task 1: Source Domain, Migration and Repository

**Files:**
- Create: `src/features/sources/domain.ts`
- Create: `src/features/sources/repository.ts`
- Create: `src/features/sources/sqlite-repository.ts`
- Create: `src/features/sources/sqlite-repository.test.ts`
- Modify: `src/server/db.ts`
- Modify: `src/features/articles/domain.ts`
- Modify: `src/features/articles/sqlite-repository.ts`
- Test helpers: `tests/helpers/test-db.ts`

**Interfaces:**
- `SourceType = "text" | "markdown" | "web" | "pdf" | "docx"`
- `SourceStatus = "ready" | "pending" | "unsupported" | "failed"`
- `SourceDocument { id, articleId, title, type, content, status, enabled, createdAt, updatedAt }`
- `SourceRepository.list(articleId)`, `create(input)`, `updateEnabled(articleId, sourceId, enabled)`, `remove(articleId, sourceId)`
- `Article` gains `outlineConfirmedAt: string | null`.

- [ ] **Step 1: Write failing repository tests**

Add tests that create two articles and assert sources are isolated, TXT/Markdown sources round-trip with `ready`, unsupported types round-trip with `unsupported`, enabled state changes, and deleting one source leaves the other.

- [ ] **Step 2: Run the source repository tests and verify the expected failure**

Run: `pnpm test -- src/features/sources/sqlite-repository.test.ts`

Expected: FAIL because source domain, table and repository do not exist.

- [ ] **Step 3: Implement domain types and migration**

Extend `articles` with `outline_confirmed_at TEXT` using an idempotent migration, and create:

```sql
CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS source_documents_article_idx
  ON source_documents(article_id, updated_at DESC);
```

Use the existing timestamp and JSON serialization patterns. `create` sets `ready` for `text`/`markdown`, `unsupported` otherwise.

- [ ] **Step 4: Run repository tests and all existing tests**

Run: `pnpm test -- src/features/sources src/features/articles`

Expected: source and article repository tests pass without changing existing article behavior.

- [ ] **Step 5: Commit the persistence boundary**

Run: `git add src/features/sources src/features/articles src/server/db.ts tests/helpers/test-db.ts; git commit -m "feat: add article source repository"`.

If the host again rejects `.git/index.lock`, leave files uncommitted and record the limitation.

### Task 2: Source Parser and Source APIs

**Files:**
- Create: `src/features/sources/source-parser.ts`
- Create: `src/features/sources/source-parser.test.ts`
- Create: `src/app/api/articles/[id]/sources/route.ts`
- Create: `src/app/api/articles/[id]/sources/[sourceId]/route.ts`
- Create: `src/app/api/articles/[id]/sources/route.test.ts`
- Modify: `src/server/services.ts`
- Modify: `src/features/articles/schemas.ts`

**Interfaces:**
- `parseSource(input: { type: SourceType; content: string }): { status: SourceStatus; content: string }`
- `GET /api/articles/:id/sources`
- `POST /api/articles/:id/sources` with `{ title, type, content }`
- `PATCH /api/articles/:id/sources/:sourceId` with `{ enabled }`
- `DELETE /api/articles/:id/sources/:sourceId`

- [ ] **Step 1: Write failing parser and route tests**

Cover trimming blank title/content as 400, text and Markdown as ready, web/PDF/DOCX as unsupported, cross-article source access as 404, and successful list/create/toggle/delete responses.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test -- src/features/sources/source-parser.test.ts 'src/app/api/articles/[id]/sources/route.test.ts'`

Expected: FAIL because parser and handlers do not exist.

- [ ] **Step 3: Implement parser and handlers**

Keep parsing deterministic: trim text and return it unchanged for `text`/`markdown`; return the original content with `unsupported` for other types. Route handlers must verify the article exists before accessing sources and return `{ sources }`, `{ source }`, `{ error }` with status 200/201/400/404.

- [ ] **Step 4: Run source and API tests**

Run: `pnpm test -- src/features/sources src/app/api/articles`

Expected: all source parser, source API, article API and generation API tests pass.

- [ ] **Step 5: Commit the source API**

Run: `git add src/features/sources src/app/api/articles/[id]/sources src/server/services.ts src/features/articles/schemas.ts; git commit -m "feat: expose source management api"`.

### Task 3: Knowledge Brief Editor and Outline Controls

**Files:**
- Create: `src/components/knowledge-brief-editor.tsx`
- Create: `src/components/knowledge-brief-editor.test.tsx`
- Modify: `src/components/outline-nav.tsx`
- Modify: `src/components/outline-nav.test.tsx` (create if absent)
- Modify: `src/app/globals.css`

**Interfaces:**
- `KnowledgeBriefEditorProps { brief: KnowledgeBrief | null; readOnly?: boolean; onChange: (brief: KnowledgeBrief) => void }`
- `OutlineNavProps { sections: OutlineSection[]; confirmed?: boolean; readOnly?: boolean; onChange?: (sections: OutlineSection[]) => void; onConfirm?: () => void }`

- [ ] **Step 1: Write failing component tests**

Assert each Brief field renders in Chinese, editing one scalar or array line calls `onChange` without mutating other fields, outline move up/down preserves order, delete removes only the selected section, and confirmation invokes `onConfirm`.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test -- src/components/knowledge-brief-editor.test.tsx src/components/outline-nav.test.tsx`

Expected: FAIL because the Brief editor and enhanced controls do not exist.

- [ ] **Step 3: Implement controlled components**

Use text inputs for `oneSentence`, textareas with one item per line for arrays, and buttons with Lucide icons plus Chinese labels/tooltips for outline actions. In read-only mode render plain text and hide edit controls.

- [ ] **Step 4: Run component tests**

Run: `pnpm test -- src/components/knowledge-brief-editor.test.tsx src/components/outline-nav.test.tsx src/components/block-editor.test.tsx`

Expected: all component tests pass.

- [ ] **Step 5: Commit the editor controls**

Run: `git add src/components/knowledge-brief-editor.tsx src/components/outline-nav.tsx src/app/globals.css; git commit -m "feat: add brief and outline editing controls"`.

### Task 4: Workspace and Creation Flow Integration

**Files:**
- Create: `src/components/source-panel.tsx`
- Create: `src/components/source-panel.test.tsx`
- Modify: `src/app/articles/new/new-article-form.tsx`
- Modify: `src/app/articles/[id]/article-workspace.tsx`
- Modify: `src/app/articles/[id]/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- `SourcePanelProps { articleId: string; sources: SourceDocument[]; readOnly?: boolean; onChange: (sources: SourceDocument[]) => void }`
- Workspace fetches sources on mount and uses existing `saveArticle(article, expectedUpdatedAt)` for Brief, outline and `outlineConfirmedAt` changes.

- [ ] **Step 1: Write failing source panel and workspace tests**

Cover adding Markdown text, toggling enabled, deleting a source, editing Brief, moving an outline section, confirming an outline, and preserving local state after a 409 save. Add an E2E assertion that the new article form can submit a Markdown source.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test -- src/components/source-panel.test.tsx 'src/app/articles/[id]/article-workspace.test.tsx'`

Expected: FAIL because the panel and workspace integration do not exist.

- [ ] **Step 3: Implement source panel and workspace state**

Keep source mutations behind the source API; keep article mutations behind the existing autosave and conflict handling. Set `outlineConfirmedAt` on confirmation, reset it to `null` after any outline edit, and use `outline_ready` status while confirmed. Below 720px render read-only summaries.

- [ ] **Step 4: Run component and API tests**

Run: `pnpm test -- src/components src/app/articles src/app/api/articles`

Expected: all existing and new tests pass.

- [ ] **Step 5: Commit the integrated workspace**

Run: `git add src/components/source-panel.tsx src/app/articles src/app/globals.css; git commit -m "feat: integrate sources brief and outline workflow"`.

### Task 5: Generation Context, E2E Flow and Documentation

**Files:**
- Modify: `src/features/generation/content-generator.ts`
- Modify: `src/features/generation/demo-generator.ts`
- Modify: `src/features/generation/generate-foundation.ts`
- Modify: `src/app/api/articles/[id]/generate/route.ts`
- Modify: `src/features/generation/*.test.ts`
- Modify: `tests/e2e/foundation-flow.spec.ts`
- Modify: `README.md`

**Interfaces:**
- `ContentGenerator.generateFoundation(input: { topic: string; sourceContext?: string }): Promise<GeneratedFoundation>`
- `generateFoundation(articleId, expectedUpdatedAt, repository, generator, sourceRepository)` reads enabled `ready` sources and passes a bounded concatenated context.

- [ ] **Step 1: Write failing generation and E2E tests**

Assert the demo generator includes a source excerpt in the brief when provided, ignores disabled/unsupported sources, and the E2E flow can add Markdown context, edit/confirm the outline, generate, and preview.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test -- src/features/generation tests/e2e/foundation-flow.spec.ts`

Expected: FAIL because the generator signature and E2E controls do not support source context.

- [ ] **Step 3: Implement bounded source context**

Concatenate at most 8,000 characters from enabled `ready` sources in updated-time order, prefixing each excerpt with its escaped title. Preserve existing deterministic output when no source context is provided.

- [ ] **Step 4: Run complete verification**

Run:

```powershell
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
```

Expected: all unit/component tests pass, lint and build exit 0, and the updated E2E flow passes.

- [ ] **Step 5: Document stage 2 boundaries**

Update README with source management, supported formats, unsupported status behavior, outline confirmation, and the explicit non-goals for web/PDF/DOCX parsing and real models.

- [ ] **Step 6: Commit the generation and documentation changes**

Run: `git add src tests README.md docs/superpowers; git commit -m "feat: complete knowledge and outline workflow"`.

## Plan Self-Review

- Coverage: Tasks 1-2 cover source data, parsing and APIs; Task 3 covers Brief and outline controls; Task 4 covers page integration and mobile read-only behavior; Task 5 covers generation context, E2E and documentation.
- Placeholder scan: every implementation step has concrete files, interfaces, commands and expected behavior; unsupported formats have explicit status and behavior.
- Type consistency: `SourceDocument`, `SourceRepository`, `SourceParser`, `KnowledgeBriefEditorProps` and `OutlineNavProps` are defined before consumers; generation context is optional for backward compatibility.
