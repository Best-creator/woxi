"use client";

import {
  LENGTH_PRESET_IDS,
  LENGTH_PRESET_LABELS,
  LENGTH_RANGES,
  type LengthPreset
} from "@/features/articles/domain";

export interface LengthPresetControlProps {
  value: LengthPreset;
  disabled?: boolean;
  onChange: (preset: LengthPreset) => void;
}

/**
 * 档位列表不在这里手抄：顺序、显示名、区间全部来自 `articles/domain` 的 LENGTH_RANGES
 * 单一事实源（加一档只改那一处，控件自动跟上）。
 */
export function LengthPresetControl({
  value,
  disabled = false,
  onChange
}: LengthPresetControlProps) {
  return (
    <fieldset className="outline-control-field outline-length-control" disabled={disabled}>
      <legend>文章长度</legend>
      <div className="segmented-control segmented-control-fill">
        {LENGTH_PRESET_IDS.map((preset) => {
          const { min, max } = LENGTH_RANGES[preset];
          const name = LENGTH_PRESET_LABELS[preset];
          const range = `${min}-${max}`;
          return (
            <button
              className={`segment ${value === preset ? "segment-active" : ""}`}
              key={preset}
              type="button"
              aria-label={`${name} ${range} 字`}
              aria-pressed={value === preset}
              onClick={() => onChange(preset)}
            >
              <span className="length-preset-name">{name}</span>
              <span className="length-preset-range">{range}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
