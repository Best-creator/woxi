"use client";

import type { LengthPreset } from "@/features/articles/domain";

const presets: Array<{ value: LengthPreset; label: string; name: string; range: string }> = [
  { value: "short", label: "短篇 800-1200 字", name: "短篇", range: "800-1200" },
  { value: "standard", label: "标准 1000-1500 字", name: "标准", range: "1000-1500" },
  { value: "deep", label: "深度 1500-2000 字", name: "深度", range: "1500-2000" }
];

export interface LengthPresetControlProps {
  value: LengthPreset;
  disabled?: boolean;
  onChange: (preset: LengthPreset) => void;
}

export function LengthPresetControl({
  value,
  disabled = false,
  onChange
}: LengthPresetControlProps) {
  return (
    <fieldset className="outline-control-field outline-length-control" disabled={disabled}>
      <legend>文章长度</legend>
      <div className="segmented-control segmented-control-three">
        {presets.map((preset) => (
          <button
            className={`segment ${value === preset.value ? "segment-active" : ""}`}
            key={preset.value}
            type="button"
            aria-label={preset.label}
            aria-pressed={value === preset.value}
            onClick={() => onChange(preset.value)}
          >
            <span className="length-preset-name">{preset.name}</span>
            <span className="length-preset-range">{preset.range}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
