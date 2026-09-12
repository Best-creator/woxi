# 纲要生成、审核与版本历史 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立独立纲要工作台，使用可选 LLM 模型生成 Knowledge Brief 和带推荐字数的大纲，经独立审核后确认，并保留可恢复的大纲版本。

**Architecture:** 使用共享的 OpenAI 兼容 JSON 客户端隔离模型调用，用 Zod 校验所有模型响应。当前文章继续保存可自动保存的工作草稿，不可变 `article_revisions` 保存版本快照，`article_reviews` 将审核绑定到具体版本和内容哈希；Next.js Route Handlers 只处理输入校验和结果映射。

**Tech Stack:** Next.js 16.3.4 App Router、React 19、TypeScript 5.9、Node.js 26 `node:sqlite`、Zod 4、Vitest、Testing Library、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-10-llm-content-generation-design.md`

## Global Constraints

- 纲要页面固定为 `/articles/{id}/outline`，正文工作台由后续计划完成。
- 长度档位必须为短篇 800-1200 字、标准 1000-1500 字、深度 1500-2000 字。
- 大纲 Agent 返回全文推荐字数和每章推荐字数；推荐字数用于避免冗长，不用于凑字。
- 大纲审核必须是独立 LLM 调用，状态只能为 `passed`、`needs_revision` 或 `blocked`。
- `blocked` 不允许确认；`needs_revision` 只有显式忽略警告后才能确认。
- 自动保存不创建版本；生成、审核前内容变化、确认和主动保存可创建去重后的不可变版本。
- 恢复旧版本必须创建新版本并保留所有历史。
- 未提供资料时允许生成，并在 `unsupportedNotes` 标记需要人工核验；本阶段不接外部检索。
- 密钥只从 `env/.env.local` 在服务端读取，禁止进入客户端 bundle、响应或日志。
- LLM 请求地址固定为 `{LLM_BASE_URL}/v1/chat/completions`，不得改为根路径 POST。
- 所有写请求继续携带 `expectedUpdatedAt` 并使用乐观并发控制。
- Route Handler 使用 Node.js runtime 和 Next.js 16 的异步 `context.params`。
- 实现前阅读 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`、`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`、`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md` 和 `node_modules/next/dist/docs/01-app/02-guides/redirecting.md`。
- 当前仓库没有有效 `HEAD` 且 `.git` 不可写；不要尝试提交。每个任务以目标测试通过作为检查点。

---

### Task 1: LLM 模型目录与公开配置

**Files:**
- Modify: `src/server/config.ts`
- Modify: `src/server/config.test.ts`
- Modify: `env/.env.example`
- Modify: `src/server/services.test.ts`

**Interfaces:**
- Produces: `LlmProviderConfig extends ProviderConfig`，包含 `availableModels: string[]`
- Produces: `PublicLlmConfig = { enabled: boolean; availableModels: string[]; defaultModel: string | null }`
- Produces: `toPublicLlmConfig(config: ServerConfig): PublicLlmConfig`
- Produces: `getPublicLlmConfig(): PublicLlmConfig`

- [ ] **Step 1: 写模型列表解析的失败测试**

```ts
it("deduplicates the model allowlist and keeps the default model", () => {
  const config = parseServerConfig({
    LLM_BASE_URL: "https://llm.example.test",
    LLM_API_KEY: "secret",
    LLM_MODEL: "grok-4.6",
    LLM_MODELS: "grok-4.6, writer-large, writer-large"
  });
  expect(config.llm).toMatchObject({
    model: "grok-4.6",
    availableModels: ["grok-4.6", "writer-large"]
  });
});

it("adds the default model when the allowlist omits it", () => {
  const config = parseServerConfig({
    LLM_API_KEY: "secret",
    LLM_MODEL: "grok-4.6",
    LLM_MODELS: "writer-large"
  });
  expect(config.llm?.availableModels).toEqual(["grok-4.6", "writer-large"]);
});
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `pnpm vitest run src/server/config.test.ts src/server/services.test.ts`

Expected: FAIL，`availableModels` 或 `getPublicLlmConfig` 尚不存在。

- [ ] **Step 3: 实现模型目录和公开配置**

```ts
export interface LlmProviderConfig extends ProviderConfig {
  availableModels: string[];
}

export interface PublicLlmConfig {
  enabled: boolean;
  availableModels: string[];
  defaultModel: string | null;
}

function parseModels(defaultModel: string, configured: string) {
  return [...new Set([defaultModel, ...configured.split(",")]
    .map((model) => model.trim())
    .filter(Boolean))];
}

export function getPublicLlmConfig(): PublicLlmConfig {
  return toPublicLlmConfig(getServerConfig());
}

export function toPublicLlmConfig(config: ServerConfig): PublicLlmConfig {
  const llm = config.llm;
  return llm
    ? { enabled: true, availableModels: llm.availableModels, defaultModel: llm.model }
    : { enabled: false, availableModels: [], defaultModel: null };
}
```

为 `envSchema` 增加 `LLM_MODELS: z.string().default("")`，只给 LLM Provider 添加模型列表，不改变图片 Provider 的接口。

- [ ] **Step 4: 更新环境示例**

```dotenv
LLM_BASE_URL=https://yelan.xiaobupao.cn
LLM_API_KEY=
LLM_MODEL=
LLM_MODELS=
```

- [ ] **Step 5: 验证配置测试**

Run: `pnpm vitest run src/server/config.test.ts src/server/services.test.ts`

Expected: PASS，且测试断言公开配置中不存在 `apiKey` 和 `baseUrl`。

---

### Task 2: 共享 OpenAI JSON 客户端

**Files:**
- Create: `src/features/llm/errors.ts`
- Create: `src/features/llm/openai-json-client.ts`
- Create: `src/features/llm/openai-json-client.test.ts`

**Interfaces:**
- Produces: `LlmError`，code 为 `timeout | authentication | invalid_response | upstream | model_not_allowed`
- Produces: `OpenAiJsonClient.complete<T>(request: JsonCompletionRequest<T>): Promise<T>`
- Consumes: `LlmProviderConfig` from Task 1

- [ ] **Step 1: 写请求协议与失败路径测试**

```ts
const schema = z.object({ ok: z.literal(true) });
const fetchFn = vi.fn(async () => Response.json({
  choices: [{ message: { content: JSON.stringify({ ok: true }) } }]
}));
const client = new OpenAiJsonClient(config, fetchFn);

await expect(client.complete({
  model: "grok-4.6",
  systemPrompt: "只返回 JSON",
  userPayload: { topic: "机会成本" },
  schema,
  timeoutMs: 60_000
})).resolves.toEqual({ ok: true });

expect(fetchFn).toHaveBeenCalledWith(
  "https://llm.example.test/v1/chat/completions",
  expect.objectContaining({ method: "POST" })
);
```

分别测试白名单外模型、401、非 JSON content、schema 不匹配和 `AbortError`。

- [ ] **Step 2: 运行测试并确认红灯**

Run: `pnpm vitest run src/features/llm/openai-json-client.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现错误类型和客户端**

```ts
export interface JsonCompletionRequest<T> {
  model?: string;
  systemPrompt: string;
  userPayload: unknown;
  schema: z.ZodType<T>;
  timeoutMs: number;
}

export class OpenAiJsonClient {
  constructor(
    private readonly config: LlmProviderConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async complete<T>(request: JsonCompletionRequest<T>): Promise<T> {
    const model = request.model ?? this.config.model;
    if (!this.config.availableModels.includes(model)) {
      throw new LlmError("model_not_allowed", "所选模型不可用");
    }
    const response = await this.fetchFn(
      `${this.config.baseUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          stream: false,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: JSON.stringify(request.userPayload) }
          ]
        }),
        signal: AbortSignal.timeout(request.timeoutMs)
      }
    );
    return parseCompletionResponse(response, request.schema);
  }
}
```

`complete` 必须用 `try/catch` 包住 `fetch`，将 `AbortError` 和 `TimeoutError` 映射为 `timeout`，其他网络异常映射为 `upstream`。`parseCompletionResponse` 必须把 401/403 映射为 `authentication`，其他非 2xx 映射为 `upstream`，并把响应 JSON、`choices[0].message.content`、JSON 字符串和 Zod 结果逐层校验。

- [ ] **Step 4: 验证客户端测试**

Run: `pnpm vitest run src/features/llm/openai-json-client.test.ts`

Expected: PASS，根 URL 断言确保不会误调用 `POST /`。

---

### Task 3: 文章规划领域模型与持久化兼容

**Files:**
- Modify: `src/features/articles/domain.ts`
- Modify: `src/features/articles/schemas.ts`
- Modify: `src/features/articles/sqlite-repository.ts`
- Modify: `src/features/articles/sqlite-repository.test.ts`
- Modify: `src/features/images/sqlite-repository.ts`
- Modify: `src/features/images/sqlite-repository.test.ts`
- Modify: `src/server/db.ts`
- Modify: `tests/fixtures/article.ts`

**Interfaces:**
- Produces: `LengthPreset = "short" | "standard" | "deep"`
- Produces: `LENGTH_RANGES`
- Extends: `OutlineSection` with optional `goal` and `recommendedWords`
- Extends: `Article` with `planning: ArticlePlanning`

- [ ] **Step 1: 写规划字段往返 SQLite 的失败测试**

```ts
const article = await repository.create({ topic: "机会成本" });
const saved = await repository.save({
  ...article,
  outline: [{
    id: "section-1",
    title: "先说选择",
    goal: "从生活选择建立直觉",
    recommendedWords: 280,
    order: 0
  }],
  planning: {
    lengthPreset: "standard",
    recommendedTotalWords: 1200,
    confirmedOutlineRevisionId: null,
    contentOutlineRevisionId: null
  }
}, article.updatedAt);

expect(saved).toMatchObject({
  kind: "saved",
  article: { planning: { recommendedTotalWords: 1200 } }
});
```

- [ ] **Step 2: 运行领域与仓储测试并确认红灯**

Run: `pnpm vitest run src/features/articles/sqlite-repository.test.ts src/app/api/articles/[id]/route.test.ts`

Expected: FAIL，`planning` 和新大纲字段尚未定义或持久化。

- [ ] **Step 3: 扩展类型和 schema**

```ts
export type LengthPreset = "short" | "standard" | "deep";

export const LENGTH_RANGES = {
  short: { min: 800, max: 1200 },
  standard: { min: 1000, max: 1500 },
  deep: { min: 1500, max: 2000 }
} as const;

export interface ArticlePlanning {
  lengthPreset: LengthPreset;
  recommendedTotalWords: number | null;
  confirmedOutlineRevisionId: string | null;
  contentOutlineRevisionId: string | null;
}
```

新文章默认 `lengthPreset: "standard"`，其他规划字段为 `null`。`goal` 限 500 字，`recommendedWords` 为 50-2000 的整数。

- [ ] **Step 4: 增加幂等迁移和仓储映射**

在 `articles` 表新增可空 `planning_json TEXT`。迁移必须先通过 `PRAGMA table_info(articles)` 检查列是否存在，再执行 `ALTER TABLE articles ADD COLUMN planning_json TEXT`，保证已有数据库重复启动安全。旧行读取到 `null` 时使用标准档位默认值；新建和保存文章时始终写入完整 JSON。同步更新图片仓储内部的 `ArticleRow` 和文章快照解析，否则图片事务返回的 Article 会缺少 `planning`。

```ts
const defaultPlanning: ArticlePlanning = {
  lengthPreset: "standard",
  recommendedTotalWords: null,
  confirmedOutlineRevisionId: null,
  contentOutlineRevisionId: null
};
```

- [ ] **Step 5: 验证兼容性**

Run: `pnpm vitest run src/features/articles/sqlite-repository.test.ts src/app/api/articles/[id]/route.test.ts src/features/images/sqlite-repository.test.ts`

Expected: PASS，旧测试 fixture 自动获得默认 `planning`，图片事务仓储仍可解析文章。

---

### Task 4: 不可变修订与审核仓储

**Files:**
- Create: `src/features/revisions/domain.ts`
- Create: `src/features/revisions/content-hash.ts`
- Create: `src/features/revisions/repository.ts`
- Create: `src/features/revisions/sqlite-store.ts`
- Create: `src/features/revisions/sqlite-repository.ts`
- Create: `src/features/revisions/sqlite-repository.test.ts`
- Modify: `src/server/db.ts`
- Modify: `src/server/services.ts`

**Interfaces:**
- Produces: `RevisionScope = "outline" | "content"`
- Produces: `ArticleRevision<TSnapshot>` and `ArticleReview<TResult>`
- Produces: `RevisionRepository.createIfChanged(input): Promise<{ revision; created }>`
- Produces: `list(articleId, scope)`, `findById`, `saveReview`, `latestReview`
- Produces: `hashSnapshot(snapshot): string`
- Produces: `createRevisionIfChangedInTransaction(db, input)` 供阶段工作流复用

- [ ] **Step 1: 写去重、独立编号、审核绑定和恢复所需查询测试**

```ts
const first = await revisions.createIfChanged({
  articleId: article.id,
  scope: "outline",
  snapshot,
  model: "grok-4.6",
  reason: "generated"
});
const duplicate = await revisions.createIfChanged({
  articleId: article.id,
  scope: "outline",
  snapshot,
  model: "grok-4.6",
  reason: "review_checkpoint"
});

expect(first).toMatchObject({ created: true, revision: { version: 1 } });
expect(duplicate).toMatchObject({ created: false, revision: { version: 1 } });
```

另写测试证明正文 v1 不影响大纲下一版编号、同一修订可保存多次审核且 `latestReview` 返回最新记录、删除文章会级联删除历史。

- [ ] **Step 2: 运行仓储测试并确认红灯**

Run: `pnpm vitest run src/features/revisions/sqlite-repository.test.ts`

Expected: FAIL，修订模块和数据表尚不存在。

- [ ] **Step 3: 定义快照和仓储接口**

```ts
export interface OutlineRevisionSnapshot {
  title: string;
  brief: KnowledgeBrief;
  outline: OutlineSection[];
  lengthPreset: LengthPreset;
  recommendedTotalWords: number;
  sourceContextSnapshot: string;
}

export interface CreateRevisionInput<TSnapshot> {
  articleId: string;
  scope: RevisionScope;
  snapshot: TSnapshot;
  model: string | null;
  reason: "generated" | "review_checkpoint" | "confirmed" | "manual" | "restored";
}
```

规范化哈希必须递归按对象 key 排序，保留数组顺序，再对 JSON 字符串计算 SHA-256。

- [ ] **Step 4: 创建迁移和 SQLite 实现**

```sql
CREATE TABLE IF NOT EXISTS article_revisions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('outline', 'content')),
  version_number INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  model TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  UNIQUE(article_id, scope, version_number)
);

CREATE TABLE IF NOT EXISTS article_reviews (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (revision_id) REFERENCES article_revisions(id) ON DELETE CASCADE
);
```

`sqlite-store.ts` 提供不自行开启事务的 `createRevisionIfChangedInTransaction(db, input)`，负责读取该 scope 最新修订、比较哈希并分配下一个版本号。`SqliteRevisionRepository.createIfChanged` 在自己的 `BEGIN IMMEDIATE` 中调用该函数；Outline/Content 工作流仓储在其已有事务中直接调用同一个函数，禁止嵌套事务。并发唯一键冲突必须转成可重试的仓储冲突结果，不能覆盖现有行。

- [ ] **Step 5: 验证修订仓储**

Run: `pnpm vitest run src/features/revisions/sqlite-repository.test.ts src/server/config.test.ts`

Expected: PASS，重复内容不增加版本号，审核稳定绑定修订 ID。

---

### Task 5: 大纲生成器与审核器

**Files:**
- Create: `src/features/outlines/domain.ts`
- Create: `src/features/outlines/schemas.ts`
- Create: `src/features/outlines/ports.ts`
- Create: `src/features/outlines/openai-outline-generator.ts`
- Create: `src/features/outlines/openai-outline-generator.test.ts`
- Create: `src/features/outlines/openai-outline-reviewer.ts`
- Create: `src/features/outlines/openai-outline-reviewer.test.ts`
- Create: `src/features/outlines/demo-outline-agents.ts`
- Create: `src/features/outlines/demo-outline-agents.test.ts`
- Modify: `src/server/services.ts`
- Modify: `src/server/services.test.ts`

**Interfaces:**
- Produces: `OutlineGenerator.generate(input): Promise<GeneratedOutline>`
- Produces: `OutlineReviewer.review(input): Promise<OutlineReviewResult>`
- Consumes: `OpenAiJsonClient` from Task 2
- Consumes: length and article types from Task 3

- [ ] **Step 1: 写结构化生成和审核测试**

```ts
const result = await generator.generate({
  topic: "机会成本",
  targetAudience: "对该知识点零基础的普通读者",
  lengthPreset: "short",
  wordRange: { min: 800, max: 1200 },
  sourceContext: "机会成本是放弃的最佳替代方案。",
  model: "grok-4.6"
});

expect(result.recommendedTotalWords).toBeGreaterThanOrEqual(800);
expect(result.recommendedTotalWords).toBeLessThanOrEqual(1200);
expect(result.outline.every((section) => section.recommendedWords >= 50)).toBe(true);
```

持久化后使用 `OutlineSection.id` 作为后续 Prompt 中的 `sectionKey`。审核测试必须覆盖 `sourceSupport: null`、不存在的 `sectionKey` 被拒绝、`blocked` 问题至少包含一个 `severity: "blocking"`。

- [ ] **Step 2: 运行 Agent 测试并确认红灯**

Run: `pnpm vitest run src/features/outlines/openai-outline-generator.test.ts src/features/outlines/openai-outline-reviewer.test.ts src/features/outlines/demo-outline-agents.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 定义严格 Zod schema**

```ts
export const generatedOutlineSchema = z.object({
  workingTitle: z.string().trim().min(1).max(120),
  recommendedTotalWords: z.number().int().min(800).max(2000),
  brief: knowledgeBriefSchema,
  outline: z.array(z.object({
    key: z.string().regex(/^[a-z0-9_-]+$/).max(64),
    title: z.string().trim().min(1).max(120),
    goal: z.string().trim().min(1).max(500),
    recommendedWords: z.number().int().min(50).max(2000)
  })).min(2).max(12)
});
```

解析后额外校验 key 唯一、全文推荐字数落在所选档位、各章字数总和与全文推荐值偏差不超过 15%。

- [ ] **Step 4: 实现生成和审核 Prompt**

生成 system prompt 必须明确：只返回 JSON；面向零基础普通读者；先建立直觉再引入术语；识别前置知识和误区；推荐足以讲清楚但不冗长的字数；无资料时在 `unsupportedNotes` 写明需核验；不得生成正文块。

审核 system prompt 必须明确：独立批评而非延续生成；按覆盖、粒度、零基础友好度、逻辑顺序、资料支持度打分；列出隐藏前置知识和复杂依赖；无资料时 `sourceSupport` 为 `null`；只引用输入中的 section key。

OpenAI 实现使用 `OpenAiJsonClient.complete`，生成和审核超时均为 90 秒。Demo 实现必须确定性地产生合法大纲和 `passed` 审核，供无 Key 的开发与 E2E 使用。

- [ ] **Step 5: 注册服务并验证**

`getOutlineGenerator()` 和 `getOutlineReviewer()` 在配置 LLM 时返回 OpenAI 实现，否则返回 Demo 实现；同一次服务实例复用共享 JSON 客户端。

Run: `pnpm vitest run src/features/outlines src/server/services.test.ts`

Expected: PASS，有 Key 和无 Key 两条选择路径均被覆盖。

---

### Task 6: 大纲用例与 Route Handlers

**Files:**
- Create: `src/features/outlines/generate-outline.ts`
- Create: `src/features/outlines/generate-outline.test.ts`
- Create: `src/features/outlines/review-outline.ts`
- Create: `src/features/outlines/review-outline.test.ts`
- Create: `src/features/outlines/confirm-outline.ts`
- Create: `src/features/outlines/confirm-outline.test.ts`
- Create: `src/features/outlines/restore-outline-version.ts`
- Create: `src/features/outlines/restore-outline-version.test.ts`
- Create: `src/features/outlines/workflow-repository.ts`
- Create: `src/features/outlines/sqlite-workflow-repository.ts`
- Create: `src/features/outlines/sqlite-workflow-repository.test.ts`
- Create: `src/app/api/articles/[id]/outline/generate/route.ts`
- Create: `src/app/api/articles/[id]/outline/generate/route.test.ts`
- Create: `src/app/api/articles/[id]/outline/review/route.ts`
- Create: `src/app/api/articles/[id]/outline/review/route.test.ts`
- Create: `src/app/api/articles/[id]/outline/confirm/route.ts`
- Create: `src/app/api/articles/[id]/outline/confirm/route.test.ts`
- Create: `src/app/api/articles/[id]/outline/versions/route.ts`
- Create: `src/app/api/articles/[id]/outline/versions/[versionId]/restore/route.ts`
- Create: `src/app/api/articles/[id]/outline/versions/route.test.ts`

**Interfaces:**
- Produces: generate、review、confirm、list 和 restore 的领域结果联合类型
- Produces: `OutlineWorkflowRepository`，负责文章与大纲修订的原子写入
- Consumes: article/source/revision repositories and outline agents

- [ ] **Step 1: 写生成用例和路由失败测试**

```ts
const result = await generateOutline({
  articleId: article.id,
  expectedUpdatedAt: article.updatedAt,
  model: "grok-4.6",
  lengthPreset: "short"
}, dependencies);

expect(result).toMatchObject({
  kind: "generated",
  article: {
    status: "brief_ready",
    planning: { lengthPreset: "short" }
  },
  revision: { version: 1 }
});
```

断言只有 enabled + ready 的资料进入 `sourceContext`，并继续截断到 8000 字；模型失败、schema 失败或保存冲突时不得创建修订。

- [ ] **Step 2: 写审核、确认和恢复失败测试**

覆盖：审核前草稿或当前启用资料变化时创建新版本；重复审核不重复版本；手工 POST 保存版本；`blocked` 返回确认拒绝；`needs_revision` 缺少 `acknowledgeWarnings` 时拒绝；恢复 v1 产生 v3 且 v2 保留；旧 `expectedUpdatedAt` 返回冲突。

- [ ] **Step 3: 运行目标测试并确认红灯**

Run: `pnpm vitest run src/features/outlines src/app/api/articles/[id]/outline`

Expected: FAIL，用例和路由尚不存在。

- [ ] **Step 4: 实现阶段工作流仓储、事务顺序和 HTTP 映射**

`SqliteOutlineWorkflowRepository` 与现有 article/revision repositories 共享同一个 `DatabaseSync`，并提供 `saveGeneratedOutline`、`checkpointOutline`、`confirmOutline` 和 `restoreOutline`。每个方法内部显式执行 `BEGIN IMMEDIATE`、全部 SQL 写入和 `COMMIT`，异常时 `ROLLBACK`；不要在已开启事务时等待网络调用。

生成顺序必须为：读取并校验文章版本 -> 读取资料 -> 调用 Agent -> 转换持久化 ID -> 调用 `saveGeneratedOutline` 原子保存文章和大纲修订。审核顺序为：读取当前草稿 -> 调用 `checkpointOutline` 原子创建或复用版本 -> 调用审核 Agent -> 保存审核记录。确认引用当前内容哈希对应的最新修订和最新审核。

路由 request schema：

```ts
const generateRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).optional(),
  lengthPreset: z.enum(["short", "standard", "deep"])
});

const confirmRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  acknowledgeWarnings: z.boolean().default(false)
});

const saveVersionRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime()
});
```

HTTP 映射统一为：输入错误 400，不存在 404，版本冲突 409，模型或审核上游失败 502，成功 200。

- [ ] **Step 5: 验证领域和路由测试**

Run: `pnpm vitest run src/features/outlines src/app/api/articles/[id]/outline`

Expected: PASS，所有错误路径不保存半成品。

---

### Task 7: 独立纲要工作台 UI

**Files:**
- Create: `src/app/articles/[id]/outline/page.tsx`
- Create: `src/app/articles/[id]/outline/outline-workspace.tsx`
- Create: `src/app/articles/[id]/outline/outline-workspace.test.tsx`
- Create: `src/components/model-select.tsx`
- Create: `src/components/model-select.test.tsx`
- Create: `src/components/length-preset-control.tsx`
- Create: `src/components/length-preset-control.test.tsx`
- Create: `src/components/outline-review-panel.tsx`
- Create: `src/components/outline-review-panel.test.tsx`
- Create: `src/components/version-history.tsx`
- Create: `src/components/version-history.test.tsx`
- Modify: `src/components/outline-nav.tsx`
- Modify: `src/components/outline-nav.test.tsx`
- Modify: `src/app/articles/new/new-article-form.tsx`
- Modify: `src/app/articles/new/new-article-form.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: public model config, outline APIs and revision summaries
- Produces: accessible outline generation/review/version UI

- [ ] **Step 1: 写控件和工作台交互失败测试**

```tsx
render(<OutlineWorkspace
  initialArticle={articleFixture()}
  initialSources={[]}
  initialVersions={[]}
  initialReview={null}
  llmConfig={{
    enabled: true,
    availableModels: ["grok-4.6", "writer-large"],
    defaultModel: "grok-4.6"
  }}
  generateOutline={generateOutline}
/>);

await user.selectOptions(screen.getByLabelText("生成模型"), "writer-large");
await user.click(screen.getByRole("button", { name: "生成理解与大纲" }));
expect(generateOutline).toHaveBeenCalledWith(expect.objectContaining({
  model: "writer-large",
  lengthPreset: "standard"
}));
```

增加审核状态、阻断确认、显式忽略警告、编辑或改变启用资料后显示“审核已过期”、主动保存版本、恢复版本和生成中禁用控件测试。

- [ ] **Step 2: 运行 UI 测试并确认红灯**

Run: `pnpm vitest run src/components/model-select.test.tsx src/components/length-preset-control.test.tsx src/components/outline-review-panel.test.tsx src/components/version-history.test.tsx src/app/articles/[id]/outline/outline-workspace.test.tsx`

Expected: FAIL，组件和页面尚不存在。

- [ ] **Step 3: 实现页面服务端数据装配**

`page.tsx` 并行读取文章、资料、大纲版本、当前版本最新审核和 `getPublicLlmConfig()`。文章不存在调用 `notFound()`。不要把私密 Provider config 传入 Client Component。

- [ ] **Step 4: 实现工作台和响应式布局**

桌面布局使用左侧资料、中央 Brief/大纲、右侧生成与审核控制；移动端按资料、生成设置、Brief、大纲、审核、版本历史顺序单列。模型使用 `<select>`，长度使用三段 segmented control，命令使用带 Lucide 图标的按钮。

`OutlineNav` 增加 `goal` 和 `recommendedWords` 编辑；确认按钮从组件内部移到工作台审核门禁区。新建文章成功后导航到 `/articles/{id}/outline`。本计划确认成功后留在纲要页并显示确认状态；跳转正文页由后续正文计划在目标页面存在后接通。

- [ ] **Step 5: 验证 UI 测试**

Run: `pnpm vitest run src/components src/app/articles/[id]/outline src/app/articles/new/new-article-form.test.tsx`

Expected: PASS，最长模型名不撑破 280px 侧栏，移动端无水平滚动。

---

### Task 8: 纲要流程 E2E、文档和回归

**Files:**
- Create: `tests/e2e/outline-workflow.spec.ts`
- Modify: `tests/e2e/foundation-flow.spec.ts`
- Modify: `tests/helpers/run-e2e.mjs`
- Modify: `README.md`

**Interfaces:**
- Produces: 可重复的 Demo 纲要生成、审核、确认、主动保存版本和版本恢复验收流程

- [ ] **Step 1: 写 E2E 失败用例**

```ts
test("generates, reviews, versions and confirms an outline", async ({ page }) => {
  await page.goto("/articles/new");
  await page.getByLabel("知识点", { exact: true }).fill("什么是机会成本");
  await page.getByRole("button", { name: "创建文章" }).click();
  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+\/outline$/);
  await page.getByRole("button", { name: "生成理解与大纲" }).click();
  await page.getByRole("button", { name: "审核大纲" }).click();
  await expect(page.getByText("审核通过")).toBeVisible();
  await page.getByRole("button", { name: "确认大纲" }).click();
  await expect(page.getByText("大纲已确认")).toBeVisible();
  await expect(page.getByText("大纲 v1")).toBeVisible();
});
```

- [ ] **Step 2: 运行 E2E 并确认红灯**

Run: `pnpm test:e2e -- --grep "generates, reviews, versions"`

Expected: FAIL，新页面流程尚未全部接通或旧 E2E 仍依赖演示初稿按钮。

- [ ] **Step 3: 更新 E2E Demo 配置和旧测试**

测试服务保持 `LLM_API_KEY=""` 和 `LLM_MODEL=""`，确保不发送外部请求。把旧 foundation 流程中大纲相关断言迁移到新 E2E；正文和配图断言保留到第二份计划处理。

- [ ] **Step 4: 更新 README**

文档说明两页面流程、`LLM_MODELS` 配置、无 Key Demo 回退、真实 LLM 使用 `/v1/chat/completions`、无资料时的人工核验提示，以及本阶段尚未完成的正文新流程。

- [ ] **Step 5: 完整验证**

Run: `pnpm test`

Expected: 所有 Vitest 测试 PASS。

Run: `pnpm lint`

Expected: ESLint 退出码 0。

Run: `pnpm build`

Expected: Next.js 16.3.4 build 成功，未把密钥打入客户端。

Run: `pnpm test:e2e`

Expected: 桌面纲要主流程通过，移动端无横向溢出；仅按项目配置跳过的用例显示 skipped。
