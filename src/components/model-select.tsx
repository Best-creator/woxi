"use client";

import { RefreshCw } from "lucide-react";

export interface ModelSelectProps {
  enabled: boolean;
  availableModels: string[];
  value: string;
  id?: string;
  label?: string;
  disabled?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onChange: (model: string) => void;
}

export function ModelSelect({
  enabled,
  availableModels,
  value,
  id = "outline-model",
  label = "生成模型",
  disabled = false,
  refreshing = false,
  onRefresh,
  onChange
}: ModelSelectProps) {
  return (
    <div className="outline-model-control">
      <label className="outline-control-field" htmlFor={id}>
        <span>{label}</span>
        <select
          id={id}
          value={value}
          disabled={disabled || !enabled || refreshing}
          onChange={(event) => onChange(event.target.value)}
        >
          {enabled ? availableModels.map((model) => (
            <option key={model} value={model}>{model}</option>
          )) : <option value="">演示模式</option>}
        </select>
      </label>
      {onRefresh ? (
        <button
          className="icon-button model-refresh-button"
          type="button"
          aria-label="刷新可用模型"
          title="刷新可用模型"
          disabled={disabled || !enabled || refreshing}
          onClick={onRefresh}
        >
          <RefreshCw size={15} aria-hidden="true" className={refreshing ? "is-spinning" : undefined} />
        </button>
      ) : null}
    </div>
  );
}
