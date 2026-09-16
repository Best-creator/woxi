// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../../../tests/helpers/test-db";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import type { Article } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";
import type { WechatDraftImage, WechatDraftInput } from "./wechat-draft";
import { replaceImageUrls } from "./wechat-draft";
import {
  SqliteWechatDraftRecordRepository,
  articleDraftHash,
  publishArticleDraft
} from "./publish-article-draft";

const ASSETS: Record<string, string> = {
  "cover-1": "cover binary",
  "img-1": "inline one",
  "img-2": "inline two"
};

function asset(id: string, overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id,
    articleId: "article-1",
    type: id.startsWith("cover") ? "cover" : "concept",
    anchorBlockId: null,
    purpose: "测试配图",
    prompt: "prompt",
    altText: `配图 ${id}`,
    aspectRatio: id.startsWith("cover") ? "cover" : "landscape",
    status: "generated",
    placeholderUrl: null,
    filePath: `.data/${id}.png`,
    publicUrl: null,
    manuallyEdited: false,
    consumedContent: null,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    ...overrides
  };
}

async function setup() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const records = new SqliteWechatDraftRecordRepository(db);
  const created = await articles.create({ topic: "复利" });
  const saved = await articles.save(
    {
      ...created,
      title: "复利的力量",
      blocks: [
        { id: "b-1", type: "heading", level: 2, content: "什么是复利", order: 0, version: 1 },
        { id: "b-2", type: "paragraph", content: "复利是世界第八大奇迹。", order: 1, version: 1 },
        { id: "b-3", type: "image", content: "/api/image-assets/img-1/content", altText: "复利曲线", order: 2, version: 1 }
      ]
    },
    created.updatedAt
  );
  if (saved.kind !== "saved") throw new Error("fixture should save");
  const article: Article = saved.article;
  return { records, article };
}

const readAssetFile = async (asset: ImageAsset): Promise<WechatDraftImage> => ({
  sourceUrl: `/api/image-assets/${asset.id}/content`,
  data: Buffer.from(ASSETS[asset.id] ?? "missing", "utf8"),
  mimeType: "image/png",
  filename: `${asset.id}.png`
});

function publisher(log: WechatDraftInput[] = []) {
  return {
    publish: async (input: WechatDraftInput) => {
      log.push(input);
      return { mediaId: `MEDIA-${log.length}`, imageReplacements: {} };
    }
  };
}

describe("publishArticleDraft", () => {
  it("组装封面与正文图并调用推送器，写入推送记录", async () => {
    const { records, article } = await setup();
    const calls: WechatDraftInput[] = [];
    const result = await publishArticleDraft(
      {
        article,
        assets: [asset("img-1"), asset("cover-1"), asset("img-2", { status: "disabled" })],
        themeId: "ink"
      },
      { publisher: publisher(calls), records, readAssetFile }
    );

    expect(result.kind).toBe("saved");
    if (result.kind !== "saved") return;
    expect(calls).toHaveLength(1);
    expect(calls[0].title).toBe("复利的力量");
    expect(calls[0].cover.filename).toBe("cover-1.png");
    // 只有正文 image block 实际引用、且 generated 的资产才会上传
    expect(calls[0].inlineImages.map((image) => image.filename)).toEqual(["img-1.png"]);
    expect(calls[0].contentHtml).toContain("复利是世界第八大奇迹");
    expect(calls[0].contentHtml).toContain('src="/api/image-assets/img-1/content"');
    expect(result.record.mediaId).toBe("MEDIA-1");
    expect((await records.listByArticle(article.id)).map((record) => record.mediaId)).toEqual(["MEDIA-1"]);
  });

  it("同内容重复推送被拒绝，force 时放行", async () => {
    const { records, article } = await setup();
    const dependencies = { publisher: publisher(), records, readAssetFile };
    const input = { article, assets: [asset("cover-1")], themeId: "ink" as const };

    const first = await publishArticleDraft(input, dependencies);
    expect(first.kind).toBe("saved");

    const duplicate = await publishArticleDraft(input, dependencies);
    expect(duplicate.kind).toBe("duplicate");

    const forced = await publishArticleDraft({ ...input, force: true }, dependencies);
    expect(forced.kind).toBe("saved");
    // 同毫秒写入时次序未定，只断言两条都在
    expect((await records.listByArticle(article.id)).map((record) => record.mediaId).sort()).toEqual([
      "MEDIA-1",
      "MEDIA-2"
    ]);
  });

  it("没有 generated 封面或正文为空时给出可读的拒绝", async () => {
    const { records, article } = await setup();
    const dependencies = { publisher: publisher(), records, readAssetFile };

    const noCover = await publishArticleDraft(
      { article, assets: [asset("img-1")], themeId: "ink" },
      dependencies
    );
    expect(noCover.kind).toBe("no_cover");

    const emptyArticle: Article = { ...article, blocks: [] };
    const noContent = await publishArticleDraft(
      { article: emptyArticle, assets: [asset("cover-1")], themeId: "ink" },
      dependencies
    );
    expect(noContent.kind).toBe("no_content");
  });

  it("推送器错误透传为 publisher_error，不写记录", async () => {
    const { records, article } = await setup();
    const result = await publishArticleDraft(
      { article, assets: [asset("cover-1")], themeId: "ink" },
      {
        publisher: {
          publish: async () => {
            throw new Error("微信接口错误 48001: api unauthorized");
          }
        },
        records,
        readAssetFile
      }
    );
    expect(result.kind).toBe("publisher_error");
    expect((await records.listByArticle(article.id)).map((r) => r.mediaId)).toEqual([]);
  });
});

describe("wechat draft helpers", () => {
  it("replaceImageUrls 按映射精确替换全部出现位置", () => {
    const html =
      '<img src="/api/image-assets/a/content"><img src="/api/image-assets/b/content"><img src="/api/image-assets/a/content">';
    const output = replaceImageUrls(html, {
      "/api/image-assets/a/content": "https://mmbiz.qpic.cn/aaa",
      "/api/image-assets/b/content": "https://mmbiz.qpic.cn/bbb"
    });
    expect(output).toBe(
      '<img src="https://mmbiz.qpic.cn/aaa"><img src="https://mmbiz.qpic.cn/bbb"><img src="https://mmbiz.qpic.cn/aaa">'
    );
  });

  it("articleDraftHash 对同内容稳定、对内容变化敏感", () => {
    const a = articleDraftHash("x", "<p>1</p>");
    const b = articleDraftHash("x", "<p>1</p>");
    const c = articleDraftHash("x", "<p>2</p>");
    const d = articleDraftHash("y", "<p>1</p>");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});
