import { z } from "zod";
import type { Article } from "@/features/articles/domain";
import type { SourceDocument } from "@/features/sources/domain";
import type { SourceMutationResult } from "@/features/sources/sqlite-workflow";
import { ResearchError } from "./errors";
import type { WebSearchPort } from "./types";

/** 与 OpenAiJsonClient.complete 兼容的最小结构，便于测试替换。 */
export interface WebResearchLlmClient {
  complete<T>(request: {
    model?: string;
    systemPrompt: string;
    userPayload: unknown;
    schema: z.ZodType<T>;
    timeoutMs: number;
  }): Promise<T>;
}

export interface SourceWorkflowPort {
  create(
    articleId: string,
    expectedUpdatedAt: string,
    input: { title: string; type: "web"; content: string }
  ): Promise<SourceMutationResult>;
}

export interface CollectWebResearchInput {
  articleId: string;
  expectedUpdatedAt: string;
  model?: string;
}

export interface CollectWebResearchDependencies {
  articles: { findById(id: string): Promise<Article | null> };
  workflow: SourceWorkflowPort;
  webSearch: WebSearchPort;
  llm?: WebResearchLlmClient | null;
  defaultModel?: string;
}

export type CollectWebResearchResult =
  | { kind: "saved"; article: Article; source: SourceDocument; queries: string[]; resultCount: number }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "error"; code: "search_unavailable"; message: string };

const queriesSchema = z.object({
  queries: z.array(z.string().trim().min(1).max(30)).min(1).max(4)
});

const reportSchema = z.object({
  markdown: z.string().trim().min(1)
});

const QUERY_SYSTEM_PROMPT = [
  "你是资料搜集助手。用户要创作一篇讲解某个知识点的微信公众号图文，",
  "需要先通过搜索引擎收集资料。",
  "请根据知识点生成 2 到 3 个搜索查询词：",
  "- 每个查询词不超过 12 个字，用中文关键词，不要整句",
  "- 从不同角度覆盖该知识点（定义原理、常见误区、实际应用等）",
  '- 以 JSON 对象返回，格式：{"queries":["查询词1","查询词2"]}',
  "只返回 JSON，不要其他内容。"
].join("\n");

const REPORT_SYSTEM_PROMPT = [
  "你是资料整理助手。下面给出针对某个知识点联网搜索到的结果",
  "（标题、摘要与链接）。请把它们整理成一篇供后续写作使用的中文资料，",
  "使用 Markdown，包含以下小节：",
  "## 概述（2-3 句概括该知识点）",
  "## 关键事实（逐条列出，在句末用 [编号] 标注来源）",
  "## 常见疑问与澄清（如搜索结果中有相关内容）",
  "## 参考来源（编号列表：标题 + URL）",
  "要求：只依据给定的搜索结果整理，不要编造事实；",
  "如果搜索结果与知识点无关或信息不足，在概述中如实说明。",
  '- 以 JSON 对象返回，格式：{"markdown":"整理后的 Markdown 全文"}',
  "只返回 JSON，不要其他内容。"
].join("\n");

function formatRawResults(topic: string, results: { title: string; url: string; snippet: string }[], queries: string[]) {
  const lines = [
    `# 联网搜索资料：${topic}`,
    "",
    `> 由搜索查询 ${queries.map((q) => `「${q}」`).join("、")} 得到 ${results.length} 条结果，未经模型整理。`,
    ""
  ];
  results.forEach((result, index) => {
    lines.push(`## ${index + 1}. ${result.title}`);
    if (result.snippet) lines.push(result.snippet);
    lines.push(`来源：${result.url}`);
    lines.push("");
  });
  return lines.join("\n");
}

function dedupeResults(results: { title: string; url: string; snippet: string }[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = result.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectQueries(
  dependencies: CollectWebResearchDependencies,
  topic: string,
  model: string | undefined
): Promise<string[]> {
  if (!dependencies.llm) return [topic.slice(0, 20)];
  try {
    const parsed = await dependencies.llm.complete({
      model: model ?? dependencies.defaultModel,
      systemPrompt: QUERY_SYSTEM_PROMPT,
      userPayload: { topic },
      schema: queriesSchema,
      timeoutMs: 60_000
    });
    const queries = parsed.queries.map((q) => q.slice(0, 20)).filter(Boolean);
    return queries.length ? queries.slice(0, 3) : [topic.slice(0, 20)];
  } catch {
    // 查询生成失败不阻塞：退回直接用知识点本身搜索。
    return [topic.slice(0, 20)];
  }
}

async function collectResults(
  dependencies: CollectWebResearchDependencies,
  queries: string[]
) {
  const collected: { title: string; url: string; snippet: string }[] = [];
  let lastFailure: unknown = null;
  for (const query of queries) {
    try {
      const results = await dependencies.webSearch.search(query, 8);
      collected.push(...results);
    } catch (error) {
      lastFailure = error;
    }
    if (collected.length >= 12) break;
  }
  const results = dedupeResults(collected).slice(0, 12);
  if (!results.length) {
    throw new ResearchError(
      "search_unavailable",
      lastFailure instanceof ResearchError
        ? lastFailure.message
        : "联网搜索没有返回可用结果，请稍后重试。"
    );
  }
  return results;
}

async function summarize(
  dependencies: CollectWebResearchDependencies,
  topic: string,
  model: string | undefined,
  queries: string[],
  results: { title: string; url: string; snippet: string }[]
): Promise<string> {
  if (!dependencies.llm) return formatRawResults(topic, results, queries);
  try {
    const parsed = await dependencies.llm.complete({
      model: model ?? dependencies.defaultModel,
      systemPrompt: REPORT_SYSTEM_PROMPT,
      userPayload: { topic, queries, results },
      schema: reportSchema,
      timeoutMs: 180_000
    });
    return parsed.markdown;
  } catch {
    // 模型整理失败时保底输出原始搜索结果，资料仍然可用。
    return formatRawResults(topic, results, queries);
  }
}

export async function collectWebResearch(
  input: CollectWebResearchInput,
  dependencies: CollectWebResearchDependencies
): Promise<CollectWebResearchResult> {
  const article = await dependencies.articles.findById(input.articleId);
  if (!article) return { kind: "not_found" };

  const queries = await collectQueries(dependencies, article.topic, input.model);
  let results: Awaited<ReturnType<typeof collectResults>>;
  try {
    results = await collectResults(dependencies, queries);
  } catch (error) {
    if (error instanceof ResearchError) {
      return { kind: "error", code: "search_unavailable", message: error.message };
    }
    throw error;
  }
  const markdown = await summarize(dependencies, article.topic, input.model, queries, results);

  const saved = await dependencies.workflow.create(input.articleId, input.expectedUpdatedAt, {
    title: `AI 联网资料：${article.topic.slice(0, 40)}`,
    type: "web",
    content: markdown
  });
  if (saved.kind === "not_found") return { kind: "not_found" };
  if (saved.kind === "conflict") return { kind: "conflict" };
  if (saved.kind !== "saved" || !saved.source) return { kind: "not_found" };

  return {
    kind: "saved",
    article: saved.article,
    source: saved.source,
    queries,
    resultCount: results.length
  };
}
