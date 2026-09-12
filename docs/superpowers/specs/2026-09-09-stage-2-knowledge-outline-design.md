# 阶段 2：知识与大纲闭环设计

## 目标

在现有“知识点 -> 演示初稿 -> 块级编辑 -> 公众号预览”基础上，加入可管理的资料来源、可编辑 Knowledge Brief 和大纲确认流程，为后续正文分章生成与配图提供稳定输入。

## 范围

- 单人、本地 SQLite、无需真实模型密钥。
- 资料第一版支持 TXT 和 Markdown 文本录入。
- 网页、PDF、DOCX 使用统一来源接口和待接入状态，不在本轮引入解析器或网络抓取依赖。
- 资料只服务当前文章；来源可启用、停用、删除，删除采用硬删除以保持基础阶段简单。
- Brief 与大纲沿用文章结构化 JSON 保存，并通过现有文章乐观锁保存。
- 只有用户确认大纲后，文章状态才可进入 `outline_ready`，正文生成入口读取该状态。

## 数据模型

新增 `SourceDocument`：

```ts
type SourceType = "text" | "markdown" | "web" | "pdf" | "docx";
type SourceStatus = "ready" | "pending" | "unsupported" | "failed";

interface SourceDocument {
  id: string;
  articleId: string;
  title: string;
  type: SourceType;
  content: string;
  status: SourceStatus;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

文章表增加 `outline_confirmed_at`，保留现有 `brief_json` 和 `outline_json`。资料表按 `article_id, updated_at DESC` 查询，并以外键语义在仓储层校验文章归属。

## 业务边界

- `SourceRepository` 负责来源的列表、创建、启停和删除，不负责解析。
- `SourceParser` 以端口形式定义 `parse(input): ParsedSource`；TXT/Markdown 使用本地实现，其他类型返回 `unsupported`。
- `updateKnowledgeBrief` 和 `updateOutline` 复用现有 ArticleRepository 的原子保存接口，避免新增第二套版本控制。
- Demo 生成器接收可选的启用资料摘要；资料内容仅作为上下文，不覆盖用户已编辑的块。
- 大纲确认是显式动作，确认时保存当前 Brief/大纲并更新文章状态；修改大纲后自动取消确认。

## 页面交互

- 新建文章页保留快速模式，并增加资料文本输入区域。
- 文章工作台左侧增加“资料”面板：来源标题、类型、状态、启用开关、删除按钮和新增文本入口。
- 中间编辑区在正文块上方增加 Brief 编辑区；每个字段可单独编辑，数组字段支持逐行编辑。
- 大纲导航增加新增、上移、下移、删除和确认按钮；未确认时显示“等待确认”，确认后显示“已确认”。
- 移动端沿用只读策略，只展示来源、Brief 和大纲摘要，不提供编辑控件。

## API

- `GET /api/articles/:id/sources`
- `POST /api/articles/:id/sources`，输入 `{ title, type, content }`
- `PATCH /api/articles/:id/sources/:sourceId`，输入 `{ enabled }`
- `DELETE /api/articles/:id/sources/:sourceId`
- `PATCH /api/articles/:id` 扩展 `brief`、`outline` 和 `outlineConfirmedAt` 的保存。
- 生成接口读取已启用的 `ready` 来源摘要；没有来源时保持现有演示行为。

## 错误与并发

- 空标题或空内容返回 400。
- 不支持的来源类型仍可保存，但状态为 `unsupported`，不可作为生成上下文。
- 资料 ID 不属于文章时返回 404。
- Article 保存继续返回 409；冲突时保留本地 Brief、大纲和正文编辑。
- 任何资料解析失败只标记当前来源，不阻塞文章其他操作。

## 测试验收

- 仓储：来源创建、启停、删除、按文章隔离和状态 round-trip。
- API：空输入、unsupported 类型、跨文章访问和删除。
- 组件：Brief 字段编辑、大纲排序/删除/确认、资料启停。
- E2E：创建文章 -> 添加 Markdown 资料 -> 编辑 Brief -> 调整并确认大纲 -> 生成演示初稿 -> 预览。

## 非目标

- 本轮不接入真实模型、网页抓取、PDF/DOCX 解析、账号鉴权、团队协作、图片生成和公众号 API。
