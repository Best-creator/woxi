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
  /** 首位追加「默认」空值选项：选中后不透传，由服务端按任务类型选默认模型。 */
  includeDefaultOption?: boolean;
  defaultOptionLabel?: string;
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
  includeDefaultOption = false,
  defaultOptionLabel = "默认（服务端配置）",
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
          {includeDefaultOption ? <option value="">{defaultOptionLabel}</option> : null}
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
