// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { createTestRepository } from "../../../../tests/helpers/test-db";
import { requestJson } from "../../../../tests/helpers/request";
import { createArticlesRouteHandlers } from "./route";

describe("articles collection route", () => {
  let handlers: ReturnType<typeof createArticlesRouteHandlers>;

  beforeEach(() => {
    handlers = createArticlesRouteHandlers(createTestRepository());
  });

  it("rejects an empty topic", async () => {
    const response = await handlers.POST(
      requestJson("http://test/api/articles", { topic: "   " })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "请输入要讲解的知识点"
    });
  });

  it("creates and lists an article", async () => {
    const createResponse = await handlers.POST(
      requestJson("http://test/api/articles", { topic: "边际效应" })
    );
    expect(createResponse.status).toBe(201);
    expect((await createResponse.json()).article).toMatchObject({
      topic: "边际效应",
      status: "draft"
    });

    const listResponse = await handlers.GET();
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).articles).toHaveLength(1);
  });
});

