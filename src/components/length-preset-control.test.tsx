import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LENGTH_PRESET_IDS, LENGTH_PRESET_LABELS, LENGTH_RANGES } from "@/features/articles/domain";
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

  it("renders every registered preset, in registry order", () => {
    // 控件不手抄档位清单：漏登记一档（比如「轻量」）在这里直接红。
    render(<LengthPresetControl value="standard" onChange={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(
      LENGTH_PRESET_IDS.map((preset) => {
        const { min, max } = LENGTH_RANGES[preset];
        return `${LENGTH_PRESET_LABELS[preset]} ${min}-${max} 字`;
      })
    );
  });

  it("offers the brief tier that comics need", () => {
    render(<LengthPresetControl value="brief" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "轻量 550-650 字" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
