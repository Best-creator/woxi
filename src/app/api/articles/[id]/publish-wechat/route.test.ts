// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import type { ImageAsset } from "@/features/images/domain";
import { createTestDatabase } from "../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../tests/helpers/request";
import type { WechatDraftInput, WechatDraftImage, WechatDraftPublisher } from "@/features/publishing/wechat-draft";
import { SqliteWechatDraftRecordRepository } from "@/features/publishing/publish-article-draft";
import { createPublishWechatRouteHandler } from "./route";

function okPublisher(log: WechatDraftInput[] = []): WechatDraftPublisher {
  return {
    publish: async (input) => {
      log.push(input);
      return { mediaId: `MEDIA-${log.length}`, imageReplacements: {} };
    }
  };
}

/** 测试注入：不读真实磁盘文件，按 assetId 造一个小载荷。 */
const stubReadAssetFile = async (asset: ImageAsset): Promise<WechatDraftImage> => ({
  sourceUrl: `/api/image-assets/${asset.id}/content`,
  data: Buffer.from(`binary-${asset.id}`, "utf8"),
  mimeType: "image/png",
  filename: `${asset.id}.png`
});

const failingPublisher: WechatDraftPublisher = {
  publish: async () => {
    throw new Error("微信接口错误 48001: api unauthorized");
  }
};

async function setup() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const records = new SqliteWechatDraftRecordRepository(db);
  const created = await articles.create({ topic: "复利" });
  const saved = await articles.save(
    {
      ...created,
      title: "复利的力量",
      blocks: [
        { id: "b-1", type: "paragraph", content: "复利是世界第八大奇迹。", order: 0, version: 1 }
      ]
    },
    created.updatedAt
  );
  if (saved.kind !== "saved") throw new Error("fixture should save");
  const article = saved.article;
  // 规划一张封面并置为 generated（含本地文件路径），推送用例依赖它
  const planned = await images.applyPlan(article.id, article.updatedAt, [
    { type: "cover", anchorBlockId: null, purpose: "封面", prompt: "封面图", altText: "封面", aspectRatio: "cover" }
  ]);
  if (planned.kind !== "saved") throw new Error("fixture should plan");
  const cover = planned.assets.find((candidate) => candidate.type === "cover");
  if (!cover) throw new Error("fixture should have a cover asset");
  const begun = await images.beginGeneration(article.id, cover.id, planned.article.updatedAt);
  if (begun.kind !== "saved") throw new Error("fixture should begin generation");
  const completed = await images.completeGeneration(article.id, cover.id, begun.article.updatedAt, {
    publicUrl: null,
    filePath: ".data/generated-images/cover-fixture.png",
    generationId: "generation-cover-fixture"
  });
  if (completed.kind !== "saved") throw new Error("fixture should complete");
  return { articles, images, records, article: completed.article };
}

describe("publish-wechat route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("未配置公众号凭据时 400 并提示配置方法", async () => {
    const { articles, images, records, article } = await setup();
    const POST = createPublishWechatRouteHandler(articles, images, null, records);
    const response = await POST(
      requestJson(`http://test/publish-wechat`, { themeId: "ink" }),
      context(article.id)
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("WECHAT_APPID");
  });

  it("成功推送返回 media_id 记录", async () => {
    const { articles, images, records, article } = await setup();
    const POST = createPublishWechatRouteHandler(articles, images, okPublisher(), records, stubReadAssetFile);
    const response = await POST(
      requestJson(`http://test/publish-wechat`, { themeId: "warm" }),
      context(article.id)
    );
    expect(response.status).toBe(200);
    expect((await response.json()).record.mediaId).toBe("MEDIA-1");
  });

  it("没有封面时 400（推送器不会被调用）", async () => {
    const { articles, images, records, article } = await setup();
    const existing = await images.list(article.id);
    const cover = existing.find((candidate) => candidate.type === "cover");
    if (!cover) throw new Error("fixture should have a cover asset");
    await images.remove(article.id, cover.id, article.updatedAt);

    const calls: WechatDraftInput[] = [];
    const POST = createPublishWechatRouteHandler(articles, images, okPublisher(calls), records, stubReadAssetFile);
    const response = await POST(
      requestJson(`http://test/publish-wechat`, { themeId: "ink" }),
      context(article.id)
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("封面");
    expect(calls).toHaveLength(0);
  });

  it("推送器错误映射 502；themeId 非法映射 400", async () => {
    const { articles, images, records, article } = await setup();
    const failing = createPublishWechatRouteHandler(articles, images, failingPublisher, records, stubReadAssetFile);
    const failed = await failing(
      requestJson(`http://test/publish-wechat`, { themeId: "ink" }),
      context(article.id)
    );
    expect(failed.status).toBe(502);

    const okCalls: WechatDraftInput[] = [];
    const ok = createPublishWechatRouteHandler(articles, images, okPublisher(okCalls), records, stubReadAssetFile);
    const invalidTheme = await ok(
      requestJson(`http://test/publish-wechat`, { themeId: "neon" }),
      context(article.id)
    );
    expect(invalidTheme.status).toBe(400);
    expect(okCalls).toHaveLength(0);
  });
});
