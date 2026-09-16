"use client";

import { Check, CircleAlert, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { MAX_USER_INSTRUCTIONS_LENGTH, type OutlineReviewResult } from "@/features/outlines/domain";
import type { ArticleReview } from "@/features/revisions/domain";
import { ModelSelect } from "./model-select";

/** 审核模型选择配置：缺省渲染时不显示下拉，审核走服务端默认（LLM_REVIEW_MODEL）。 */
export interface ReviewModelSelect {
  enabled: boolean;
  availableModels: string[];
  value: string;
  onChange: (model: string) => void;
}

export interface OutlineReviewPanelProps {
  review: ArticleReview<OutlineReviewResult> | null;
  actionReview?: ArticleReview<OutlineReviewResult> | null;
  isStale: boolean;
  canReview: boolean;
  isReviewing?: boolean;
  isConfirming?: boolean;
  isApplyingReview?: boolean;
  confirmed?: boolean;
  disabled?: boolean;
  previewing?: boolean;
  modelSelect?: ReviewModelSelect;
  /**
   * 「补充要求」对话框。只有传了 onRevise 才渲染，老调用方不传就完全不受影响。
   * 它独立于审核状态：审核通过、甚至还没审核，作者都能直接用自然语言提要求。
   */
  instructions?: string;
  canRevise?: boolean;
  isRevising?: boolean;
  onInstructionsChange?: (value: string) => void;
  onRevise?: () => void;
  onReview: () => void;
  onConfirm: (acknowledgeWarnings: boolean) => void;
  onApplyReview?: () => void;
}

const statusCopy = {
  passed: "审核通过",
  needs_revision: "需要修订",
  blocked: "审核阻断"
} as const;

export function OutlineReviewPanel({
  review,
  actionReview,
  isStale,
  canReview,
  isReviewing = false,
  isConfirming = false,
  isApplyingReview = false,
  confirmed = false,
  disabled = false,
  previewing = false,
  modelSelect,
  instructions = "",
  canRevise,
  isRevising = false,
  onInstructionsChange,
  onRevise,
  onReview,
  onConfirm,
  onApplyReview
}: OutlineReviewPanelProps) {
  const [acknowledgedReviewId, setAcknowledgedReviewId] = useState<string | null>(null);
  const result = review?.result;
  const action = actionReview === undefined ? review : actionReview;
  const actionResult = action?.result;
  const requiresAcknowledgement = actionResult?.status === "needs_revision" && !isStale;
  const acknowledgeWarnings = !isStale && acknowledgedReviewId === action?.id;
  const confirmationBlocked = disabled || isConfirming || isApplyingReview || isStale || !actionResult || actionResult.status === "blocked" || (requiresAcknowledgement && !acknowledgeWarnings) || confirmed;
  // 能否修订只取决于「有没有可用的大纲」，与审核结论无关——这正是对话框存在的意义。
  const canReviseNow = canRevise ?? canReview;
  const hasInstructions = instructions.trim().length > 0;
  const reviseDisabled = disabled || isRevising || !canReviseNow || !hasInstructions;
  // 已经写了补充要求时不再显示「只按审核意见改」那个按钮：否则两个按钮看起来都能改大纲，
  // 而其中一个是纯审核链路，容易让人以为自己的要求没生效。写下的要求由下面那个按钮统一带上。
  const canApplyReview = Boolean(
    onApplyReview &&
    actionResult &&
    !isStale &&
    !hasInstructions &&
    (actionResult.status === "needs_revision" || actionResult.status === "blocked")
  );

  return (
    <section className="outline-review-panel" aria-labelledby="outline-review-heading">
      <div className="outline-panel-heading">
        <div>
          <p className="panel-label">审核与确认</p>
          <h2 id="outline-review-heading">大纲审核</h2>
        </div>
        {result && (previewing || !isStale) ? <span className={`review-status review-status-${result.status}`}>{statusCopy[result.status]}</span> : null}
      </div>

      {!previewing && isStale ? <p className="review-stale" role="status">大纲或资料已更新，请重新审核后再确认大纲</p> : null}
      {!result && (previewing || !isStale) ? <p className="panel-empty">{previewing ? "该版本尚未审核" : "生成大纲后可进行审核"}</p> : null}
      {result ? (
        <div className="review-summary">
          <p>{result.summary}</p>
          {result.issues.length ? (
            <ul>
              {result.issues.map((issue, index) => <li key={`${issue.sectionKey}-${index}`}>{issue.message}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {modelSelect && !previewing ? (
        <ModelSelect
          enabled={modelSelect.enabled}
          availableModels={modelSelect.availableModels}
          value={modelSelect.value}
          id="outline-review-model"
          label="审核模型"
          includeDefaultOption
          defaultOptionLabel="默认（轻量快模型）"
          onChange={modelSelect.onChange}
        />
      ) : null}

      {onRevise && !previewing ? (
        <div className="outline-revision-request">
          <label className="field-label" htmlFor="outline-revision-instructions">
            补充要求
            <textarea
              id="outline-revision-instructions"
              className="field-control outline-revision-textarea"
              value={instructions}
              rows={3}
              disabled={disabled || isRevising}
              maxLength={MAX_USER_INSTRUCTIONS_LENGTH}
              placeholder="例如：把第二章拆开讲透机制；开场换成工位上的场景；去掉最后一章。"
              onChange={(event) => onInstructionsChange?.(event.target.value)}
            />
          </label>
          <button
            className="button button-secondary outline-revision-button"
            type="button"
            disabled={reviseDisabled}
            onClick={onRevise}
          >
            <Sparkles size={15} aria-hidden="true" />
            {isRevising ? "修改中..." : "按我的意见改大纲"}
          </button>
          <p className="outline-revision-hint">
            会连同审核意见一起交给模型；审核未通过、甚至还没审核也能直接用。
          </p>
        </div>
      ) : null}

      {requiresAcknowledgement ? (
        <label className="review-acknowledgement">
          <input
            type="checkbox"
            checked={acknowledgeWarnings}
            disabled={disabled || isConfirming}
            onChange={(event) => setAcknowledgedReviewId(event.target.checked ? action?.id ?? null : null)}
          />
          我已了解审核警告，仍要确认大纲
        </label>
      ) : null}

      <div className={`review-actions${canApplyReview ? " review-actions-three" : ""}`}>
        <button className="button button-secondary" type="button" disabled={disabled || isReviewing || isApplyingReview || !canReview} onClick={onReview}>
          <Sparkles size={15} aria-hidden="true" />
          {isReviewing ? "审核中..." : "审核大纲"}
        </button>
        {canApplyReview ? (
          <button className="button button-secondary" type="button" disabled={disabled || isApplyingReview} onClick={onApplyReview}>
            <Sparkles size={15} aria-hidden="true" />
            {isApplyingReview ? "修改中..." : "按审核意见改大纲"}
          </button>
        ) : null}
        <button className="button button-primary" type="button" disabled={confirmationBlocked} onClick={() => onConfirm(acknowledgeWarnings)}>
          {confirmed ? <Check size={15} aria-hidden="true" /> : actionResult?.status === "blocked" ? <ShieldAlert size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
          {confirmed ? "大纲已确认" : "确认大纲"}
        </button>
      </div>
    </section>
  );
}
