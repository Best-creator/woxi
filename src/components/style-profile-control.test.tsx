import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { resolveStyleProfile } from "@/features/content/style-profile";
import { StyleProfileControl } from "./style-profile-control";

describe("StyleProfileControl", () => {
  it("switches the preset and keeps the typed custom instructions", async () => {
    const onChange = vi.fn();
    render(
      <StyleProfileControl
        value={resolveStyleProfile("popular_science_teacher")}
        onChange={onChange}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("人物语言风格"), "friend_chat");

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      preset: "friend_chat",
      tone: "亲切、自然、像朋友聊天"
    }));
  });

  it("only asks for custom instructions on the custom preset", async () => {
    const { rerender } = render(
      <StyleProfileControl value={resolveStyleProfile("friend_chat")} onChange={vi.fn()} />
    );

    expect(screen.queryByLabelText("自定义说明")).not.toBeInTheDocument();

    rerender(
      <StyleProfileControl
        value={resolveStyleProfile("custom", "像耐心的高中老师一样解释")}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText("自定义说明")).toHaveValue("像耐心的高中老师一样解释");
  });

  it("reports edited custom instructions", async () => {
    const onChange = vi.fn();
    render(
      <StyleProfileControl value={resolveStyleProfile("custom")} onChange={onChange} />
    );

    await userEvent.type(screen.getByLabelText("自定义说明"), "少用反问句");

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      preset: "custom",
      customInstructions: "少用反问句"
    }));
  });

  it("reports the audience without touching the preset", async () => {
    const onChange = vi.fn();
    render(
      <StyleProfileControl
        value={resolveStyleProfile("science_comic_script", "", "general_beginner")}
        onChange={onChange}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("目标读者"), "senior_reader");

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      preset: "science_comic_script",
      audience: "senior_reader"
    }));
  });

  it("keeps the chosen audience when the preset changes", async () => {
    const onChange = vi.fn();
    render(
      <StyleProfileControl
        value={resolveStyleProfile("friend_chat", "", "office_desk")}
        onChange={onChange}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("人物语言风格"), "science_comic_script");

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      preset: "science_comic_script",
      audience: "office_desk"
    }));
  });

  it("offers the comic script preset", () => {
    render(<StyleProfileControl value={resolveStyleProfile("popular_science_teacher")} onChange={vi.fn()} />);

    expect(screen.getByRole("option", { name: "科普漫画脚本" })).toBeInTheDocument();
  });
});
