// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/features/articles/domain";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { generateImageAsset } from "@/features/images/generate-image-asset";
import type { ImageGenerator } from "@/features/images/image-generator";
import type { StoryboardSegmentPlan } from "@/features/images/repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import { createTestDatabase } from "../../../../../../../tests/helpers/test-db";
import { createComposeCoverRouteHandler } from "./route";

const FRAME_COLORS = ["#3355ff", "#33aa55", "#ff8800"];

const SEGMENTS: StoryboardSegmentPlan[] = [
  {
    id: "segment-1",
    sectionKey: "section-1",
    title: "眼睛为什么会酸",
    route: "image_text",
    copyBlockIds: ["seg1-heading", "seg1-copy"],
    frames: [{ prompt: "全景。主角揉眼睛", altText: "揉眼睛" }]
  },
  {
    id: "segment-2",
    sectionKey: "section-2",
    title: "怎么救",
    route: "image_text_image",
    copyBlockIds: ["seg2-heading", "seg2-copy"],
    frames: [
      { prompt: "中景。看向远处", altText: "看远处" },
      { prompt: "近景。桌上的定时器", altText: "定时器" }
    ]
  }
];

const SEGMENT_COPY: ContentBlock[] = [
  {
    id: "seg1-heading",
    type: "heading",
    content: "眼睛为什么会酸",
    order: 0,
    level: 2,
    segmentId: "segment-1",
    version: 1
  },
  {
    id: "seg1-copy",
    type: "paragraph",
    content: "盯着屏幕时眨眼次数掉了一半，眼睛就开始报警。",
    order: 1,
    segmentId: "segment-1",
    version: 1
  },
  {
    id: "seg2-heading",
    type: "heading",
    content: "怎么救",
    order: 2,
    level: 2,
    segmentId: "segment-2",
    version: 1
  },
  {
    id: "seg2-copy",
    type: "paragraph",
    content: "每二十分钟看远处二十秒，让睫状肌松一松。",
    order: 3,
    segmentId: "segment-2",
    version: 1
  }
];

function frameGenerator(index: number): ImageGenerator {
  return {
    generate: async () => ({
      remoteUrl: null,
      binary: await sharp({
        create: {
          width: 400,
          height: 300,
          channels: 3,
          background: FRAME_COLORS[index % FRAME_COLORS.length]
        }
      })
        .png()
        .toBuffer(),
      format: "png"
    })
  };
}

async function setup(options: { generateFrames?: boolean } = {}) {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-cover-route-"));

  const created = await articles.create({ topic: "护眼" });
  const saved = await articles.save({ ...created, blocks: SEGMENT_COPY }, created.updatedAt);
  if (saved.kind !== "saved") throw new Error("fixture article should save");

  const planned = await images.applyStoryboardPlan(
    saved.article.id,
    saved.article.updatedAt,
    SEGMENTS
  );
  if (planned.kind !== "saved") throw new Error("storyboard plan should save");

  let expectedUpdatedAt = planned.article.updatedAt;
  const frameIds = (planned.article.planning.storyboardSegments ?? []).flatMap(
    (segment) => segment.frameAssetIds
  );
  if (options.generateFrames !== false) {
    for (const [index, assetId] of frameIds.entries()) {
      const generated = await generateImageAsset(
        { articleId: saved.article.id, assetId, expectedUpdatedAt },
        { images, generator: frameGenerator(index), storageDir }
      );
      if (generated.kind !== "saved") throw new Error(`frame ${index} should generate`);
      expectedUpdatedAt = generated.article.updatedAt;
    }
  }

  return { images, articleId: saved.article.id, expectedUpdatedAt, frameIds, storageDir };
}

describe("cover compose route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const request = (body: unknown) =>
    new Request("http://test/cover/compose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

  it("composes the first three frames into the cover and returns the updated article", async () => {
    const fixture = await setup();
    const POST = createComposeCoverRouteHandler({ images: fixture.images });

    const response = await POST(
      request({ expectedUpdatedAt: fixture.expectedUpdatedAt }),
      context(fixture.articleId)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      article: { id: string; updatedAt: string };
      assets: Array<{ type: string; status: string }>;
    };
    expect(body.article.id).toBe(fixture.articleId);
    const cover = body.assets.find((asset) => asset.type === "cover");
    expect(cover?.status).toBe("generated");
  });

  it("returns 502 when the article has fewer than three generated frames", async () => {
    const fixture = await setup({ generateFrames: false });
    const POST = createComposeCoverRouteHandler({ images: fixture.images });

    const response = await POST(
      request({ expectedUpdatedAt: fixture.expectedUpdatedAt }),
      context(fixture.articleId)
    );

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("不足 3 张");
  });

  it("maps a stale version to 409 and a missing article to 404", async () => {
    const fixture = await setup();
    const POST = createComposeCoverRouteHandler({ images: fixture.images });

    const stale = await POST(
      request({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
      context(fixture.articleId)
    );
    expect(stale.status).toBe(409);

    const missing = await POST(
      request({ expectedUpdatedAt: fixture.expectedUpdatedAt }),
      context("missing")
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe("文章不存在");
  });

  it("rejects invalid bodies: missing version token, bad assetIds shape, non-JSON", async () => {
    const fixture = await setup();
    const POST = createComposeCoverRouteHandler({ images: fixture.images });

    const noVersion = await POST(request({}), context(fixture.articleId));
    expect(noVersion.status).toBe(400);

    // assetIds 必须恰好 3 个。
    const badIds = await POST(
      request({ expectedUpdatedAt: fixture.expectedUpdatedAt, assetIds: [fixture.frameIds[0]] }),
      context(fixture.articleId)
    );
    expect(badIds.status).toBe(400);

    const notJson = await POST(
      new Request("http://test/cover/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json"
      }),
      context(fixture.articleId)
    );
    expect(notJson.status).toBe(400);
  });
});
