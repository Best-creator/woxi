# 阶段 3 配图规划与占位图片闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在正文生成后由 Demo 或真实 LLM Planner 自主判断配图数量与位置，保存可编辑图片资产，并在工作台和公众号预览中显示占位图片。

**Architecture:** 图片元数据独立保存在 SQLite `image_assets` 表，正文 `image` 块仅通过 `assetId` 引用资产。`VisualPlanner` 隔离 Demo 与 OpenAI 兼容实现；SQLite 图片仓储负责图片资产与正文引用块的原子更新，Next.js Route Handlers 只做输入校验和结果映射。

**Tech Stack:** Next.js 16.3.4 App Router、React 19、TypeScript 5.9、Node.js `node:sqlite`、Zod 4、Vitest、Testing Library、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-09-stage-3-image-planning-design.md`

## Global Constraints

- 配图规划必须在正文生成后由用户显式触发，不随正文生成自动调用。
- Agent 自主决定数量，一般为 2–6 张，服务端硬上限为 12 张。
- 未配置 `LLM_API_KEY` 时使用确定性 Demo Planner；已配置但调用失败时必须显示错误，不能静默降级。
- 本阶段不得调用 `IMAGE_BASE_URL`，不得产生真实生图费用。
- 密钥只能从 `env/.env.local` 在服务端读取，禁止使用 `NEXT_PUBLIC_*`、返回客户端或写入日志。
- 桌面端支持编辑；宽度不超过 720px 时仅展示配图与预览，不提供修改操作。
- 占位图必须明确显示“待生成”，不能被误认为最终成品。
- 动态 Route Handler 使用 Node.js runtime、原生 `Request`/`Response`，并保持 Next.js 16 的异步 `context.params` 约定。
- 实现路由或图片响应前先读 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`、`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` 和 `node_modules/next/dist/docs/01-app/01-getting-started/12-images.md`。
- 当前仓库没有 `HEAD` 且 `.git` 不可写；不要重试提交。每个任务以目标测试通过作为独立检查点。

---

### Task 1: 服务端配置与私密环境文件

**Files:**
- Create: `env/.env.example`
- Create: `src/server/config.ts`
- Create: `src/server/config.test.ts`
- Modify: `.gitignore`
- Modify: `src/server/services.ts`
- Delete: `.env.example`

**Interfaces:**
- Produces: `getServerConfig(): ServerConfig`
- Produces: `parseServerConfig(env: NodeJS.ProcessEnv): ServerConfig`
- Produces: `ServerConfig`，包含 `databasePath`、可空 `llm` 和可空 `image`

- [ ] **Step 1: 为无密钥、完整 LLM 配置和不完整配置写失败测试**

```ts
// src/server/config.test.ts
import { describe, expect, it } from "vitest";
import { parseServerConfig } from "./config";

describe("parseServerConfig", () => {
  it("keeps external providers disabled when keys are empty", () => {
    const config = parseServerConfig({
      LLM_BASE_URL: "https://yelan.xiaobupao.cn",
      LLM_API_KEY: "",
      IMAGE_BASE_URL: "https://image2.xiaobupao.cn",
      IMAGE_API_KEY: ""
    });
    expect(config.llm).toBeNull();
    expect(config.image).toBeNull();
    expect(config.databasePath).toBe(".data/content-platform.db");
  });

  it("returns a server-only LLM configuration", () => {
    expect(parseServerConfig({
      LLM_BASE_URL: "https://yelan.xiaobupao.cn",
      LLM_API_KEY: "secret",
      LLM_MODEL: "gpt-5.6-terra"
    }).llm).toEqual({
      baseUrl: "https://yelan.xiaobupao.cn",
      apiKey: "secret",
      model: "gpt-5.6-terra"
    });
  });

  it("rejects a key without a model", () => {
    expect(() => parseServerConfig({ LLM_API_KEY: "secret", LLM_MODEL: "" }))
      .toThrow("LLM_MODEL");
  });
});
```

- [ ] **Step 2: 运行配置测试并确认因模块不存在而失败**

Run: `pnpm vitest run src/server/config.test.ts`

Expected: FAIL，提示无法解析 `./config`。

- [ ] **Step 3: 实现配置解析和一次性加载 `env/.env.local`**

```ts
// src/server/config.ts
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { z } from "zod";

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ServerConfig {
  databasePath: string;
  llm: ProviderConfig | null;
  image: ProviderConfig | null;
}

const envSchema = z.object({
  CONTENT_DB_PATH: z.string().min(1).default(".data/content-platform.db"),
  LLM_BASE_URL: z.url().default("https://yelan.xiaobupao.cn"),
  LLM_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default(""),
  IMAGE_BASE_URL: z.url().default("https://image2.xiaobupao.cn"),
  IMAGE_API_KEY: z.string().default(""),
  IMAGE_MODEL: z.string().default("gpt-image-2")
});

let workspaceEnvLoaded = false;

function loadWorkspaceEnv() {
  if (workspaceEnvLoaded) return;
  const path = resolve(process.cwd(), "env", ".env.local");
  if (existsSync(path)) loadEnvFile(path);
  workspaceEnvLoaded = true;
}

function provider(baseUrl: string, apiKey: string, model: string, label: string) {
  if (!apiKey.trim()) return null;
  if (!model.trim()) throw new Error(`${label}_MODEL 必须在配置密钥后填写`);
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model };
}

export function parseServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const value = envSchema.parse(env);
  return {
    databasePath: value.CONTENT_DB_PATH,
    llm: provider(value.LLM_BASE_URL, value.LLM_API_KEY, value.LLM_MODEL, "LLM"),
    image: provider(value.IMAGE_BASE_URL, value.IMAGE_API_KEY, value.IMAGE_MODEL, "IMAGE")
  };
}

export function getServerConfig() {
  loadWorkspaceEnv();
  return parseServerConfig(process.env);
}
```

更新 `src/server/services.ts`，将数据库路径来源替换为 `getServerConfig().databasePath`。不要在客户端组件导入 `src/server/config.ts`。

- [ ] **Step 4: 移动示例配置并保护真实密钥**

```dotenv
# env/.env.example
CONTENT_DB_PATH=.data/content-platform.db

LLM_BASE_URL=https://yelan.xiaobupao.cn
LLM_API_KEY=
LLM_MODEL=

IMAGE_BASE_URL=https://image2.xiaobupao.cn
IMAGE_API_KEY=
IMAGE_MODEL=gpt-image-2
```

在 `.gitignore` 增加精确规则 `env/.env.local`，删除根目录 `.env.example`，避免出现两套配置入口。

- [ ] **Step 5: 运行配置测试和现有服务相关测试**

Run: `pnpm vitest run src/server/config.test.ts src/app/api/articles/route.test.ts`

Expected: PASS，且未创建 `env/.env.local` 时仍使用 Demo 配置。

---

### Task 2: 图片领域模型、迁移与聚合仓储

**Files:**
- Create: `src/features/images/domain.ts`
- Create: `src/features/images/schemas.ts`
- Create: `src/features/images/repository.ts`
- Create: `src/features/images/sqlite-repository.ts`
- Create: `src/features/images/sqlite-repository.test.ts`
- Modify: `src/features/articles/domain.ts`
- Modify: `src/features/articles/schemas.ts`
- Modify: `src/server/db.ts`
- Modify: `tests/fixtures/article.ts`
- Modify: `tests/helpers/test-db.ts`

**Interfaces:**
- Produces: `ImageAsset`、`ImagePlanSuggestion`、`ImageAssetPatch`
- Produces: `ImageAssetRepository.list/findById/findByAssetId/applyPlan/update/remove/refreshPlaceholder`
- Produces: `ContentBlock.assetId?: string`
- Consumes: `Article` 和 SQLite `DatabaseSync`

- [ ] **Step 1: 定义领域类型与 Zod Schema，并写 round-trip 失败测试**

```ts
// src/features/images/domain.ts
export type ImageAssetType = "cover" | "concept" | "process" | "comparison" | "knowledge_card";
export type ImageAssetStatus = "planned" | "placeholder" | "generating" | "generated" | "disabled" | "failed";
export type ImageAspectRatio = "cover" | "landscape" | "square" | "portrait";

export interface ImagePlanSuggestion {
  type: ImageAssetType;
  anchorBlockId: string | null;
  purpose: string;
  prompt: string;
  altText: string;
  aspectRatio: ImageAspectRatio;
}

export interface ImageAsset extends ImagePlanSuggestion {
  id: string;
  articleId: string;
  status: ImageAssetStatus;
  placeholderUrl: string | null;
  filePath: string | null;
  publicUrl: string | null;
  manuallyEdited: boolean;
  createdAt: string;
  updatedAt: string;
}
```

Schema 使用可辨识联合约束封面和正文插图：

```ts
const sharedSuggestionFields = {
  purpose: z.string().trim().min(1).max(500),
  prompt: z.string().trim().min(1).max(4000),
  altText: z.string().trim().min(1).max(240),
  aspectRatio: z.enum(["cover", "landscape", "square", "portrait"])
};

export const imagePlanSuggestionSchema = z.discriminatedUnion("type", [
  z.object({
    ...sharedSuggestionFields,
    type: z.literal("cover"),
    anchorBlockId: z.null()
  }),
  z.object({
    ...sharedSuggestionFields,
    type: z.enum(["concept", "process", "comparison", "knowledge_card"]),
    anchorBlockId: z.string().min(1)
  })
]);

export const imagePlanResponseSchema = z.object({
  images: z.array(imagePlanSuggestionSchema).max(12)
});
```

仓储测试至少断言：迁移可重复执行、不同文章隔离、布尔字段 round-trip、删除文章后资产级联删除、文章块中的 `assetId` 可保存和读取。

- [ ] **Step 2: 运行领域与仓储测试并确认失败**

Run: `pnpm vitest run src/features/images/sqlite-repository.test.ts src/features/articles/sqlite-repository.test.ts`

Expected: FAIL，提示图片表或图片仓储不存在。

- [ ] **Step 3: 新增数据库迁移**

在 `migrateDatabase` 的建表事务中增加：

```sql
CREATE TABLE IF NOT EXISTS image_assets (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  anchor_block_id TEXT,
  type TEXT NOT NULL,
  purpose TEXT NOT NULL,
  prompt TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  status TEXT NOT NULL,
  placeholder_url TEXT,
  file_path TEXT,
  public_url TEXT,
  manually_edited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS image_assets_article_idx
  ON image_assets(article_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS image_assets_anchor_idx
  ON image_assets(anchor_block_id);
```

- [ ] **Step 4: 定义聚合仓储结果和方法签名**

```ts
// src/features/images/repository.ts
export type ImagePlanMutationResult =
  | { kind: "saved"; article: Article; assets: ImageAsset[] }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "invalid_anchor"; anchorBlockId: string }
  | { kind: "invalid_state"; message: string };

export interface ImageAssetPatch {
  anchorBlockId?: string | null;
  prompt?: string;
  altText?: string;
  aspectRatio?: ImageAspectRatio;
  enabled?: boolean;
}

export interface ImageAssetRepository {
  list(articleId: string): Promise<ImageAsset[]>;
  findById(articleId: string, assetId: string): Promise<ImageAsset | null>;
  findByAssetId(assetId: string): Promise<ImageAsset | null>;
  applyPlan(articleId: string, expectedUpdatedAt: string, suggestions: ImagePlanSuggestion[]): Promise<ImagePlanMutationResult>;
  update(articleId: string, assetId: string, expectedUpdatedAt: string, patch: ImageAssetPatch): Promise<ImagePlanMutationResult>;
  remove(articleId: string, assetId: string, expectedUpdatedAt: string): Promise<ImagePlanMutationResult>;
  refreshPlaceholder(articleId: string, assetId: string, expectedUpdatedAt: string): Promise<ImagePlanMutationResult>;
}
```

- [ ] **Step 5: 实现 SQLite 映射和事务辅助函数**

`SqliteImageAssetRepository` 必须使用 `BEGIN IMMEDIATE`、`COMMIT` 和异常路径 `ROLLBACK`。事务开始后重新读取文章及其 `updated_at`，确保 Planner 调用期间发生的正文修改会得到 `conflict`。

新增纯函数 `placeImageBlocks(blocks, assets)`：

1. 删除指向将被替换资产的旧 `image` 块。
2. 封面块放在第一个非图片块之前。
3. 正文图片块紧跟 `anchorBlockId` 对应块。
4. 被禁用或无有效锚点的正文资产不生成引用块。
5. 最终重新按 `0..n-1` 写入连续 `order`。

图片块必须使用以下结构：

```ts
{
  id: randomUUID(),
  type: "image",
  content: `/api/image-assets/${asset.id}/content`,
  altText: asset.altText,
  assetId: asset.id,
  order: 0,
  version: 1
}
```

`applyPlan` 只删除 `manuallyEdited === false` 且状态为 `planned` 或 `placeholder` 的资产；保留人工项及 `generating/generated/failed/disabled`。新资产初始状态为 `placeholder`，`placeholderUrl` 使用受控内容接口。

- [ ] **Step 6: 实现更新、启停、删除和重建占位图语义**

- 更新提示词、替代文本、比例或锚点时设置 `manually_edited = 1`。
- `enabled: false` 将状态改为 `disabled` 并移除正文引用块。
- `enabled: true` 将 `disabled` 改回 `placeholder` 并按锚点恢复正文引用块。
- 删除资产时同一事务删除对应正文引用块。
- `refreshPlaceholder` 将非禁用资产状态设为 `placeholder`、刷新 `updated_at`，但不设置 `manually_edited`。
- 所有会改变正文块的操作使用 `WHERE id = ? AND updated_at = ?` 更新文章，失败返回 `conflict`。

- [ ] **Step 7: 运行图片仓储与文章 Schema 测试**

Run: `pnpm vitest run src/features/images/sqlite-repository.test.ts src/features/articles/sqlite-repository.test.ts src/app/api/articles/[id]/route.test.ts`

Expected: PASS，包括重新分析保留人工项、无效锚点不写入、删除无孤立块和冲突事务回滚。

---

### Task 3: Demo Planner 与 OpenAI 兼容 LLM Planner

**Files:**
- Create: `src/features/images/visual-planner.ts`
- Create: `src/features/images/demo-visual-planner.ts`
- Create: `src/features/images/demo-visual-planner.test.ts`
- Create: `src/features/images/openai-visual-planner.ts`
- Create: `src/features/images/openai-visual-planner.test.ts`
- Modify: `src/server/services.ts`

**Interfaces:**
- Consumes: `ProviderConfig`、`Article`、`ImagePlanSuggestion[]`
- Produces: `VisualPlanner.plan(input: VisualPlanInput): Promise<ImagePlanSuggestion[]>`
- Produces: `getVisualPlanner(): VisualPlanner`

- [ ] **Step 1: 写 Planner 合同和 Demo 行为失败测试**

```ts
// src/features/images/visual-planner.ts
export interface VisualPlanInput {
  title: string;
  topic: string;
  blocks: ContentBlock[];
}

export interface VisualPlanner {
  plan(input: VisualPlanInput): Promise<ImagePlanSuggestion[]>;
}
```

Demo 测试使用包含“首先、然后、最后”的流程段落和包含“相比、区别”的对比段落，断言：始终返回一个 `cover`；关键词分别映射为 `process` 和 `comparison`；建议总数不超过 12；相同输入得到深度相等结果；图片块不会成为候选锚点。

- [ ] **Step 2: 运行 Demo Planner 测试并确认失败**

Run: `pnpm vitest run src/features/images/demo-visual-planner.test.ts`

Expected: FAIL，提示 `DemoVisualPlanner` 不存在。

- [ ] **Step 3: 实现确定性 Demo Planner**

按以下顺序给非图片正文块评分：

- 包含 `首先|然后|最后|步骤|过程`：`process`，+4。
- 包含 `相比|区别|不同|共同`：`comparison`，+4。
- 包含 `因为|所以|导致|关系|原理`：`concept`，+3。
- 类型为 `knowledge_card`：`knowledge_card`，+3。
- 内容长度至少 60 字：+1。

先生成封面建议，再按分数降序选择最多 4 个解释图；分数相同时按正文 `order`；相邻候选只保留得分更高者。提示词包含文章主题、该段摘要、图片类型、清晰中文信息图、无水印和适合公众号阅读等要求。

- [ ] **Step 4: 写 LLM 请求、响应校验和错误测试**

通过构造函数注入 `fetchFn: typeof fetch`。测试必须断言：

- URL 为 `${baseUrl}/v1/chat/completions`。
- Authorization 为 `Bearer <key>`。
- 请求包含 `response_format: { type: "json_object" }` 和配置模型。
- 合法 JSON 经 `imagePlanResponseSchema` 返回。
- 非 2xx、空 choices、非 JSON、超过 12 项和非法锚点抛出面向用户的 `VisualPlannerError`。
- 异常消息不得包含 API key。

- [ ] **Step 5: 实现 `OpenAiVisualPlanner`**

请求体固定为非流式：

```ts
{
  model: config.model,
  stream: false,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: VISUAL_PLANNER_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(input) }
  ]
}
```

使用 `AbortSignal.timeout(30_000)`。系统提示要求只返回 `{ "images": [...] }`，说明类型枚举、锚点规则、最多 12 项、控制装饰图和避免连续配图。解析 `choices[0].message.content` 后用 `imagePlanResponseSchema` 校验，再检查所有非空锚点存在于输入的非图片块中。

错误类型固定为：

```ts
export class VisualPlannerError extends Error {
  constructor(
    public readonly code: "timeout" | "authentication" | "invalid_response" | "upstream",
    message: string
  ) {
    super(message);
    this.name = "VisualPlannerError";
  }
}
```

- [ ] **Step 6: 在服务容器按配置选择 Planner**

```ts
export function getVisualPlanner() {
  if (!visualPlanner) {
    const config = getServerConfig();
    visualPlanner = config.llm
      ? new OpenAiVisualPlanner(config.llm)
      : new DemoVisualPlanner();
  }
  return visualPlanner;
}
```

本任务不得读取或调用 `config.image`。

- [ ] **Step 7: 运行全部 Planner 和配置测试**

Run: `pnpm vitest run src/features/images src/server/config.test.ts`

Expected: PASS，测试期间没有外部网络请求。

---

### Task 4: 配图规划 API 与占位图片响应

**Files:**
- Create: `src/features/images/plan-images.ts`
- Create: `src/features/images/plan-images.test.ts`
- Create: `src/features/images/render-placeholder-svg.ts`
- Create: `src/features/images/render-placeholder-svg.test.ts`
- Create: `src/app/api/articles/[id]/image-plan/route.ts`
- Create: `src/app/api/articles/[id]/image-plan/route.test.ts`
- Create: `src/app/api/image-assets/[assetId]/content/route.ts`
- Create: `src/app/api/image-assets/[assetId]/content/route.test.ts`
- Modify: `src/server/services.ts`

**Interfaces:**
- Consumes: `ArticleRepository`、`ImageAssetRepository`、`VisualPlanner`
- Produces: `planImages(articleId, expectedUpdatedAt, dependencies): Promise<PlanImagesResult>`
- Produces: SVG `Response`，内容类型为 `image/svg+xml; charset=utf-8`

- [ ] **Step 1: 写应用服务失败测试**

覆盖：文章不存在返回 `not_found`；没有非图片正文块返回 `no_content`；Planner 成功后调用 `applyPlan`；Planner 调用期间文章版本变化由仓储返回 `conflict`；Planner 抛错时不调用 `applyPlan`。

```ts
export type PlanImagesResult =
  | { kind: "planned"; article: Article; assets: ImageAsset[] }
  | { kind: "not_found" }
  | { kind: "no_content" }
  | { kind: "conflict" }
  | { kind: "invalid_plan"; message: string };
```

- [ ] **Step 2: 运行应用服务测试并确认失败**

Run: `pnpm vitest run src/features/images/plan-images.test.ts`

Expected: FAIL，提示 `planImages` 不存在。

- [ ] **Step 3: 实现应用服务与严格错误映射**

先读取文章并过滤 `type !== "image"` 的块；为空时不调用 Planner。Planner 错误映射为 `invalid_plan`，消息只能使用受控文案：超时为“配图分析超时，请重试”，鉴权失败为“LLM 配置无效，请检查 env/.env.local”，其他响应错误为“配图分析失败，请稍后重试”。

- [ ] **Step 4: 写并实现规划 Route Handler**

请求 Schema：

```ts
const requestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime()
});
```

工厂签名：

```ts
export function createImagePlanRouteHandler(
  articles: ArticleRepository,
  images: ImageAssetRepository,
  planner: VisualPlanner
)
```

状态映射：无效 JSON/版本为 400、无正文为 400、文章不存在为 404、冲突为 409、Planner 失败为 502、成功返回 `{ article, assets }`。导出 `runtime = "nodejs"`，并使用 `const { id } = await context.params`。

- [ ] **Step 5: 写 SVG 安全与版式失败测试**

逐一覆盖 `cover/landscape/square/portrait` 的 viewBox；输入 `<script>`、`&`、引号时输出必须经过 XML 转义；输出必须包含“待生成”和替代文本，不能包含 `<script>`。

- [ ] **Step 6: 实现确定性占位 SVG**

尺寸映射固定为：`cover=900x383`、`landscape=1200x800`、`square=1000x1000`、`portrait=900x1200`。使用两种中性色加一种绿色强调色；不使用渐变、外部字体、脚本或远程资源。长文本按固定字符数分行，并限制最多 4 行，保证不越界。

- [ ] **Step 7: 实现图片内容 Route Handler**

按 `assetId` 查询资产；不存在或 `disabled` 返回 404。占位状态返回 SVG，并设置：

```ts
headers: {
  "content-type": "image/svg+xml; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "x-content-type-options": "nosniff"
}
```

工厂接收 `ImageAssetRepository`，测试不接触真实数据库。为后续真实文件保留分支，但本阶段 `generated` 且无 `filePath/publicUrl` 时返回 404，不读取任意磁盘路径。

- [ ] **Step 8: 运行应用服务与两个 Route Handler 测试**

Run: `pnpm vitest run src/features/images/plan-images.test.ts src/features/images/render-placeholder-svg.test.ts src/app/api/articles/[id]/image-plan/route.test.ts src/app/api/image-assets/[assetId]/content/route.test.ts`

Expected: PASS。

---

### Task 5: 图片资产查询、编辑、启停、删除与重建 API

**Files:**
- Create: `src/app/api/articles/[id]/image-assets/route.ts`
- Create: `src/app/api/articles/[id]/image-assets/route.test.ts`
- Create: `src/app/api/articles/[id]/image-assets/[assetId]/route.ts`
- Create: `src/app/api/articles/[id]/image-assets/[assetId]/route.test.ts`
- Create: `src/app/api/articles/[id]/image-assets/[assetId]/placeholder/route.ts`
- Create: `src/app/api/articles/[id]/image-assets/[assetId]/placeholder/route.test.ts`

**Interfaces:**
- Consumes: `ImageAssetRepository`
- Produces: `GET image-assets`、`PATCH/DELETE image-assets/:assetId`、`POST placeholder`

- [ ] **Step 1: 写列表和跨文章隔离失败测试**

`GET` 必须先确认文章存在，再返回 `{ assets }`；文章不存在返回 404；结果仅包含当前文章资产。路由工厂显式注入 `ArticleRepository` 和 `ImageAssetRepository`。

- [ ] **Step 2: 写修改请求 Schema 与状态失败测试**

```ts
const updateImageAssetSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  anchorBlockId: z.string().min(1).nullable().optional(),
  prompt: z.string().trim().min(1).max(4000).optional(),
  altText: z.string().trim().min(1).max(240).optional(),
  aspectRatio: z.enum(["cover", "landscape", "square", "portrait"]).optional(),
  enabled: z.boolean().optional()
}).refine((value) => Object.keys(value).some((key) => key !== "expectedUpdatedAt"), {
  message: "至少提供一项修改"
});
```

测试 400 无效 JSON/空 patch、404 跨文章、409 旧版本，以及成功响应 `{ article, assets }`。

- [ ] **Step 3: 实现列表与 PATCH Route Handler**

保持异步 `params`，不在路由中复制事务逻辑。仓储的 `invalid_anchor` 和 `invalid_state` 映射为 400，其他结果按 404/409/200 映射。

- [ ] **Step 4: 写并实现 DELETE Route Handler**

DELETE 接受 JSON `{ expectedUpdatedAt }`。成功返回 `{ article, assets }`，而不是 204，因为客户端必须同步更新后的正文块和文章版本。不存在返回 404，冲突返回 409。

- [ ] **Step 5: 写并实现占位图重建 Route Handler**

POST 接受 JSON `{ expectedUpdatedAt }`，调用 `refreshPlaceholder`。禁用资产返回 400；成功返回 `{ article, assets }`。此路由只刷新占位状态和时间戳，不调用 `IMAGE_BASE_URL`。

- [ ] **Step 6: 运行全部图片资产 API 测试**

Run: `pnpm vitest run src/app/api/articles/[id]/image-assets`

Expected: PASS，且外部网络调用数为 0。

---

### Task 6: 配图工作区与正文图片展示

**Files:**
- Create: `src/components/image-planning-panel.tsx`
- Create: `src/components/image-planning-panel.test.tsx`
- Modify: `src/components/generation-panel.tsx`
- Modify: `src/components/block-editor.tsx`
- Modify: `src/components/block-editor.test.tsx`
- Modify: `src/app/articles/[id]/page.tsx`
- Modify: `src/app/articles/[id]/article-workspace.tsx`
- Modify: `src/app/articles/[id]/article-workspace.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `Article`、`ImageAsset[]` 和 Task 4/5 API
- Produces: `ImagePlanningPanel`、更新后的 `ArticleWorkspace`

- [ ] **Step 1: 写配图面板交互失败测试**

测试使用依赖注入函数，覆盖：

- 有正文无资产时显示“分析配图需求”。
- 点击分析时禁用按钮并调用 `planImages(expectedUpdatedAt)`。
- 每项显示图片、类型、锚点摘要、理由、提示词、比例和状态。
- 编辑提示词后调用 `updateAsset`，成功后以服务端返回的文章和资产替换本地状态。
- 启停、删除、重建占位图调用对应操作。
- `readOnly` 时显示图片和状态，但不存在文本框、选择器、复选框和操作按钮。

建议的组件合同：

```ts
interface ImagePlanningPanelProps {
  article: Article;
  assets: ImageAsset[];
  readOnly?: boolean;
  onResult: (article: Article, assets: ImageAsset[]) => void;
  planImages?: (expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
  updateAsset?: (assetId: string, input: ImageAssetPatch & { expectedUpdatedAt: string }) => Promise<ImageMutationPayload>;
  deleteAsset?: (assetId: string, expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
  refreshPlaceholder?: (assetId: string, expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
}

interface ImageMutationPayload {
  article: Article;
  assets: ImageAsset[];
}
```

- [ ] **Step 2: 运行组件测试并确认失败**

Run: `pnpm vitest run src/components/image-planning-panel.test.tsx`

Expected: FAIL，提示组件不存在。

- [ ] **Step 3: 实现面板和请求适配**

使用 Lucide 的 `ImagePlus`、`RefreshCw`、`Trash2`、`MapPin` 图标。陌生图标按钮必须有 `title` 和 `aria-label`。比例使用 `<select>`，启停使用 checkbox，提示词和替代文本使用 textarea/input。所有请求错误在面板内以 `role="alert"` 展示，不能丢失现有资产。

锚点选择器列出所有非图片正文块，标签为截断后的前 36 个字符。封面类型隐藏锚点选择器；正文图锚点失效时显示“待重新定位”。

- [ ] **Step 4: 将图片资产加载到文章页面**

```tsx
const [article, sources, imageAssets] = await Promise.all([
  getArticleRepository().findById(id),
  getSourceRepository().list(id),
  getImageAssetRepository().list(id)
]);
```

注意先处理文章 404：实际实现可先读取文章，再并行读取 sources/assets，或让两个仓储安全返回空数组。向 `ArticleWorkspace` 增加 `initialImageAssets`，规划或资产操作成功后同时更新 `articleRef.current`、React state、`saveState` 和 assets state。

- [ ] **Step 5: 更新正文图片块展示**

`BlockEditor` 的图片分支从文字方框改为稳定比例的 `<img>`：

```tsx
<img
  src={block.content}
  alt={block.altText || "文章配图"}
  loading="lazy"
/>
```

图片父元素根据关联资产比例设置 `aspect-ratio`；无法加载时显示原占位文案。图片加载失败不能改变周围布局。

- [ ] **Step 6: 调整现有生成面板职责**

无正文时仍显示“生成演示初稿”。有正文后，`GenerationPanel` 渲染 `ImagePlanningPanel`，删除现有仅显示“初稿已经生成”的静态完成态。工作台只保留一个右侧面板，不创建嵌套卡片。

- [ ] **Step 7: 完成响应式样式**

配图项使用最大 8px 圆角或沿用现有直角；缩略图设置明确的 `aspect-ratio`、`width: 100%` 和 `object-fit: cover`。所有表单设置 `min-width: 0`。在 1100px 以下面板进入全宽行；720px 以下隐藏编辑动作但保留缩略图、类型、理由和状态。不得出现横向滚动或按钮文字溢出。

- [ ] **Step 8: 运行组件与工作台测试**

Run: `pnpm vitest run src/components/image-planning-panel.test.tsx src/components/block-editor.test.tsx src/app/articles/[id]/article-workspace.test.tsx`

Expected: PASS，包括规划结果更新文章版本后不会触发旧版本自动保存。

---

### Task 7: 公众号渲染、端到端流程与完整验证

**Files:**
- Modify: `src/features/publishing/render-wechat-html.ts`
- Modify: `src/features/publishing/render-wechat-html.test.ts`
- Modify: `src/components/wechat-preview.test.tsx`
- Modify: `tests/e2e/foundation-flow.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: 带 `assetId` 的图片块和受控 `/api/image-assets/:id/content` 地址
- Produces: 安全的工作台/公众号占位图片预览和阶段 3 使用说明

- [ ] **Step 1: 写安全图片 URL 与纯文本输出失败测试**

断言仅接受：

- `https://...` 最终图片地址。
- 精确匹配 `/api/image-assets/<非空安全ID>/content` 的内部占位地址。

拒绝 `javascript:`、`data:`、协议相对 URL、任意 `/api/...` 路径和包含引号的路径。图片块的纯文本输出应为 `[配图：<altText>]`，不能泄漏内部 API URL。

- [ ] **Step 2: 运行发布测试并确认失败**

Run: `pnpm vitest run src/features/publishing/render-wechat-html.test.ts src/components/wechat-preview.test.tsx`

Expected: FAIL，当前渲染器不会把内部受控 URL 渲染为图片。

- [ ] **Step 3: 实现受控内部图片渲染**

将 `validHttpsUrl` 替换为 `validImageSource`。内部路径用正则 `^/api/image-assets/[A-Za-z0-9-]+/content$` 校验；外部地址仍只接受 HTTPS。保持属性 HTML 转义，并为 `<img>` 增加 `loading="lazy"`、`max-width:100%`、`height:auto`。

预览中的占位图下方明确显示替代文本。复制富文本仍包含图片标签，但 README 必须说明本地占位 URL 仅用于规划预览，公众号正式发布需要后续素材上传阶段。

- [ ] **Step 4: 扩展桌面 E2E 主流程**

在现有初稿生成之后加入：

```ts
await page.getByRole("button", { name: "分析配图需求" }).click();
await expect(page.getByText("待生成").first()).toBeVisible();
await expect(page.locator(".image-plan-thumbnail img").first()).toBeVisible();
await page.getByLabel("配图提示词 1").fill("清晰解释机会成本的对比信息图");
await expect(page.getByText("已保存", { exact: true })).toBeVisible();
```

打开公众号预览后，在 iframe 中断言至少一个 `img[src*='/api/image-assets/']` 可见且 `naturalWidth > 0`。

- [ ] **Step 5: 扩展移动端 E2E**

先通过 API 生成正文和配图计划，再切换到 390×844。断言配图缩略图可见、编辑控件数量为 0、`document.documentElement.scrollWidth <= window.innerWidth`，并检查正文与配图区域都位于 18–357px 范围内。

- [ ] **Step 6: 更新 README 配置和阶段边界**

写明：复制 `env/.env.example` 为 `env/.env.local` 后填写密钥；空密钥使用 Demo Planner；LLM endpoint 为 `/v1/chat/completions`；图片 endpoint 已预留但阶段 3 不调用；本地占位图不可直接作为公众号线上素材。

- [ ] **Step 7: 运行完整自动化验证**

Run: `pnpm test`

Expected: 所有 Vitest 测试通过。

Run: `pnpm lint`

Expected: 退出码 0，无 ESLint 错误。

Run: `pnpm build`

Expected: Next.js 16.3.4 生产构建成功。

Run: `pnpm test:e2e`

Expected: 桌面完整配图流程和移动端只读/无横向溢出测试通过。

- [ ] **Step 8: 浏览器视觉验收**

启动开发服务器后在桌面 1440×900 与移动 390×844 检查：占位图非空、比例稳定、文字不溢出；配图工作区没有卡片嵌套；按钮图标和工具提示可用；公众号 iframe 中图片可见；页面无重叠和横向滚动。用浏览器截图保留桌面、移动和公众号预览三个验收画面。

---

## 完成标准

- 用户可以从已有正文生成由 Agent 决定数量和位置的配图计划。
- 无密钥环境完整使用 Demo Planner；填写 LLM 配置后请求指定 OpenAI 兼容接口。
- 用户编辑、启停、删除、重新定位和重建占位图时，图片资产与正文引用始终一致。
- 公众号预览显示可加载的占位图片，纯文本复制不泄漏内部 URL。
- 所有单元、组件、API、构建和 E2E 验证通过。
- 实现过程中没有调用真实生图接口，密钥没有出现在客户端、日志或版本控制文件中。
