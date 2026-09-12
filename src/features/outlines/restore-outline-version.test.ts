// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { DemoOutlineGenerator } from "./demo-outline-agents";
import { generateOutline } from "./generate-outline";
import { restoreOutlineVersion } from "./restore-outline-version";
import { SqliteOutlineWorkflowRepository } from "./sqlite-workflow-repository";
import { createTestDatabase } from "../../../tests/helpers/test-db";

describe("restoreOutlineVersion", () => {
  it("copies an old snapshot into the draft and allocates a new restored version", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const created = await articles.create({ topic: "机会成本" });
    const first = await generateOutline({ articleId: created.id, expectedUpdatedAt: created.updatedAt, lengthPreset: "short" }, { articles, sources, generator: new DemoOutlineGenerator(), workflow });
    if (first.kind !== "generated") throw new Error("fixture should generate");
    const second = await generateOutline({ articleId: created.id, expectedUpdatedAt: first.article.updatedAt, lengthPreset: "deep" }, { articles, sources, generator: new DemoOutlineGenerator(), workflow });
    if (second.kind !== "generated") throw new Error("fixture should generate again");

    const result = await restoreOutlineVersion(
      { articleId: created.id, versionId: first.revision.id, expectedUpdatedAt: second.article.updatedAt },
      { workflow }
    );

    expect(result).toMatchObject({
      kind: "restored",
      article: { planning: { lengthPreset: "short" } },
      revision: { version: 3, reason: "restored" }
    });
    expect(await workflow.listOutlineVersions(created.id)).toMatchObject([{ version: 3 }, { version: 2 }, { version: 1 }]);
  });

  it("rejects a stale request and a version belonging to another article", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const firstArticle = await articles.create({ topic: "机会成本" });
    const secondArticle = await articles.create({ topic: "沉没成本" });
    const generated = await generateOutline({ articleId: firstArticle.id, expectedUpdatedAt: firstArticle.updatedAt, lengthPreset: "standard" }, { articles, sources, generator: new DemoOutlineGenerator(), workflow });
    if (generated.kind !== "generated") throw new Error("fixture should generate");

    const stale = await restoreOutlineVersion({ articleId: firstArticle.id, versionId: generated.revision.id, expectedUpdatedAt: firstArticle.updatedAt }, { workflow });
    const foreign = await restoreOutlineVersion({ articleId: secondArticle.id, versionId: generated.revision.id, expectedUpdatedAt: secondArticle.updatedAt }, { workflow });

    expect(stale).toEqual({ kind: "conflict" });
    expect(foreign).toEqual({ kind: "version_not_found" });
  });
});
