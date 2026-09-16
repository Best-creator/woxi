import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { parseStyleProfileJson } from "@/features/content/style-profile";
import {
  DEFAULT_ARTICLE_PLANNING,
  type Article,
  type ArticlePlanning,
  type ArticleStatus,
  type ContentBlock,
  type KnowledgeBrief,
  type OutlineSection,
  type StoryboardSegment
} from "@/features/articles/domain";
import type {
  ImageAsset,
  ImageGeneration,
  ImageLibraryItem,
  ImagePlanSuggestion
} from "./domain";
import { imageContentUrl, mergeImageBlocks } from "./merge-image-blocks";
import { restoreConsumedBlocks } from "./consumed-content";
import type { ComicStripModeDecision } from "./comic-strip-mode-router";
import { parseImageAssetRow as parseAsset, type ImageAssetRow } from "./asset-row";
import type {
  CompleteGenerationInput,
  ImageAssetPatch,
  ImageAssetRepository,
  ImageGenerationMutationResult,
  ImagePlanMutationResult,
  SaveComicStripInput,
  StoryboardPlanMutationResult,
  StoryboardSegmentPlan
} from "./repository";

interface ArticleRow {
  id: string;
  title: string;
  topic: string;
  status: ArticleStatus;
  brief_json: string | null;
  outline_json: string;
  blocks_json: string;
  planning_json: string | null;
  style_json: string | null;
  outline_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ImageGenerationRow {
  id: string;
  article_id: string;
  asset_id: string;
  prompt: string;
  model: string | null;
  file_path: string | null;
  public_url: string | null;
  selected: number;
  created_at: string;
}

/** 素材库查询：版本行 + 所属配图的类型/用途（用于标明「这张原本是给哪一段的」）。 */
interface ImageLibraryRow extends ImageGenerationRow {
  asset_type: ImageAsset["type"];
  asset_purpose: string;
}

/** 两类变更结果的公共形状，用于让事务包装器同时服务配图与版本两种操作。 */
type AnyImageMutationResult =
  | ImagePlanMutationResult
  | ImageGenerationMutationResult
  | StoryboardPlanMutationResult;

class AbortMutation extends Error {
  constructor(readonly result: AnyImageMutationResult) {
    super(result.kind);
  }
}

function parsePlanning(planningJson: string | null): ArticlePlanning {
  return planningJson
    ? (JSON.parse(planningJson) as ArticlePlanning)
    : { ...DEFAULT_ARTICLE_PLANNING };
}

function parseArticle(row: ArticleRow): Article {
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    status: row.status,
    brief: row.brief_json ? (JSON.parse(row.brief_json) as KnowledgeBrief) : null,
    outline: JSON.parse(row.outline_json) as OutlineSection[],
    blocks: JSON.parse(row.blocks_json) as ContentBlock[],
    planning: parsePlanning(row.planning_json),
    styleProfile: parseStyleProfileJson(row.style_json),
    outlineConfirmedAt: row.outline_confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function nextTimestamp(previous?: string) {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, previousTime + 1)).toISOString();
}

function parseGeneration(row: ImageGenerationRow): ImageGeneration {
  return {
    id: row.id,
    articleId: row.article_id,
    assetId: row.asset_id,
    prompt: row.prompt,
    model: row.model,
    filePath: row.file_path,
    publicUrl: row.public_url,
    selected: row.selected === 1,
    createdAt: row.created_at
  };
}

export class SqliteImageAssetRepository implements ImageAssetRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(articleId: string): Promise<ImageAsset[]> {
    return this.listSync(articleId);
  }

  async findById(articleId: string, assetId: string): Promise<ImageAsset | null> {
    const row = this.db
      .prepare("SELECT * FROM image_assets WHERE article_id = ? AND id = ?")
      .get(articleId, assetId) as unknown as ImageAssetRow | undefined;
    return row ? parseAsset(row) : null;
  }

  async findByAssetId(assetId: string): Promise<ImageAsset | null> {
    const row = this.db
      .prepare("SELECT * FROM image_assets WHERE id = ?")
      .get(assetId) as unknown as ImageAssetRow | undefined;
    return row ? parseAsset(row) : null;
  }

  async listGenerations(articleId: string): Promise<ImageLibraryItem[]> {
    const rows = this.db
      .prepare(`
        SELECT g.*, a.type AS asset_type, a.purpose AS asset_purpose
        FROM image_asset_generations g
        JOIN image_assets a ON a.id = g.asset_id
        WHERE g.article_id = ?
        ORDER BY g.created_at DESC, g.rowid DESC
      `)
      .all(articleId) as unknown as ImageLibraryRow[];
    return rows.map((row) => ({
      ...parseGeneration(row),
      assetType: row.asset_type,
      assetPurpose: row.asset_purpose
    }));
  }

  async listGenerationsForAsset(articleId: string, assetId: string): Promise<ImageGeneration[]> {
    const rows = this.db
      .prepare(`
        SELECT * FROM image_asset_generations
        WHERE article_id = ? AND asset_id = ?
        ORDER BY created_at DESC, rowid DESC
      `)
      .all(articleId, assetId) as unknown as ImageGenerationRow[];
    return rows.map(parseGeneration);
  }

  async findGenerationById(generationId: string): Promise<ImageGeneration | null> {
    const row = this.db
      .prepare("SELECT * FROM image_asset_generations WHERE id = ?")
      .get(generationId) as unknown as ImageGenerationRow | undefined;
    return row ? parseGeneration(row) : null;
  }

  async applyPlan(
    articleId: string,
    expectedUpdatedAt: string,
    suggestions: ImagePlanSuggestion[],
    stripDecision?: ComicStripModeDecision | null
  ): Promise<ImagePlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      if (suggestions.length > 12) {
        return { kind: "invalid_plan", message: "图片计划最多支持 12 张图片" };
      }

      const anchors = new Set(
        article.blocks.filter((block) => block.type !== "image").map((block) => block.id)
      );
      for (const suggestion of suggestions) {
        if (suggestion.type === "cover" && suggestion.anchorBlockId !== null) {
          return { kind: "invalid_state", message: "封面不能关联正文锚点" };
        }
        if (suggestion.type !== "cover" && !anchors.has(suggestion.anchorBlockId ?? "")) {
          return { kind: "invalid_anchor", anchorBlockId: suggestion.anchorBlockId ?? "" };
        }
      }

      // 排法决策随规划落库（saveAggregate 只写 blocks_json，planning 单独写）。
      // 返回的 article 也带上新 planning，让界面与拼图阶段立即可见。
      let articleForSave = article;
      if (stripDecision) {
        const planning = {
          ...article.planning,
          comicStripMode: stripDecision.mode,
          comicStripReason: stripDecision.reason
        };
        articleForSave = { ...article, planning };
        this.db
          .prepare("UPDATE articles SET planning_json = ? WHERE id = ?")
          .run(JSON.stringify(planning), articleId);
      }

      const existing = this.listSync(articleId);
      const disposable = existing.filter(
        (asset) =>
          !asset.manuallyEdited &&
          (asset.status === "planned" || asset.status === "placeholder")
      );
      for (const asset of disposable) {
        this.db.prepare("DELETE FROM image_assets WHERE id = ?").run(asset.id);
      }

      let assetTimestamp = article.updatedAt;
      let position = this.nextPosition(articleId);
      for (const suggestion of suggestions) {
        assetTimestamp = nextTimestamp(assetTimestamp);
        const id = randomUUID();
        const asset: ImageAsset = {
          id,
          articleId,
          ...suggestion,
          status: "placeholder",
          placeholderUrl: imageContentUrl(id),
          filePath: null,
          publicUrl: null,
          manuallyEdited: false,
          consumedContent: null,
          createdAt: assetTimestamp,
          updatedAt: assetTimestamp
        };
        this.insertAsset(asset, position);
        position += 1;
      }

      const assets = this.listSync(articleId);
      return this.saveAggregate(
        articleForSave,
        expectedUpdatedAt,
        assets,
        disposable.map((asset) => asset.id)
      );
    });
  }

  async update(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string,
    patch: ImageAssetPatch
  ): Promise<ImagePlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      const asset = this.assetForArticle(articleId, assetId);
      if (!asset) return { kind: "not_found" };

      const hasAnchorPatch = Object.hasOwn(patch, "anchorBlockId");
      const proposedAnchor =
        patch.anchorBlockId === undefined ? asset.anchorBlockId : patch.anchorBlockId;
      if (asset.type === "cover" && proposedAnchor !== null) {
        return { kind: "invalid_state", message: "封面不能关联正文锚点" };
      }
      if (asset.type !== "cover") {
        if (!proposedAnchor) {
          return { kind: "invalid_state", message: "正文插图必须关联正文锚点" };
        }
        const validAnchors = new Set(
          article.blocks.filter((block) => block.type !== "image").map((block) => block.id)
        );
        if (!validAnchors.has(proposedAnchor)) {
          return { kind: "invalid_anchor", anchorBlockId: proposedAnchor };
        }
      }

      const contentEdited =
        Object.hasOwn(patch, "prompt") ||
        Object.hasOwn(patch, "altText") ||
        hasAnchorPatch ||
        Object.hasOwn(patch, "aspectRatio");
      const status =
        patch.enabled === false
          ? "disabled"
          : patch.enabled === true && asset.status === "disabled"
            ? "placeholder"
            : asset.status;
      const updated: ImageAsset = {
        ...asset,
        anchorBlockId: proposedAnchor,
        prompt: patch.prompt ?? asset.prompt,
        altText: patch.altText ?? asset.altText,
        aspectRatio: patch.aspectRatio ?? asset.aspectRatio,
        status,
        manuallyEdited: contentEdited ? true : asset.manuallyEdited,
        updatedAt: nextTimestamp(asset.updatedAt)
      };
      this.updateAsset(updated);
      return this.saveAggregate(article, expectedUpdatedAt, this.listSync(articleId));
    });
  }

  async remove(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImagePlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      if (!this.assetForArticle(articleId, assetId)) return { kind: "not_found" };

      this.db
        .prepare("DELETE FROM image_assets WHERE article_id = ? AND id = ?")
        .run(articleId, assetId);
      return this.saveAggregate(article, expectedUpdatedAt, this.listSync(articleId), [assetId]);
    });
  }

  async refreshPlaceholder(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImagePlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      const asset = this.assetForArticle(articleId, assetId);
      if (!asset) return { kind: "not_found" };
      if (asset.status === "disabled") {
        return { kind: "invalid_state", message: "禁用图片不能重建占位图" };
      }

      this.updateAsset({
        ...asset,
        status: "placeholder",
        updatedAt: nextTimestamp(asset.updatedAt)
      });
      return this.saveAggregate(article, expectedUpdatedAt, this.listSync(articleId));
    });
  }

  async beginGeneration(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImagePlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      const asset = this.assetForArticle(articleId, assetId);
      if (!asset) return { kind: "not_found" };
      if (asset.status === "disabled") {
        return { kind: "invalid_state", message: "禁用图片不能生成" };
      }
      if (asset.status === "generating") {
        return { kind: "invalid_state", message: "图片正在生成中" };
      }

      this.updateAsset({
        ...asset,
        status: "generating",
        updatedAt: nextTimestamp(asset.updatedAt)
      });
      return this.saveAggregate(article, expectedUpdatedAt, this.listSync(articleId));
    });
  }

  async completeGeneration(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string,
    result: CompleteGenerationInput
  ): Promise<ImagePlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      const asset = this.assetForArticle(articleId, assetId);
      if (!asset) return { kind: "not_found" };
      if (asset.status !== "generating") {
        return { kind: "invalid_state", message: "图片不在生成中，无法保存结果" };
      }

      const createdAt = nextTimestamp(asset.updatedAt);
      // 新版本一律置为使用中，旧的取消标记——重生成后看到的就该是新图。
      this.clearSelectedGeneration(assetId);
      this.insertGeneration({
        id: result.generationId,
        articleId,
        assetId,
        // 提示词取落库当刻的资产快照：下一版改了提示词，这一版的来历仍然可追溯。
        prompt: asset.prompt,
        model: result.model ?? null,
        filePath: result.filePath,
        publicUrl: result.publicUrl,
        selected: true,
        createdAt
      });
      this.updateAsset({
        ...asset,
        status: "generated",
        publicUrl: result.publicUrl,
        filePath: result.filePath,
        updatedAt: nextTimestamp(createdAt)
      });
      return this.saveAggregate(article, expectedUpdatedAt, this.listSync(articleId));
    });
  }

  async failGeneration(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImagePlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      const asset = this.assetForArticle(articleId, assetId);
      if (!asset) return { kind: "not_found" };
      if (asset.status !== "generating") {
        return { kind: "invalid_state", message: "图片不在生成中，无法记录失败" };
      }

      this.updateAsset({
        ...asset,
        status: "failed",
        updatedAt: nextTimestamp(asset.updatedAt)
      });
      return this.saveAggregate(article, expectedUpdatedAt, this.listSync(articleId));
    });
  }

  async selectGeneration(
    articleId: string,
    assetId: string,
    generationId: string,
    expectedUpdatedAt: string
  ): Promise<ImageGenerationMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      const asset = this.assetForArticle(articleId, assetId);
      if (!asset) return { kind: "not_found" };
      // 已停用的配图不能选用版本：否则 status 会被改成 generated，等于悄悄把它重新启用。
      if (asset.status === "disabled") {
        return { kind: "invalid_state", message: "已停用的配图不能选用生成版本，请先启用" };
      }

      const target = this.generationRowById(generationId);
      if (!target || target.article_id !== articleId) return { kind: "not_found" };
      const sourceAssetId = target.asset_id;

      // 跨槽位复用＝把这一版「挪」到目标配图上，而不是让两个槽位共享同一张图。
      // 共享引用会让删除无从判断文件还有没有人用，挪动则始终一图一主人，语义干净。
      if (sourceAssetId !== assetId) {
        this.db
          .prepare("UPDATE image_asset_generations SET asset_id = ? WHERE id = ?")
          .run(assetId, generationId);
      }

      this.clearSelectedGeneration(assetId);
      this.db
        .prepare("UPDATE image_asset_generations SET selected = 1 WHERE id = ?")
        .run(generationId);
      // 选用即把该版镜像到资产上：正文块、content 路由、发布链路都只看资产。
      this.updateAsset({
        ...asset,
        status: "generated",
        publicUrl: target.public_url,
        filePath: target.file_path,
        updatedAt: nextTimestamp(asset.updatedAt)
      });

      if (sourceAssetId !== assetId) {
        this.repairSourceAssetAfterMove(articleId, sourceAssetId, target.file_path);
      }
      return this.saveGenerationAggregate(
        article,
        expectedUpdatedAt,
        this.listSync(articleId),
        null
      );
    });
  }

  /**
   * 一版被挪走后，来源配图不能继续指向别人的图。
   * 挪走的正好是它的当前版本就回落剩下最新一版；一版不剩就退回待生成。
   */
  private repairSourceAssetAfterMove(
    articleId: string,
    sourceAssetId: string,
    movedFilePath: string | null
  ) {
    const sourceAsset = this.assetForArticle(articleId, sourceAssetId);
    if (!sourceAsset) return;
    const remaining = this.generationRowsForAsset(sourceAssetId);
    const fallback = remaining[0] ?? null;

    if (fallback) {
      if (sourceAsset.filePath !== movedFilePath) return;
      this.db
        .prepare("UPDATE image_asset_generations SET selected = 1 WHERE id = ?")
        .run(fallback.id);
      this.updateAsset({
        ...sourceAsset,
        status: "generated",
        publicUrl: fallback.public_url,
        filePath: fallback.file_path,
        updatedAt: nextTimestamp(sourceAsset.updatedAt)
      });
      return;
    }

    this.updateAsset({
      ...sourceAsset,
      status: "placeholder",
      publicUrl: null,
      filePath: null,
      updatedAt: nextTimestamp(sourceAsset.updatedAt)
    });
  }

  async deleteGeneration(
    articleId: string,
    assetId: string,
    generationId: string,
    expectedUpdatedAt: string
  ): Promise<ImageGenerationMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      const asset = this.assetForArticle(articleId, assetId);
      if (!asset) return { kind: "not_found" };

      const rows = this.generationRowsForAsset(assetId);
      const target = rows.find((row) => row.id === generationId);
      if (!target) return { kind: "not_found" };

      this.db.prepare("DELETE FROM image_asset_generations WHERE id = ?").run(generationId);

      // 删掉的若是当前版本，回落到剩下的最新一版；一版不剩就退回「待生成」，
      // 否则资产会继续指向一个已经被删掉的文件，预览裂图。
      const fallback = rows.find((row) => row.id !== generationId) ?? null;
      if (target.selected === 1) {
        if (fallback) {
          this.db
            .prepare("UPDATE image_asset_generations SET selected = 1 WHERE id = ?")
            .run(fallback.id);
          this.updateAsset({
            ...asset,
            status: "generated",
            publicUrl: fallback.public_url,
            filePath: fallback.file_path,
            updatedAt: nextTimestamp(asset.updatedAt)
          });
        } else {
          this.updateAsset({
            ...asset,
            status: "placeholder",
            publicUrl: null,
            filePath: null,
            updatedAt: nextTimestamp(asset.updatedAt)
          });
        }
      }
      return this.saveGenerationAggregate(
        article,
        expectedUpdatedAt,
        this.listSync(articleId),
        target.file_path
      );
    });
  }

  async applyStoryboardPlan(
    articleId: string,
    expectedUpdatedAt: string,
    segments: StoryboardSegmentPlan[]
  ): Promise<StoryboardPlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      if (!segments.length) {
        return { kind: "invalid_state", message: "分镜设计为空，无法落库" };
      }

      const existing = this.listSync(articleId);
      const oldStoryboards = existing.filter((asset) => asset.type === "storyboard");
      if (oldStoryboards.some((asset) => asset.status === "generating")) {
        return {
          kind: "invalid_state",
          message: "有分镜图正在生成，请等生成结束或失败后再重新设计分镜"
        };
      }

      // 上一版设计的分镜帧全部退役：删资产、删生成版本，
      // 文件路径收集起来交回上层清理磁盘（仓储不碰文件系统）。
      const removedFilePaths: string[] = [];
      for (const asset of oldStoryboards) {
        const rows = this.generationRowsForAsset(asset.id);
        for (const row of rows) {
          if (row.file_path) removedFilePaths.push(row.file_path);
        }
        if (rows.length) {
          this.db
            .prepare("DELETE FROM image_asset_generations WHERE asset_id = ?")
            .run(asset.id);
        }
        this.db.prepare("DELETE FROM image_assets WHERE id = ?").run(asset.id);
      }

      let assetTimestamp = article.updatedAt;
      let position = this.nextPosition(articleId);
      const persisted: StoryboardSegment[] = [];
      for (const [index, segment] of segments.entries()) {
        const frameAssetIds: string[] = [];
        for (const frame of segment.frames) {
          assetTimestamp = nextTimestamp(assetTimestamp);
          const id = randomUUID();
          const asset: ImageAsset = {
            id,
            articleId,
            type: "storyboard",
            // 分镜帧归段落所有（frameAssetIds 关联），不挂正文锚点。
            anchorBlockId: null,
            purpose: `分镜「${segment.title}」第 ${frameAssetIds.length + 1} 帧`,
            prompt: frame.prompt,
            altText: frame.altText,
            aspectRatio: frame.aspectRatio ?? "landscape",
            status: "placeholder",
            placeholderUrl: imageContentUrl(id),
            filePath: null,
            publicUrl: null,
            manuallyEdited: false,
            consumedContent: null,
            createdAt: assetTimestamp,
            updatedAt: assetTimestamp
          };
          this.insertAsset(asset, position);
          position += 1;
          frameAssetIds.push(id);
        }
        persisted.push({
          id: segment.id,
          sectionKey: segment.sectionKey,
          title: segment.title,
          route: segment.route,
          copyBlockIds: [...segment.copyBlockIds],
          frameAssetIds,
          order: index
        });
      }

      // planning 先行落库，saveBlocksAggregate 返回的文章带上新 planning，
      // 让设计视图与拼接阶段立即可见。
      const planning: ArticlePlanning = { ...article.planning, storyboardSegments: persisted };
      this.db
        .prepare("UPDATE articles SET planning_json = ? WHERE id = ?")
        .run(JSON.stringify(planning), articleId);
      const articleForSave = { ...article, planning };

      const assets = this.listSync(articleId);
      // 旧帧若有残余图块（历史锚点摆放）也一并从 blocks_json 清掉。
      const saved = this.saveBlocksAggregate(
        articleForSave,
        expectedUpdatedAt,
        article.blocks,
        assets,
        oldStoryboards.map((asset) => asset.id)
      );
      return { ...saved, removedFilePaths };
    });
  }

  async saveComicStrip(
    articleId: string,
    expectedUpdatedAt: string,
    input: SaveComicStripInput
  ): Promise<ImagePlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      if (!input.consumedContent.blocks.length) {
        return { kind: "invalid_state", message: "长图没有要替换的正文，无法落库" };
      }
      // 锚点必须真的存在：它决定长图插在正文的哪一段，落错位置比不落更糟。
      const anchorExists = article.blocks.some(
        (block) => block.type !== "image" && block.id === input.anchorBlockId
      );
      if (!anchorExists) return { kind: "invalid_anchor", anchorBlockId: input.anchorBlockId };

      const timestamp = nextTimestamp(article.updatedAt);
      this.insertAsset(
        {
          id: input.assetId,
          articleId,
          anchorBlockId: input.anchorBlockId,
          type: "comic_strip",
          purpose: input.purpose,
          prompt: `漫画长图｜${input.mode}｜${input.consumedContent.blocks.length} 块`,
          altText: input.altText,
          aspectRatio: "portrait",
          status: "generated",
          placeholderUrl: imageContentUrl(input.assetId),
          filePath: input.filePath,
          publicUrl: null,
          // 长图是作者手动拼出来的，不该被后续「重新规划配图」当占位图清掉。
          manuallyEdited: true,
          consumedContent: {
            blocks: input.consumedContent.blocks.map((block) => ({ ...block })),
            resumeBeforeBlockId: input.consumedContent.resumeBeforeBlockId
          },
          createdAt: timestamp,
          updatedAt: timestamp
        },
        this.nextPosition(articleId)
      );
      this.insertGeneration({
        id: input.generationId,
        articleId,
        assetId: input.assetId,
        prompt: `漫画长图｜${input.mode}`,
        model: null,
        filePath: input.filePath,
        publicUrl: null,
        selected: true,
        createdAt: timestamp
      });
      return this.saveAggregate(article, expectedUpdatedAt, this.listSync(articleId));
    });
  }

  async removeComicStrip(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImageGenerationMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      const asset = this.assetForArticle(articleId, assetId);
      if (!asset) return { kind: "not_found" };
      if (asset.type !== "comic_strip") {
        return { kind: "invalid_state", message: "这不是漫画长图，请用删除配图的方式处理" };
      }

      // 磁盘上的长图文件要跟着一起清掉：资产没了，文件就是没人指向的孤儿。
      const filePaths = this.generationRowsForAsset(assetId).map((row) => row.file_path);
      this.db
        .prepare("DELETE FROM image_assets WHERE article_id = ? AND id = ?")
        .run(articleId, assetId);

      return this.saveGenerationAggregate(
        article,
        expectedUpdatedAt,
        this.listSync(articleId),
        asset.filePath ?? filePaths.find((path) => Boolean(path)) ?? null,
        restoreConsumedBlocks(article.blocks, asset.consumedContent)
      );
    });
  }

  private inTransaction<T extends AnyImageMutationResult>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original database or mutation failure.
      }
      // 中断只用于 conflict/not_found 这类两个联合类型都有的结果，窄化是安全的。
      if (error instanceof AbortMutation) return error.result as T;
      throw error;
    }
  }

  private currentArticle(articleId: string, expectedUpdatedAt: string): Article | null {
    const row = this.db
      .prepare("SELECT * FROM articles WHERE id = ?")
      .get(articleId) as unknown as ArticleRow | undefined;
    if (!row) return null;
    const article = parseArticle(row);
    if (article.updatedAt !== expectedUpdatedAt) {
      throw new AbortMutation({ kind: "conflict" });
    }
    return article;
  }

  private missingOrConflict(
    articleId: string,
    expectedUpdatedAt: string
  ): { kind: "not_found" } | { kind: "conflict" } {
    const row = this.db
      .prepare("SELECT updated_at FROM articles WHERE id = ?")
      .get(articleId) as unknown as { updated_at: string } | undefined;
    return row && row.updated_at !== expectedUpdatedAt
      ? { kind: "conflict" }
      : { kind: "not_found" };
  }

  private assetForArticle(articleId: string, assetId: string): ImageAsset | null {
    const row = this.db
      .prepare("SELECT * FROM image_assets WHERE article_id = ? AND id = ?")
      .get(articleId, assetId) as unknown as ImageAssetRow | undefined;
    return row ? parseAsset(row) : null;
  }

  private listSync(articleId: string): ImageAsset[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM image_assets WHERE article_id = ? ORDER BY position ASC"
      )
      .all(articleId) as unknown as ImageAssetRow[];
    return rows.map(parseAsset);
  }

  private nextPosition(articleId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM image_assets WHERE article_id = ?"
      )
      .get(articleId) as unknown as { next_position: number };
    return row.next_position;
  }

  /** 按创建时间倒序（最新在前）——界面上第一张就是刚生成的那张。 */
  private generationRowsForAsset(assetId: string): ImageGenerationRow[] {
    return this.db
      .prepare(`
        SELECT * FROM image_asset_generations
        WHERE asset_id = ?
        ORDER BY created_at DESC, rowid DESC
      `)
      .all(assetId) as unknown as ImageGenerationRow[];
  }

  /**
   * 全局按 id 取版本行，**不限定槽位**：素材库允许把别的位置生成的图挪过来用。
   * 调用方负责校验 article_id，避免跨文章拿到版本。
   */
  private generationRowById(generationId: string): ImageGenerationRow | null {
    const row = this.db
      .prepare("SELECT * FROM image_asset_generations WHERE id = ?")
      .get(generationId) as unknown as ImageGenerationRow | undefined;
    return row ?? null;
  }

  /** 同一配图下最多一条 selected = 1；插入新版或切换前先全清。 */
  private clearSelectedGeneration(assetId: string) {
    this.db
      .prepare("UPDATE image_asset_generations SET selected = 0 WHERE asset_id = ?")
      .run(assetId);
  }

  private insertGeneration(generation: ImageGeneration) {
    this.db
      .prepare(`
        INSERT INTO image_asset_generations (
          id, article_id, asset_id, prompt, model, file_path, public_url, selected, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        generation.id,
        generation.articleId,
        generation.assetId,
        generation.prompt,
        generation.model,
        generation.filePath,
        generation.publicUrl,
        generation.selected ? 1 : 0,
        generation.createdAt
      );
  }

  private insertAsset(asset: ImageAsset, position: number) {
    this.db
      .prepare(`
        INSERT INTO image_assets (
          id, article_id, anchor_block_id, type, purpose, prompt, alt_text,
          aspect_ratio, status, placeholder_url, file_path, public_url,
          consumed_blocks, manually_edited, position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        asset.id,
        asset.articleId,
        asset.anchorBlockId,
        asset.type,
        asset.purpose,
        asset.prompt,
        asset.altText,
        asset.aspectRatio,
        asset.status,
        asset.placeholderUrl,
        asset.filePath,
        asset.publicUrl,
        asset.consumedContent ? JSON.stringify(asset.consumedContent) : null,
        asset.manuallyEdited ? 1 : 0,
        position,
        asset.createdAt,
        asset.updatedAt
      );
  }

  private updateAsset(asset: ImageAsset) {
    this.db
      .prepare(`
        UPDATE image_assets
        SET anchor_block_id = ?, prompt = ?, alt_text = ?, aspect_ratio = ?,
            status = ?, placeholder_url = ?, file_path = ?, public_url = ?,
            consumed_blocks = ?, manually_edited = ?, updated_at = ?
        WHERE id = ? AND article_id = ?
      `)
      .run(
        asset.anchorBlockId,
        asset.prompt,
        asset.altText,
        asset.aspectRatio,
        asset.status,
        asset.placeholderUrl,
        asset.filePath,
        asset.publicUrl,
        asset.consumedContent ? JSON.stringify(asset.consumedContent) : null,
        asset.manuallyEdited ? 1 : 0,
        asset.updatedAt,
        asset.id,
        asset.articleId
      );
  }

  private saveAggregate(
    article: Article,
    expectedUpdatedAt: string,
    assets: ImageAsset[],
    removedAssetIds: readonly string[] = []
  ): { kind: "saved"; article: Article; assets: ImageAsset[] } {
    return this.saveBlocksAggregate(article, expectedUpdatedAt, article.blocks, assets, removedAssetIds);
  }

  /**
   * 用一段**显式的正文**落库。
   *
   * 只有取消长图会用到：那时正文不是「当前这版」，而是「当前这版 + 放回来的原文快照」。
   * 其余路径一律走 saveAggregate，保持「正文的唯一来源是 article.blocks」这个前提。
   */
  private saveBlocksAggregate(
    article: Article,
    expectedUpdatedAt: string,
    blocks: ContentBlock[],
    assets: ImageAsset[],
    removedAssetIds: readonly string[] = []
  ): { kind: "saved"; article: Article; assets: ImageAsset[] } {
    const updatedAt = nextTimestamp(article.updatedAt);
    const updatedArticle: Article = {
      ...article,
      blocks: mergeImageBlocks(blocks, assets, removedAssetIds),
      updatedAt
    };
    const result = this.db
      .prepare(
        "UPDATE articles SET blocks_json = ?, updated_at = ? WHERE id = ? AND updated_at = ?"
      )
      .run(
        JSON.stringify(updatedArticle.blocks),
        updatedArticle.updatedAt,
        article.id,
        expectedUpdatedAt
      ) as unknown as { changes: number };
    if (result.changes === 0) {
      throw new AbortMutation({ kind: "conflict" });
    }
    return { kind: "saved", article: updatedArticle, assets };
  }

  /** 版本操作落库：复用 saveAggregate，再补上「被删掉的文件路径」交给上层清理磁盘。 */
  private saveGenerationAggregate(
    article: Article,
    expectedUpdatedAt: string,
    assets: ImageAsset[],
    removedFilePath: string | null,
    blocks: ContentBlock[] = article.blocks
  ): ImageGenerationMutationResult {
    return {
      ...this.saveBlocksAggregate(article, expectedUpdatedAt, blocks, assets),
      removedFilePath
    };
  }
}
