# 阶段 3：配图规划与占位图片闭环设计

## 目标

在现有“资料 -> Knowledge Brief -> 大纲 -> 正文 -> 公众号预览”流程上加入配图规划。正文完成后，由 Agent 判断哪些内容需要图片辅助理解，自主决定图片数量、类型和插入位置；用户可检查和编辑规划，并在未配置真实生图服务时完成占位图片预览闭环。

## 范围

- 配图规划发生在正文生成之后，不按章节机械分配固定数量。
- Agent 重点识别抽象概念、流程、因果关系、对象对比、关键结论和封面需求。
- 一般文章预计 2–6 张图，但不设业务固定值；接口设置最多 12 张的安全上限。
- 本阶段实现 Demo Planner、可选 LLM Planner、配图管理和占位图片，不调用真实生图接口。
- 桌面端支持完整编辑；移动端延续现有只读策略。

## 方案选择

采用“独立图片资产 + 正文图片块引用”的方案。

图片的提示词、状态和文件信息不直接塞入正文块。图片资产独立保存，正文中的 `image` 块仅通过 `assetId` 关联资产并承担排序和插入位置语义。这样后续接入真实生图、失败重试、替换文件和历史版本时，不需要重构正文数据。

## 数据模型

新增 `ImageAsset`：

```ts
type ImageAssetType =
  | "cover"
  | "concept"
  | "process"
  | "comparison"
  | "knowledge_card";

type ImageAssetStatus =
  | "planned"
  | "placeholder"
  | "generating"
  | "generated"
  | "disabled"
  | "failed";

type ImageAspectRatio = "cover" | "landscape" | "square" | "portrait";

interface ImageAsset {
  id: string;
  articleId: string;
  anchorBlockId: string | null;
  type: ImageAssetType;
  purpose: string;
  prompt: string;
  altText: string;
  aspectRatio: ImageAspectRatio;
  status: ImageAssetStatus;
  placeholderUrl: string | null;
  filePath: string | null;
  publicUrl: string | null;
  manuallyEdited: boolean;
  createdAt: string;
  updatedAt: string;
}
```

`ContentBlock` 增加可选的 `assetId`。新增 `image_assets` 表，并为 `(article_id, updated_at)` 和 `anchor_block_id` 建立索引。封面资产的 `anchorBlockId` 可以为空，正文插图必须引用有效块。图片资产通过外键关联文章；删除文章时级联清理资产。

## Agent 规划规则

正文生成后，用户显式触发“分析配图需求”。Planner 接收文章标题、主题和按顺序排列的正文块，返回结构化配图计划。

每个建议必须包含：

- 图片类型和画面比例。
- 有效的正文锚点块 ID。
- 为什么这处内容需要图片。
- 可直接用于生图的中文提示词。
- 面向无障碍和发布场景的替代文本。

Planner 遵循以下约束：

- 仅在图片能明显降低理解成本时建议解释图，控制装饰性图片。
- 避免连续段落重复配图。
- 封面图可不依赖正文锚点展示，但正文插图必须关联有效块。
- 结果通过 Zod 严格校验，提示词、理由和替代文本不能为空。
- 单次最多接受 12 项；无合适位置时允许只返回封面或空解释图列表。

## Planner 适配

定义统一的 `VisualPlanner` 端口。

- 未配置 `LLM_API_KEY` 时使用确定性的 Demo Planner，使本地环境可完整验收。
- 配置密钥后使用 OpenAI 兼容的 LLM Planner，调用 `${LLM_BASE_URL}/v1/chat/completions`。
- LLM 返回必须满足规划 Schema；无效响应不会修改现有计划。
- 已配置 LLM 但请求失败时明确返回错误，不静默切换 Demo Planner。

## 重新分析与一致性

首次规划会创建图片资产，并在相应正文锚点后插入引用该资产的 `image` 块。插入和保存图片资产在同一数据库事务中完成。

重新分析时：

- 保留用户人工编辑过的资产。
- 保留已进入真实生成流程或已有成品文件的资产。
- 仅替换未人工修改的 `planned` 或 `placeholder` 项。
- 若正文编辑导致锚点失效，资产标记为待重新定位，不自动猜测新位置。
- 删除正文图片块不立即物理删除资产；用户明确删除资产时才清理记录和引用块。

## 占位图片

占位图由服务端按资产类型生成轻量视觉模板，提供封面、概念、流程、对比和知识卡片版式。占位图展示文章主题、图片用途和关键说明，并明确标记为“待生成”，不冒充最终成品。

工作台和公众号预览通过受控内容接口读取占位图。后续真实生图文件保存到 `.data/images/<articleId>/`，仍由同一接口提供，避免客户端接触本地文件路径。

## 页面交互

正文存在时，右侧“AI 创作”区域展示配图工作区：

- “分析配图需求”触发规划。
- 配图项按正文顺序显示缩略图、类型、锚点摘要、理由、提示词、比例和状态。
- 用户可编辑提示词和替代文本、调整插入位置、启停、删除或单独重建占位图。
- 重新分析前保留人工成果，并显示本次将更新的范围。
- 锚点失效时显示“待重新定位”，不在预览中插入错误位置。

桌面端提供全部编辑操作。移动端展示配图列表、状态和公众号预览，不显示编辑控件。

## API

- `GET /api/articles/:id/image-assets`
- `POST /api/articles/:id/image-plan`
- `PATCH /api/articles/:id/image-assets/:assetId`
- `DELETE /api/articles/:id/image-assets/:assetId`
- `POST /api/articles/:id/image-assets/:assetId/placeholder`
- `GET /api/image-assets/:assetId/content`

所有文章级接口验证资产归属。修改操作采用文章当前版本作为乐观锁输入；冲突返回 409，保留客户端未保存内容。

## 配置

新增仅服务端使用的 `env/.env.local`，并提交不含密钥的 `env/.env.example`：

```dotenv
CONTENT_DB_PATH=.data/content-platform.db

LLM_BASE_URL=https://yelan.xiaobupao.cn
LLM_API_KEY=
LLM_MODEL=

IMAGE_BASE_URL=https://image2.xiaobupao.cn
IMAGE_API_KEY=
IMAGE_MODEL=gpt-image-2
```

`src/server/config.ts` 负责加载和校验配置。`env/.env.local` 加入 `.gitignore`；密钥不使用 `NEXT_PUBLIC_*`，不返回客户端，也不写入日志。空密钥不影响开发服务器、测试或构建。

## 错误处理

- 没有正文时拒绝规划并返回 400。
- 无效锚点、空提示词或超过数量上限时拒绝整个 Planner 结果。
- LLM 超时、鉴权失败或响应无效时保留现有计划，并向用户显示可操作错误。
- 资产不属于当前文章时返回 404。
- 占位图生成失败只标记当前资产，不阻塞其他配图。
- 规划事务失败时不留下孤立资产或正文图片块。

## 测试验收

- 配置：缺少密钥时选择 Demo Planner，配置存在时选择 LLM Planner，密钥不进入客户端数据。
- 仓储：图片资产增删改、按文章隔离、状态 round-trip 和级联清理。
- Planner：Agent 输出校验、最大数量、无效锚点、确定性 Demo 结果和 LLM 错误处理。
- 业务：首次规划原子插入、重新分析保留人工项、锚点失效和删除语义。
- API：输入错误、跨文章访问、409 冲突和占位内容读取。
- 组件：配图项编辑、启停、删除、重新定位和移动端只读。
- 发布：公众号预览显示有效图片，未生成资产显示明确占位状态。
- E2E：生成正文 -> 分析配图 -> 编辑计划 -> 查看占位图片 -> 公众号预览。

## 非目标

- 本阶段不调用真实图片生成接口，不产生图片生成费用。
- 不实现公众号素材上传、CDN 托管或直接发布。
- 不实现跨文章素材库、多人权限、审批流或图片版本历史。
- 不自动抓取互联网图片。
