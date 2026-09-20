// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { StyleLibraryEntry } from "@/features/style-library/domain";
import type { StyleProfile } from "@/features/style-library/domain";
import type { StyleLibraryRepository } from "@/features/style-library/domain";
import { resolveStyleText } from "./style-text";

const PROFILE: StyleProfile = {
  name: "白底粗线知识条漫（混知风）",
  summary: "白底黑线粗描边竖向知识条漫，橙色气泡与注释条穿插吐槽。",
  palette: ["#ffffff", "#1a1a1a", "#e8922a"],
  lineWork: "黑色手绘描边，外轮廓粗（约2-4px）且带轻微手抖。",
  characterDesign: "Q版头身比约1:3，头大肩窄四肢短。",
  composition: "竖向长图，宽固定高不限，自上而下阅读。",
  background: "底色纯白，90%留白。",
  textRendering: "中文无衬线黑体分层，对白装进圆角橙色色块。",
  promptTemplate: "中国微信知识号手绘条漫画风，纯白底、黑色带手抖描边。"
};

function libraryWith(entry: StyleLibraryEntry | null): StyleLibraryRepository {
  return {
    list: async () => (entry ? [entry] : []),
    findById: async (id: string) => (entry && entry.id === id ? entry : null),
    upsert: async () => {
      throw new Error("not used in this test");
    }
  };
}

describe("resolveStyleText", () => {
  it("expands a library reference into the full style guide text", async () => {
    const entry: StyleLibraryEntry = {
      id: "style-1",
      name: PROFILE.name,
      profile: PROFILE,
      source: "gzh-crawl 采集（公众号：混知）",
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z"
    };

    const text = await resolveStyleText("library:style-1", libraryWith(entry));

    expect(text).toContain("【画风】中国微信知识号手绘条漫画风");
    expect(text).toContain("【主色板】#ffffff #1a1a1a #e8922a");
    expect(text).toContain("【角色造型】Q版头身比约1:3，头大肩窄四肢短。");
  });

  it("keeps a free-text style as-is (trimmed)", async () => {
    expect(await resolveStyleText("  简笔画  ", libraryWith(null))).toBe("简笔画");
  });

  it("returns null for empty values, deleted library entries, and a missing repository", async () => {
    expect(await resolveStyleText("", libraryWith(null))).toBeNull();
    expect(await resolveStyleText(null, libraryWith(null))).toBeNull();
    // 指向已删除的条目：按「没有画风」处理，不能拿 id 当画风发出去。
    expect(await resolveStyleText("library:gone", libraryWith(null))).toBeNull();
    expect(await resolveStyleText("library:style-1", undefined)).toBeNull();
  });
});
