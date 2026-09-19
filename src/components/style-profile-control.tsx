"use client";

import { useEffect, useState } from "react";
import { AUDIENCE_LABELS, type AudienceId } from "@/features/content/audience";
import {
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  STYLE_PRESET_LABELS,
  resolveStyleProfile,
  type StylePreset,
  type StyleProfile
} from "@/features/content/style-profile";

export interface StyleProfileControlProps {
  value: StyleProfile;
  disabled?: boolean;
  onChange: (profile: StyleProfile) => void;
}

const presetOrder: StylePreset[] = [
  "popular_science_teacher",
  "plain_explainer",
  "rational_analyst",
  "friend_chat",
  "storyteller",
  "funny_storyteller",
  "knowledge_cards",
  "custom"
];

const audienceOrder: AudienceId[] = ["general_beginner", "office_desk", "senior_reader"];

export function StyleProfileControl({ value, disabled = false, onChange }: StyleProfileControlProps) {
  const [instructions, setInstructions] = useState(value.customInstructions);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInstructions(value.customInstructions);
  }, [value.customInstructions]);

  function selectPreset(preset: StylePreset) {
    // 受众与预设正交：换风格不能顺手把读者也重置掉。
    onChange(resolveStyleProfile(preset, instructions, value.audience));
  }

  function selectAudience(audience: AudienceId) {
    onChange({ ...value, audience });
  }

  function updateInstructions(next: string) {
    const clipped = next.slice(0, MAX_CUSTOM_INSTRUCTIONS_LENGTH);
    setInstructions(clipped);
    onChange({ ...value, customInstructions: clipped });
  }

  return (
    <div className="style-profile-control">
      <label className="field-label" htmlFor="style-audience">
        目标读者
      </label>
      <select
        id="style-audience"
        className="field-control"
        value={value.audience}
        disabled={disabled}
        onChange={(event) => selectAudience(event.target.value as AudienceId)}
      >
        {audienceOrder.map((audience) => (
          <option key={audience} value={audience}>
            {AUDIENCE_LABELS[audience]}
          </option>
        ))}
      </select>

      <label className="field-label" htmlFor="style-preset">
        人物语言风格
      </label>
      <select
        id="style-preset"
        className="field-control"
        value={value.preset}
        disabled={disabled}
        onChange={(event) => selectPreset(event.target.value as StylePreset)}
      >
        {presetOrder.map((preset) => (
          <option key={preset} value={preset}>
            {STYLE_PRESET_LABELS[preset]}
          </option>
        ))}
      </select>

      {value.preset === "custom" ? (
        <label className="field-label" htmlFor="style-custom-instructions">
          自定义说明
          <textarea
            id="style-custom-instructions"
            className="field-control style-custom-instructions"
            value={instructions}
            disabled={disabled}
            maxLength={MAX_CUSTOM_INSTRUCTIONS_LENGTH}
            placeholder="例如：像耐心的高中老师一样解释，多用具体数字。"
            onChange={(event) => updateInstructions(event.target.value)}
          />
        </label>
      ) : null}

      <p className="style-profile-hint">
        {value.tone}｜{value.explanationStyle}
      </p>
    </div>
  );
}
