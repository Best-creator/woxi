// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  HeuristicComicStripModeRouter,
  OpenAiComicStripModeRouter,
  heuristicComicStripMode,
  type ComicStripModePanelSummary
} from "./comic-strip-mode-router";

function panels(...chars: number[]): ComicStripModePanelSummary[] {
  return chars.map((count, index) => ({
    title: `第 ${index + 1} 格`,
    caption: `案${index}`.repeat(Math.max(count - 1, 0)) || "案",
    chars: count
  }));
}

describe("heuristicComicStripMode", () => {
  it("pairs short even panels into a picture-book rhythm", () => {
    const decision = heuristicComicStripMode({ panels: panels(30, 35, 40, 38), excerpt: "" });

    expect(decision.mode).toBe("image_text_image");
    expect(decision.reason).toContain("两两成组");
  });

  it("puts long captions above the pictures so readers read first", () => {
    const decision = heuristicComicStripMode({ panels: panels(140, 160), excerpt: "" });

    expect(decision.mode).toBe("text_image");
    expect(decision.reason).toContain("偏长");
  });

  it("falls back to image-over-text for the balanced middle ground", () => {
    const decision = heuristicComicStripMode({ panels: panels(80, 95, 88), excerpt: "" });

    expect(decision.mode).toBe("image_text");
  });
});

describe("HeuristicComicStripModeRouter", () => {
  it("resolves deterministically without any external service", async () => {
    const router = new HeuristicComicStripModeRouter();

    await expect(router.decide({ panels: panels(80, 95, 88), excerpt: "" })).resolves.toMatchObject({
      mode: "image_text"
    });
  });
});

describe("OpenAiComicStripModeRouter", () => {
  it("passes panels and excerpt to the model and returns its decision", async () => {
    const complete = vi.fn().mockResolvedValue({
      mode: "text_image",
      reason: "先铺垫后揭示画面"
    });
    const router = new OpenAiComicStripModeRouter({ complete }, "router-model");

    await expect(
      router.decide({ panels: panels(120, 130), excerpt: "久坐的代价……" })
    ).resolves.toEqual({ mode: "text_image", reason: "先铺垫后揭示画面" });

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "router-model",
        userPayload: { panels: panels(120, 130), excerpt: "久坐的代价……" }
      })
    );
  });

  it("rejects when the model answers with an unknown mode", async () => {
    const complete = vi.fn().mockResolvedValue({ mode: "diagonal", reason: "斜着排" });
    const router = new OpenAiComicStripModeRouter({ complete });

    await expect(router.decide({ panels: panels(80, 95), excerpt: "" })).rejects.toThrow();
  });
});
