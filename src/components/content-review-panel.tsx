"use client";

import { Check, CircleAlert, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import type { ContentReviewResult } from "@/features/content/ports";
import type { ArticleReview } from "@/features/revisions/domain";
import { ModelSelect } from "./model-select";
import type { ReviewModelSelect } from "./outline-review-panel";

export interface ContentReviewPanelProps {
  review: ArticleReview<ContentReviewResult> | null;
  actionReview?: ArticleReview<ContentReviewResult> | null;
  isStale: boolean;
  staleOutline?: boolean;
  canReview: boolean;
  isReviewing?: boolean;
  isApproving?: boolean;
  approved?: boolean;
  disabled?: boolean;
  modelSelect?: ReviewModelSelect;
  onReview: () => void;
  onApprove: (acknowledgeWarnings: boolean) => void;
  onLocateIssue?: (blockIds: string[]) => void;
}

const statusCopy = {
  passed: "审核通过",
  needs_revision: "需要修订",
  blocked: "审核阻断"
} as const;

const dimensionLabels: Array<[keyof ContentReviewResult, string]> = [
  ["clarity", "清晰度"],
  ["beginnerFriendliness", "零基础友好"],
  ["coherence", "连贯性"],
  ["engagement", "吸引力"],
  ["outlineCoverage", "大纲覆盖"],
  ["sourceFidelity", "资料一致"],
  ["styleMatch", "风格匹配"]
];

export function ContentReviewPanel({
  review,
  actionReview,
  isStale,
  staleOutline = false,
  canReview,
  isReviewing = false,
  isApproving = false,
  approved = false,
  disabled = false,
  modelSelect,
  onReview,
  onApprove,
  onLocateIssue
}: ContentReviewPanelProps) {
  const [acknowledgedReviewId, setAcknowledgedReviewId] = useState<string | null>(null);
  const result = review?.result;
  const action = actionReview === undefined ? review : actionReview;
  const actionResult = action?.result;
  const requiresAcknowledgement = actionResult?.status === "needs_revision" && !isStale;
  const acknowledgeWarnings = !isStale && acknowledgedReviewId === action?.id;
  // 审核可选：没有审核结果也允许直接确认（未审核路径），仅阻断、警告未知悉等情形禁用。
  const approvalBlocked =
    disabled ||
    isApproving ||
    (actionResult ? isStale : false) ||
    staleOutline ||
    actionResult?.status === "blocked" ||
    (requiresAcknowledgement && !acknowledgeWarnings) ||
    approved;

  return (
    <section className="content-review-panel" aria-labelledby="content-review-heading">
      <div className="outline-panel-heading">
        <div>
          <p className="panel-label">审核与确认</p>
          <h2 id="content-review-heading">分镜文案审核</h2>
        </div>
        {result && !isStale ? (
          <span className={`review-status review-status-${result.status}`}>{statusCopy[result.status]}</span>
        ) : null}
      </div>

      {staleOutline ? <p className="review-stale" role="status">当前正文基于旧大纲</p> : null}
      {!staleOutline && isStale ? <p className="review-stale" role="status">审核已过期</p> : null}
      {!result ? <p className="panel-empty">审核为可选步骤：可以直接确认内容，也可以先审核再确认</p> : null}

      {result ? (
        <div className="review-summary">
          <p>{result.summary}</p>
          <ul className="review-scores">
            {dimensionLabels.map(([key, label]) => {
              const score = result[key];
              return (
                <li key={key}>
                  <span>{label}</span>
                  {typeof score === "number" ? (
                    <span aria-label={`${label} ${score} 分`}>{score}/5</span>
                  ) : (
                    // 没有启用资料时 sourceFidelity 为 null：显式标注「不适用」而不是静默省略。
                    <span className="review-score-empty" aria-label={`${label} 不适用`}>
                      不适用
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {result.issues.length ? (
            <ul className="review-issues">
              {result.issues.map((issue, index) => (
                <li key={`${issue.message}-${index}`}>
                  <button
                    className={`review-issue review-issue-${issue.severity}`}
                    type="button"
                    disabled={!onLocateIssue || issue.blockIds.length === 0}
                    onClick={() => onLocateIssue?.(issue.blockIds)}
                  >
                    {issue.message}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {modelSelect ? (
        <ModelSelect
          enabled={modelSelect.enabled}
          availableModels={modelSelect.availableModels}
          value={modelSelect.value}
          id="content-review-model"
          label="审核模型"
          includeDefaultOption
          defaultOptionLabel="默认（轻量快模型）"
          onChange={modelSelect.onChange}
        />
      ) : null}

      {requiresAcknowledgement ? (
        <label className="review-acknowledgement">
          <input
            type="checkbox"
            checked={acknowledgeWarnings}
            disabled={disabled || isApproving}
            onChange={(event) => setAcknowledgedReviewId(event.target.checked ? action?.id ?? null : null)}
          />
          我已了解审核警告，仍要确认内容
        </label>
      ) : null}

      <div className="review-actions">
        <button
          className="button button-secondary"
          type="button"
          disabled={disabled || isReviewing || isApproving || !canReview || staleOutline}
          onClick={onReview}
        >
          <Sparkles size={15} aria-hidden="true" />
          {isReviewing ? "审核中..." : "审核文案"}
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={approvalBlocked}
          onClick={() => onApprove(acknowledgeWarnings)}
        >
          {approved ? <Check size={15} aria-hidden="true" /> : actionResult?.status === "blocked" ? <ShieldAlert size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
          {approved ? "内容已确认" : actionResult ? "确认内容" : "直接确认（未审核）"}
        </button>
      </div>
    </section>
  );
}
