# 知文内容工作台

面向微信公众号知识类图文的结构化创作工作台。创作被拆成四步，每一步都由 LLM 参与并必须人工确认后才放行：

1. **资料来源** —— 粘贴资料并生成 Knowledge Brief；
2. **文章大纲** —— 生成大纲 → 独立审核 → 按审核意见修订 → 确认；
3. **设计分镜** —— 选人物语言风格 → 按大纲章节生成正文分镜段（排法 + 成稿文案 + 分镜帧）→ 独立审核 → 确认内容；
4. **配图** —— 生成分镜帧与配图 → 按段拼接成段图（字体可选）→ 预览占位与成稿。

前两步共用 `/articles/{id}` 的四步工作台（当前步骤存在 URL 的 `?step=` 中）；第 3 步的正文闭环就嵌在第 3 步面板内，不额外开一个页面。

## 环境要求

- Node.js 22 以上（使用内置 `node:sqlite`）
- pnpm 11 或更高版本

## 本地运行

```powershell
pnpm install
Copy-Item env/.env.example env/.env.local
pnpm dev
```

访问 `http://127.0.0.1:3000`。默认数据库位于 `.data/content-platform.db`，可以通过 `CONTENT_DB_PATH` 修改。

在 `env/.env.local` 中填写模型密钥、默认模型、模型白名单和可选服务地址：

```ini
LLM_API_KEY=
LLM_MODEL=
LLM_MODELS=model-a,model-b
LLM_RESEARCH_MODEL=
```

`LLM_MODELS` 是逗号分隔的可选模型白名单，默认 `LLM_MODEL` 会始终保留在可用列表中。`LLM_RESEARCH_MODEL` 是「AI 联网搜集资料」专用的深度研究模型（如多 agent 模型），留空时回落到 `LLM_MODEL`。真实 LLM 使用 OpenAI 兼容的 `{LLM_BASE_URL}/v1/chat/completions` endpoint。留空 `LLM_API_KEY` 时，大纲生成/审核、正文生成/审核和配图规划都使用不会发出外部请求的确定性 Demo 回退，适合本地开发和自动测试（联网搜集资料仍会真实访问搜索引擎，可用 `WO_XI_DISABLE_WEB_SEARCH=1` 禁用）。图片配置走 OpenAI 兼容的 `{IMAGE_BASE_URL}/v1/images/generations`，留空 `IMAGE_API_KEY` 时第 4 步不显示真实生成入口。

## AI 联网搜集资料

新建文章页选择「快速生成」时默认勾选「创建后由 AI 联网搜集资料」。创建文章后系统会：

1. 用 LLM 根据知识点生成 2-3 个搜索查询词（未配置 LLM 时直接使用知识点本身）；
2. 通过服务端搜索引擎（搜狗为主、Bing RSS 兜底）获取真实网页结果；
3. 由 `LLM_RESEARCH_MODEL` 将结果整理成结构化资料（概述 / 带编号来源的关键事实 / 常见疑问），存为文章的 `web` 类型资料。

后续大纲与正文生成会自动引用这份资料。该功能通过 `POST /api/articles/{id}/research` 提供，走与其他写操作相同的乐观并发（`expectedUpdatedAt`）约束；搜集失败不会阻塞创建流程，页面会提示后允许直接进入工作台。

设置环境变量 `WO_XI_DISABLE_WEB_SEARCH=1` 可完全禁用真实搜索（搜索层返回空结果、research 快速失败），E2E 测试与离线演示环境用它保证零外网请求。

没有资料时仍可生成大纲和正文，但系统会标记事实性表述需要人工核验；在发布前应补充可靠资料或完成人工核对。

## 两道审核门

- **大纲审核**：`blocked` 阻止确认；`needs_revision` 需要勾选"我已了解审核警告"才能确认。
- **正文审核**：`blocked` 阻止确认内容；`needs_revision` 同样需要显式勾选警告才能确认。确认后文章状态进入 `content_ready`，`ready_to_publish` 保留给后续配图与发布流程。

审核结果绑定到不可变的正文修订（`article_revisions` 的 `scope = 'content'`）。编辑正文、更换人物语言风格或改变启用资料，都会让已保存的审核自动过期。

## 人物语言风格

正文页提供五个预设（通俗科普老师、理性分析者、朋友聊天式、故事讲述者、简洁知识卡片）和一个自定义档位。风格只影响措辞、句式、节奏、称呼、开场和最终标题，不会改变事实、知识边界、章节顺序和必须解释的关键概念。

`POST /api/articles/{id}/content/generate` 的 `styleProfile` 既接受完整 profile，也接受 `{ "preset": "knowledge_cards", "customInstructions": "一句一条" }` 这种简写——只给 `preset` 时由服务端按预设补齐其余派生字段。

## 长度档位与版本

- 长度档位 `short` / `standard` / `deep` 决定推荐总字数，审核会检查是否明显过短、冗长或重复。
- 大纲版本和正文版本独立编号，互不影响。
- 生成、审核前内容变化和主动保存都会创建去重后的不可变版本；恢复旧版本产生新版本，历史永不移动。
- 大纲变化后旧正文仍然保留，但会标记为"基于旧大纲"，此时不能审核、确认内容或产出新的配图计划。

## Provider 设置面板

顶栏「设置」进入 `/settings`，统一管理 LLM 网关与图片生成的 provider 配置：

- **双层配置**：`env/.env.local` 是默认层；面板保存的配置写入 `app_settings` 表（key = `provider_overrides`），保存后立即生效（服务端会重置全部适配器单例），无需重启。某项来源显示「环境变量」表示该项仍由环境文件生效，「面板配置」表示已被面板接管，可用「恢复环境变量默认」回落。
- **LLM 网关卡**：服务地址、API Key、默认模型、补充模型列表，以及资料搜集 / 审核 / 配图规划 / 看图四个模型分工（留空回落默认模型）。「测试连接」会请求网关的 `/v1/models` 并把发现的模型填充到各模型输入框的建议列表。
- **图片生成卡**：主站三键 + 任意数量的额外生图站点（对应 `IMAGE2_/IMAGE3_/…` 键族）；未配置生图时配图生成按钮会提示无法生成。
- **密钥安全**：界面上 API Key 只显示「••••+尾4位」掩码；保存时提交掩码表示沿用已保存的真值（面板没保存过则回落 env 真值），GET 响应永不包含明文。
- **并发约束**：保存带 `expectedUpdatedAt`（覆盖行的 `updatedAt`），冲突返回 409 提示刷新。

## 验证

```powershell
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
```

端到端测试默认使用系统已安装的 Chrome，覆盖桌面和移动两个视口：

- `tests/e2e/foundation-flow.spec.ts`：建文章 → 加资料 → 生成并确认大纲，落到第 3 步。
- `tests/e2e/outline-workflow.spec.ts`：大纲生成 / 审核 / 版本 / 确认。
- `tests/e2e/content-workflow.spec.ts`：风格选择、正文生成 / 审核 / 确认内容、版本保存与恢复、配图与预览、移动端只读。
- `tests/e2e/article-workflow.spec.ts`：确认大纲后在四步工作台内推进到配图。

E2E 跑在 `next dev` 上，首次访问某个路由需要现编译，因此 `playwright.config.ts` 的等待上限比默认值宽松。

## 当前边界

- 支持粘贴纯文本和 Markdown 资料；资料可以添加、启停和删除。
- 网页、PDF 和 DOCX 资料会保存为"暂不支持"，不会进入生成上下文。
- 本地 `/api/image-assets/:id/content` 占位 URL 只用于规划预览；「推送到草稿箱」会在服务端自动把正文图上传为微信素材（uploadimg ≤1MB 自动压缩）并替换为 mmbiz.qpic.cn 地址。
- `POST /api/articles/{id}/generate` 是阶段 1 遗留端点，已退役：固定返回 `410` 和 `{"error":"请使用分阶段纲要与正文生成接口"}`，不再生成 Demo 全文；工作台只通过 `POST /api/articles/{id}/content/generate` 生成正文，只有一个正文生成入口。
- 登录鉴权尚未启用，只适合本机单人使用。
- 文件上传、网页抓取和 PDF/DOCX 解析不在当前阶段范围；真实图片生成与公众号草稿箱推送已接入（分别需要 IMAGE_API_KEY 与 WECHAT_APPID/WECHAT_APPSECRET）。生图支持第二站点（IMAGE2_BASE_URL/IMAGE2_API_KEY/IMAGE2_MODEL），配图面板「生图模型」下拉聚合各站模型目录（GET /api/image-models），生成时按模型归属自动路由站点，上游错误详情会透传到界面便于换模型重试。
- 公众号预览使用经过转义的内联样式 HTML；仍需在已登录的微信公众号编辑器中完成一次人工粘贴验收。

## 模块边界

- `src/features/articles`：文章领域模型和 SQLite 仓储。
- `src/features/outlines`：大纲生成/审核 Agent、用例和不可变大纲版本仓储。
- `src/features/content`：人物语言风格、正文生成/审核 Agent、正文用例和不可变正文版本仓储。
- `src/features/sources`：资料领域模型、解析端口和 SQLite 仓储。
- `src/features/publishing`：公众号主题、共享 HTML 渲染器与草稿箱推送（port + 官方 API 适配器）。
- `src/features/style-library`：视觉风格库（style-lab 提炼结果导入），配图规划时注入绘制风格。
- `src/app/api`：经过 Zod 校验的 HTTP 边界。
- `src/components`：列表、编辑器、生成控制、审核面板和公众号预览。
- `tests/helpers/run-e2e.mjs`：启动测试服务器、运行 Playwright，并按已知进程 ID 回收服务。
