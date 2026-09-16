import { randomUUID } from "node:crypto";
import type { Article, BlockType, ContentBlock } from "@/features/articles/domain";
import type { ArticleRepository } from "@/features/articles/repository";
import type { SourceRepository } from "@/features/sources/repository";
import { readySourceContext } from "@/features/outlines/generate-outline";
import type { ArticleRevision, ContentRevisionSnapshot } from "@/features/revisions/domain";
import { describeAudience } from "./audience";
import type { ContentGenerator } from "./ports";
import { resolveContentModel } from "./model";
import type { StyleProfile } from "./style-profile";
import type { ContentWorkflowRepository } from "./workflow-repository";

export interface GenerateContentCommand {
  articleId: string;
  expectedUpdatedAt: string;
  model?: string;
  styleProfile: StyleProfile;
}

export interface GenerateContentDependencies {
  articles: ArticleRepository;
  sources: SourceRepository;
  generator: ContentGenerator;
  workflow: ContentWorkflowRepository;
  defaultModel?: string;
}

export type GenerateContentResult =
  | { kind: "generated"; article: Article; revision: ArticleRevision<ContentRevisionSnapshot> }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "not_ready" }
  | { kind: "generator_error"; message: string }
  | { kind: "save_error"; message: string };

/** 正文生成的块类型白名单；图片由独立配图流程负责，callout（提示）已停止生成。 */
const ALLOWED_BLOCK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  "heading",
  "paragraph",
  "quote",
  "knowledge_card"
]);

function toContentBlocks(
  generatedBlocks: Awaited<ReturnType<ContentGenerator["generate"]>>["blocks"],
  sectionIds: ReadonlySet<string>
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const block of generatedBlocks) {
    if (!ALLOWED_BLOCK_TYPES.has(block.type)) {
      throw new Error(`正文生成返回了不被允许的块类型：${block.type}`);
    }
    if (!sectionIds.has(block.sectionKey)) {
      throw new Error("正文生成引用了未知章节");
    }
    const level = block.type === "heading" ? block.level ?? 2 : undefined;
    blocks.push({
      id: randomUUID(),
      type: block.type,
      content: block.content,
      order: blocks.length,
      ...(level ? { level } : {}),
      version: 1
    });
  }
  if (!blocks.length) throw new Error("正文生成结果为空");
  return blocks;
}

export function contentIsReady(article: Article): boolean {
  return Boolean(
    article.brief &&
    article.outline.length > 0 &&
    article.outlineConfirmedAt &&
    article.planning.confirmedOutlineRevisionId &&
    article.planning.recommendedTotalWords !== null
  );
}

export async function generateContent(
  command: GenerateContentCommand,
  dependencies: GenerateContentDependencies
): Promise<GenerateContentResult> {
  const article = await dependencies.articles.findById(command.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== command.expectedUpdatedAt) return { kind: "conflict" };
  if (!contentIsReady(article) || !article.brief) return { kind: "not_ready" };

  const sourceContext = readySourceContext(await dependencies.sources.list(article.id));
  const model = resolveContentModel(command.model, dependencies.defaultModel);
  let textBlocks: ContentBlock[];
  let title: string;
  try {
    // 受众跟着提交上来的风格走（用户可能刚在界面上改过），不是文章里存的旧值。
    const generated = await dependencies.generator.generate({
      topic: article.topic,
      targetAudience: describeAudience(command.styleProfile.audience),
      brief: article.brief,
      outline: article.outline.map((section) => ({
        id: section.id,
        title: section.title,
        ...(section.goal ? { goal: section.goal } : {}),
        ...(section.recommendedWords ? { recommendedWords: section.recommendedWords } : {}),
        order: section.order
      })),
      recommendedTotalWords: article.planning.recommendedTotalWords as number,
      styleProfile: command.styleProfile,
      ...(sourceContext ? { sourceContext } : {}),
      model
    });
    textBlocks = toContentBlocks(generated.blocks, new Set(article.outline.map((section) => section.id)));
    // 生成器给出的「最终标题」才是成稿标题；为空时保留原标题，避免把标题清空。
    title = generated.title.trim() || article.title;
  } catch (error) {
    return {
      kind: "generator_error",
      message: error instanceof Error ? error.message : "正文生成失败，请稍后重试"
    };
  }

  const saved = await dependencies.workflow.saveGeneratedContent({
    articleId: article.id,
    expectedUpdatedAt: command.expectedUpdatedAt,
    model,
    title,
    textBlocks,
    styleProfile: command.styleProfile,
    sourceContextSnapshot: sourceContext
  });
  if (saved.kind === "saved") return { kind: "generated", article: saved.article, revision: saved.revision };
  if (saved.kind === "conflict") return { kind: "conflict" };
  return { kind: "save_error", message: "保存正文失败，请刷新后重试" };
}
