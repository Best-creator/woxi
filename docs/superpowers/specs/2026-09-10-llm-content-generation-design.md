# LLM 两阶段内容生成、审核与版本历史设计

## 目标

把当前固定模板正文生成升级为可配置的 OpenAI 兼容 LLM 工作流，并将纲要与正文拆成两个独立页面。知识结构先生成、审核和确认；正文随后结合人物语言风格生成，并接受独立审核。

首版实现以下闭环：

1. 生成 Knowledge Brief 和大纲；
2. 审核大纲是否适合零基础读者；
3. 人工修改并确认大纲；
4. 选择人物语言风格并生成完整正文；
5. 审核正文的清晰度、连贯性、吸引力与资料一致性；
6. 保留大纲和正文的 v1、v2 等完整版本，支持查看与恢复。

真实图片生成和外部知识检索不属于本阶段。

## 页面与导航

### 纲要工作台

路径：

```text
/articles/{id}/outline
```

页面负责：

- 编辑知识点和管理现有参考资料；
- 选择文章长度档位和 LLM 模型；
- 生成 Knowledge Brief、大纲、全文推荐字数和各章节推荐字数；
- 编辑 Brief 和大纲；
- 运行独立大纲审核；
- 查看和恢复大纲版本；
- 确认大纲并进入正文工作台。

进入正文工作台的条件：

- 大纲已生成；
- 当前大纲版本已经审核；
- 审核为 `passed` 时可直接确认；
- 审核为 `needs_revision` 时允许用户显式忽略警告并确认；
- 审核为 `blocked` 时必须修改并重新审核。

### 正文工作台

路径：

```text
/articles/{id}/content
```

页面负责：

- 展示当前确认的大纲和章节字数建议；
- 选择 LLM 模型；
- 选择预设人物语言风格并补充自定义描述；
- 根据确认大纲一次生成完整正文；
- 编辑结构化正文块；
- 运行独立正文审核；
- 查看审核问题并定位到关联正文块；
- 查看和恢复正文版本；
- 公众号预览；
- 承接后续配图规划和发布能力。

直接访问正文路径但没有已确认大纲时，服务端重定向到纲要工作台。

### 兼容旧路径

```text
/articles/{id}
```

旧路径按文章状态重定向：大纲未确认时进入纲要工作台，大纲已确认时进入正文工作台。现有书签和文章列表链接继续有效。

## 生成与审核流程

```text
知识点与可选资料
  -> 生成 Brief 和大纲
  -> 大纲审核
  -> 人工修改、重新审核和确认
  -> 选择人物语言风格
  -> 一次生成完整正文
  -> 正文审核
  -> 人工修订和重新审核
  -> 配图与发布
```

大纲审核和正文审核是独立 LLM 调用，不让生成调用在同一次响应中自我评价。首版审核提供诊断和建议，不自动覆盖用户内容。

## 模型配置与选择

新增 `LLM_MODELS` 环境变量，使用逗号分隔的模型名称：

```env
LLM_BASE_URL=https://yelan.xiaobupao.cn
LLM_API_KEY=
LLM_MODEL=grok-4.6
LLM_MODELS=grok-4.6,gpt-5.6-terra
```

规则：

- `LLM_API_KEY` 为空时外部 Provider 不启用，保留 Demo 生成能力供离线开发和自动测试使用；
- 配置 Key 后必须同时配置 `LLM_MODEL`；
- 可用模型为 `LLM_MODELS` 中去重后的非空值，并始终包含默认的 `LLM_MODEL`；
- 浏览器只接收模型名称和默认模型，不接收 API Key 或 Provider 地址；
- 每次生成和审核请求携带当前选择的模型；
- 服务端校验所选模型必须属于可用模型白名单，缺省时使用默认模型。

LLM 调用使用已实际验证可用的地址：

```text
POST {LLM_BASE_URL}/v1/chat/completions
```

请求使用 `stream: false` 和 JSON response format。长文生成与审核使用独立超时配置，超时、鉴权、上游失败和无效响应均返回明确错误。

## 长度策略

用户在纲要工作台选择一个长度档位：

| 档位 | 推荐字数范围 |
| --- | ---: |
| 短篇 | 800-1200 字 |
| 标准 | 1000-1500 字 |
| 深度 | 1500-2000 字 |

大纲 Agent 在所选范围内返回 `recommendedTotalWords`，并为每个章节返回 `recommendedWords`。各章节推荐字数之和应接近全文推荐字数。

推荐字数是质量约束而非机械填充目标。正文 Prompt 要求优先讲清楚，禁止通过重复、空泛总结或无关案例凑字数。正文审核同时检查内容是否明显过短、冗长或重复。

首版不接入百度或其他外部检索 API。现有资料仍作为可选生成上下文；未提供资料时允许生成，但在 `unsupportedNotes` 中明确提示事实需要人工核验。外部检索、来源引用和事实查证在后续阶段设计。

## 人物语言风格

人物语言风格仅作用于正文生成和正文风格审核，不参与知识纲要生成和大纲审核。知识结构与表达风格保持解耦。

首版提供预设：

- 通俗科普老师；
- 理性分析者；
- 朋友聊天式；
- 故事讲述者；
- 简洁知识卡片；
- 自定义。

传给正文生成器的 `styleProfile` 包含：

```json
{
  "preset": "popular_science_teacher",
  "persona": "善于用生活案例讲知识的科普老师",
  "tone": "亲切、自然、有耐心",
  "readerAddress": "你",
  "sentenceStyle": "短句为主，避免连续长段落",
  "explanationStyle": "先场景，再解释，再给出概念名称",
  "humorLevel": "light",
  "questionFrequency": "moderate",
  "contentDensity": "medium",
  "customInstructions": "",
  "avoid": ["说教口吻", "堆砌专业术语", "空泛鸡汤", "夸张结论"]
}
```

风格可以影响开头、措辞、句式、案例表达、节奏、称呼、幽默程度和最终标题，但不能改变事实、知识边界、确认后的章节顺序和必须解释的关键概念。

## LLM 契约

### 生成 Brief 与大纲

输入包含：

```json
{
  "topic": "机会成本",
  "targetAudience": "对该知识点零基础的普通读者",
  "lengthPreset": "standard",
  "wordRange": { "min": 1000, "max": 1500 },
  "sourceContext": "可选的现有资料"
}
```

LLM 只返回 JSON：

```json
{
  "workingTitle": "机会成本：每次选择背后，你真正放弃了什么",
  "recommendedTotalWords": 1300,
  "brief": {
    "oneSentence": "机会成本是做出选择时，放弃的最佳替代方案的价值。",
    "concepts": ["选择", "稀缺性", "最佳替代方案"],
    "prerequisites": ["理解时间和金钱都是有限的"],
    "misconceptions": ["机会成本不等于实际花出去的钱"],
    "analogies": ["周末选择加班，就放弃了休息或陪伴家人的时间"],
    "unsupportedNotes": []
  },
  "outline": [
    {
      "key": "definition",
      "title": "机会成本到底是什么",
      "goal": "用生活场景建立直观定义",
      "recommendedWords": 300
    }
  ]
}
```

服务端校验标题、Brief、章节 key 唯一性、章节数量、推荐字数和长度上限，然后生成持久化 ID、顺序和版本信息。模型不生成数据库 ID。

### 大纲审核

审核输入包含主题、目标读者、长度约束、现有资料、Brief 和完整大纲。审核维度包括：

- 核心知识是否覆盖完整；
- 拆分是否足够细；
- 顺序是否符合零基础读者的认知过程；
- 是否出现未解释术语或隐藏前置知识；
- 是否牵扯其他复杂知识点，以及应简要解释、单独拆章还是明确不展开；
- 是否存在重复、跨度过大、偏题或资料无法支持的章节；
- 推荐字数分配是否合理。

返回：

```json
{
  "status": "needs_revision",
  "score": 72,
  "summary": "整体方向正确，但需要先解释稀缺性。",
  "dimensions": {
    "coverage": 80,
    "granularity": 65,
    "beginnerFriendly": 60,
    "logicalOrder": 85,
    "sourceSupport": 70
  },
  "issues": [
    {
      "severity": "blocking",
      "category": "hidden_prerequisite",
      "sectionKey": "mechanism",
      "message": "直接使用了稀缺性概念，但此前没有解释。",
      "suggestion": "在机制章节前增加一小节解释稀缺性。"
    }
  ],
  "complexDependencies": [
    {
      "concept": "边际收益",
      "necessity": "optional",
      "handling": "本文不展开，只说明需要比较不同选择的价值。"
    }
  ]
}
```

审核状态只能是 `passed`、`needs_revision` 或 `blocked`。没有参考资料时，`sourceSupport` 返回 `null`，界面显示“未检查”，不得用模型自信度代替资料支持度。

### 生成完整正文

正文输入使用当前确认的大纲版本：

```json
{
  "topic": "机会成本",
  "targetAudience": "对该知识点零基础的普通读者",
  "sourceContext": "可选的现有资料",
  "brief": {},
  "outline": [],
  "recommendedTotalWords": 1300,
  "styleProfile": {}
}
```

正文必须整篇一次生成，使模型同时看到所有章节目标并处理章节衔接。LLM 返回：

```json
{
  "title": "机会成本：每次选择背后，你真正放弃了什么",
  "blocks": [
    {
      "sectionKey": "definition",
      "type": "heading",
      "content": "机会成本到底是什么？",
      "level": 2
    },
    {
      "sectionKey": "definition",
      "type": "paragraph",
      "content": "简单说，当你选择一件事时……"
    }
  ]
}
```

允许的块类型为 `heading`、`paragraph`、`quote`、`callout` 和 `knowledge_card`。图片块由后续配图流程负责。服务端校验所有 `sectionKey` 均存在，随后生成 UUID、`order`、`version` 和持久化 `sectionId`。

### 正文审核

审核输入包含主题、目标读者、资料、Brief、确认的大纲、人物风格和全部正文块。审核检查：

- 是否真正解释清楚定义、机制、案例与边界；
- 零基础读者能否理解，是否存在未解释术语或推理跳跃；
- 章节和段落是否连贯，是否重复、矛盾或偏题；
- 开头、节奏、案例和段落长度是否有利于持续阅读；
- 是否覆盖大纲目标并符合推荐字数；
- 是否忠于现有资料；没有外部检索时不宣称完成事实查证；
- 表达是否符合所选人物语言风格。

返回：

```json
{
  "status": "needs_revision",
  "score": 76,
  "summary": "整体逻辑完整，但机制部分对零基础读者跳跃较大。",
  "dimensions": {
    "clarity": 72,
    "beginnerFriendly": 68,
    "coherence": 85,
    "engagement": 70,
    "outlineCoverage": 90,
    "sourceFidelity": 80,
    "styleMatch": 88
  },
  "issues": [
    {
      "severity": "blocking",
      "category": "unexplained_concept",
      "blockIds": ["block-5", "block-6"],
      "message": "直接使用了边际收益，但此前没有解释。",
      "suggestion": "先用多吃一个包子的收益变化解释边际概念。"
    }
  ]
}
```

正文审核同样使用 `passed`、`needs_revision` 和 `blocked`。`blocked` 阻止标记为内容就绪；`needs_revision` 允许用户显式忽略警告继续。通过或显式忽略警告后，文章进入 `content_ready`，而不是 `ready_to_publish`；后者保留给配图和发布条件全部满足后的后续流程。没有参考资料时，`sourceFidelity` 返回 `null`。

## 版本历史

大纲和正文使用独立版本序列：大纲 v1、v2 与正文 v1、v2 分别编号和展示。

### 创建版本的时机

- AI 生成大纲后；
- 审核前当前大纲与最近版本不同；
- 用户确认大纲时；
- AI 生成正文后；
- 审核前当前正文与最近版本不同；
- 后续 AI 修订正文时；
- 用户主动点击“保存版本”时。

普通自动保存只更新当前工作草稿，不创建版本，避免每次输入都产生历史记录。

创建版本前计算规范化内容的 SHA-256。若同类型最近版本的内容哈希相同，不重复创建版本；确认操作直接引用并标记该现有版本。版本号只在实际产生新快照时递增。

### 存储方式

新增统一的不可变修订表，修订类型为 `outline` 或 `content`。每条修订保存完整 JSON 快照，而不是差异：

- 大纲修订保存标题、Brief、大纲、长度档位、推荐字数、生成时使用的完整资料上下文快照、模型和创建原因；
- 正文修订保存标题、非图片正文块、所依赖的大纲修订 ID、人物风格、模型和创建原因；图片资产及其引用块继续由独立图片仓储管理；
- 审核记录独立保存并引用被审核的修订 ID、审核模型和结构化结果。

每条修订保存 `contentHash`。审核只对其引用的不可变修订有效。当前草稿和当前启用资料的规范化内容哈希与被审核修订不同时，页面立即显示“审核已过期”；修改、启停或删除资料同样会使审核失效。再次审核前先为当前草稿创建新修订。正文哈希忽略 `image` 块，因此配图规划和图片状态变化不会让正文审核失效。

### 恢复规则

恢复旧版本时，将其快照复制到当前工作草稿，并创建一个原因标记为 `restored` 的新版本。恢复不会移动或删除历史。例如从正文 v3 恢复 v1，会产生正文 v4，v2 和 v3 仍可查看。

正文修订必须引用一个大纲修订。正文生成后如果用户返回纲要工作台修改并确认新大纲：

- 旧正文版本全部保留；
- 当前正文标记为“基于旧大纲”；
- 旧正文仍可查看，但不能以当前大纲的审核结果标记为可发布；
- 用户进入正文工作台后需要基于新大纲重新生成或显式恢复匹配的旧大纲。

## 数据兼容性

`OutlineSection` 增加可选 `goal` 和 `recommendedWords`，`ContentBlock` 增加可选 `sectionId`；旧文章没有这些字段时仍然有效。

文章当前工作草稿增加以下规划元数据：长度档位、全文推荐字数、人物风格、确认的大纲修订 ID，以及当前正文所依赖的大纲修订 ID。现有 `articles` 表继续保存当前工作草稿，新增字段通过幂等迁移或兼容 JSON 列承载。

新增修订和审核表，通过幂等迁移创建，不重写已有文章。首次打开旧文章时，根据现有状态路由；在第一次生成、审核、确认或主动保存版本时创建历史快照。

文章状态保留对旧值的读取兼容，并映射到新流程：未确认大纲为纲要阶段，已确认大纲为正文阶段。审核是否有效不只依赖文章状态，而由当前草稿内容与审核目标修订是否一致决定。

## API 边界

端点拆分为：

```text
POST /api/articles/{id}/outline/generate
POST /api/articles/{id}/outline/review
POST /api/articles/{id}/outline/confirm
GET  /api/articles/{id}/outline/versions
POST /api/articles/{id}/outline/versions
POST /api/articles/{id}/outline/versions/{versionId}/restore

POST /api/articles/{id}/content/generate
POST /api/articles/{id}/content/review
POST /api/articles/{id}/content/approve
GET  /api/articles/{id}/content/versions
POST /api/articles/{id}/content/versions
POST /api/articles/{id}/content/versions/{versionId}/restore
```

所有写操作携带 `expectedUpdatedAt`，沿用现有乐观并发控制。生成和审核先完成 LLM 调用与完整校验，再在单个事务中保存，不写入半成品。

## 错误与安全

- API Key 只在服务端读取，不通过 props、接口响应或客户端 bundle 暴露；
- 所选模型必须通过服务端白名单校验；
- LLM 返回统一经过 Zod 校验，并限制字符串、数组、章节数、正文块数和总响应大小；
- 非法 JSON、章节引用不存在、内容为空、超时、鉴权和上游错误均返回可识别错误；
- 失败时保留当前草稿和版本历史；
- 版本恢复和确认操作使用事务及乐观并发控制；
- 审核分数是辅助判断，不代表事实已经被外部查证。

## 首版边界

首版包含诊断、定位和人工修改，不实现审核建议自动覆盖正文。后续可增加：

- 逐条应用修改建议；
- 根据全部建议生成候选修订版；
- 两个版本的可视化差异比较；
- 百度或其他检索 API；
- 来源引用和事实查证；
- 单章节重写；
- 真实图片生成。

## 测试范围

- 配置解析：模型列表去重、默认模型自动加入、无 Key 时禁用 Provider；
- 纲要生成：请求地址、Prompt 输入、模型覆盖、结构化响应转换和推荐字数校验；
- 大纲审核：三种状态、问题章节引用、失效规则和确认门禁；
- 正文生成：只接受已确认大纲、人物风格传递、章节关联、块转换和全文一次生成；
- 正文审核：问题块引用、三种状态、发布门禁和失效规则；
- 错误路径：无效 JSON、超时、认证、上游错误和不保存半成品；
- 版本历史：独立编号、自动保存不建版本、审核前快照、恢复产生新版本、旧版本不丢失；
- 大纲变更：旧正文保留但标记过期；
- 页面与导航：旧路径重定向、正文页面门禁、模型下拉框、长度档位和人物风格控件；
- 回归验证：Vitest、ESLint、Next.js build 和关键 Playwright 流程。
