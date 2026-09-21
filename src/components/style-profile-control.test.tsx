import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { STYLE_PRESET_IDS, resolveStyleProfile } from "@/features/content/style-profile";
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
        value={resolveStyleProfile("storyteller", "", "general_beginner")}
        onChange={onChange}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("目标读者"), "senior_reader");

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      preset: "storyteller",
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

    await userEvent.selectOptions(screen.getByLabelText("人物语言风格"), "storyteller");

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      preset: "storyteller",
      audience: "office_desk"
    }));
  });

  it("carries typed instructions away from custom only", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StyleProfileControl
        value={resolveStyleProfile("custom", "少用反问句")}
        onChange={onChange}
      />
    );

    // 从「自定义」切走：用户手写的说明作为补充约束跟着走（历史行为，别丢）。
    await userEvent.selectOptions(screen.getByLabelText("人物语言风格"), "storyteller");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      preset: "storyteller",
      customInstructions: "少用反问句"
    }));

    // 从一个自带说明的预设切走：它的招牌手法不能串给下一个预设。
    onChange.mockClear();
    rerender(<StyleProfileControl value={resolveStyleProfile("hunzhi_comic")} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText("人物语言风格"), "plain_explainer");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      preset: "plain_explainer",
      customInstructions: ""
    }));
  });

  it("lists every registered preset in the dropdown", () => {
    render(
      <StyleProfileControl value={resolveStyleProfile("popular_science_teacher")} onChange={vi.fn()} />
    );

    const options = Array.from(
      screen.getByLabelText("人物语言风格").querySelectorAll("option")
    ).map((option) => (option as HTMLOptionElement).value);

    expect(options).toEqual([...STYLE_PRESET_IDS]);
  });
});
