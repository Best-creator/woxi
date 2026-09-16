import { describe, expect, it } from "vitest";
import type { StyleProfile } from "./domain";
import {
  LIBRARY_STYLE_PREFIX,
  isLibraryStyleRef,
  libraryStyleId,
  styleToGuideText
} from "./style-guide";

const PROFILE: StyleProfile = {
  name: "Q版手绘科普",
  summary: "低饱和土黄色调的Q版手绘科普卡片画风",
  palette: ["#bfb3a2", "#8d7e6f", "#66574e"],
  lineWork: "不均匀细抖动描边，带有手绘颤动感",
  characterDesign: "两头身圆脸小动物，腮红明显",
  composition: "主体居中，顶部留出大字标题区",
  background: "米黄纸纹底，轻微颗粒质感",
  textRendering: "顶部大字标题，正文手写体配拼音格",
  promptTemplate:
    "画面采用Q版手绘科普卡片风格：低饱和土黄色调、不均匀抖动细描边、两头身圆脸角色、米黄纸纹背景，整体温暖治愈，像纸质科普卡片。"
};

describe("styleToGuideText", () => {
  it("按稳定顺序拼装全部维度，色板带说明", () => {
    const text = styleToGuideText(PROFILE);
    expect(text).toContain("【画风】画面采用Q版手绘科普卡片风格");
    expect(text).toContain("【主色板】#bfb3a2 #8d7e6f #66574e");
    expect(text).toContain("【线条】不均匀细抖动描边");
    expect(text).toContain("【角色造型】两头身圆脸小动物");
    expect(text).toContain("【构图】主体居中");
    expect(text).toContain("【背景】米黄纸纹底");
    expect(text).toContain("【文字排版】顶部大字标题");
    expect(text).toContain("【风格概括】低饱和土黄色调");
    // 行序稳定：画风在最前、概括在最后
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^【画风】/);
    expect(lines[lines.length - 1]).toMatch(/^【风格概括】/);
  });
});

describe("library style ref", () => {
  it("识别并解析 library:<id> 标记", () => {
    const ref = `${LIBRARY_STYLE_PREFIX}9f0c-uuid`;
    expect(isLibraryStyleRef(ref)).toBe(true);
    expect(libraryStyleId(ref)).toBe("9f0c-uuid");
    expect(isLibraryStyleRef("简笔画")).toBe(false);
    expect(isLibraryStyleRef("library:")).toBe(false);
  });
});
