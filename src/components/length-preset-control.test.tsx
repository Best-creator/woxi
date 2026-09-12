import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LengthPresetControl } from "./length-preset-control";

describe("LengthPresetControl", () => {
  it("selects the exact deep article word range", async () => {
    const onChange = vi.fn();
    render(<LengthPresetControl value="standard" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "深度 1500-2000 字" }));

    expect(onChange).toHaveBeenCalledWith("deep");
  });

  it("marks the selected preset for assistive technology", () => {
    render(<LengthPresetControl value="short" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "短篇 800-1200 字" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
