// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ImageSite } from "./image-catalog";
import { fetchImageCatalog, pickImageModels, resolveImageSite } from "./image-catalog";

const main: ImageSite = {
  baseUrl: "https://main.example.test",
  apiKey: "k1",
  model: "gpt-image-2",
  name: "image2"
};

const second: ImageSite = {
  baseUrl: "https://second.example.test",
  apiKey: "k2",
  model: "gpt-image-2",
  name: "yelan"
};

function modelsResponse(ids: string[]) {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
}

describe("pickImageModels", () => {
  it("keeps image-like ids case-insensitively and dedupes", () => {
    expect(
      pickImageModels(["GPT-Image-2", "grok-imagine-image", "flux-pro", "gpt-image-2", "grok-4.6"])
    ).toEqual(["GPT-Image-2", "grok-imagine-image", "flux-pro"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(pickImageModels(["claude-sonnet", "glm-5.3-flash"])).toEqual([]);
  });
});

describe("fetchImageCatalog", () => {
  it("aggregates models from all sites with provider attribution", async () => {
    const fetchFn = (async (url: unknown) =>
      String(url).startsWith("https://main.example.test")
        ? modelsResponse(["gpt-image-2", "grok-imagine-image", "grok-4.6"])
        : modelsResponse(["gpt-image-2", "dall-e-3"])) as typeof fetch;

    const catalog = await fetchImageCatalog([main, second], fetchFn);

    expect(catalog).toEqual([
      { id: "gpt-image-2", provider: "image2" },
      { id: "grok-imagine-image", provider: "image2" },
      { id: "dall-e-3", provider: "yelan" }
    ]);
  });

  it("skips a failing site without failing the whole catalog", async () => {
    const fetchFn = (async (url: unknown) => {
      if (String(url).startsWith("https://main.example.test")) {
        throw new Error("network down");
      }
      return modelsResponse(["flux-pro"]);
    }) as typeof fetch;

    const catalog = await fetchImageCatalog([main, second], fetchFn);
    expect(catalog).toEqual([{ id: "flux-pro", provider: "yelan" }]);
  });

  it("returns an empty catalog when every site fails", async () => {
    const fetchFn = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    expect(await fetchImageCatalog([main], fetchFn)).toEqual([]);
  });
});

describe("resolveImageSite", () => {
  const catalog = [
    { id: "gpt-image-2", provider: "image2" },
    { id: "mirror-model", provider: "yelan" }
  ];

  it("uses the main site when no model is given", () => {
    expect(resolveImageSite(undefined, catalog, [main, second])).toBe(main);
  });

  it("routes a cataloged model to its owning site", () => {
    expect(resolveImageSite("mirror-model", catalog, [main, second])).toBe(second);
  });

  it("falls back to the main site for unknown models", () => {
    expect(resolveImageSite("brand-new", catalog, [main, second])).toBe(main);
  });

  it("falls back to the main site when the owner site is not configured", () => {
    expect(resolveImageSite("mirror-model", catalog, [main])).toBe(main);
  });
});
