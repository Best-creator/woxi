"use client";

import type { WorkflowStep, WorkflowStepState } from "@/app/articles/[id]/workflow";

export interface WorkflowStepperProps {
  steps: WorkflowStepState[];
  onSelect?: (step: WorkflowStep) => void;
}

export function WorkflowStepper({ steps, onSelect }: WorkflowStepperProps) {
  return (
    <nav aria-label="文章工作流" className="workflow-stepper">
      <ol>
        {steps.map((step) => {
          const locked = step.status === "locked";
          const reasonId = `${step.id}-locked-reason`;
          const statusLabel = step.status === "current" ? "当前" : step.status === "completed" ? "已完成" : step.status === "available" ? "可进入" : "已锁定";
          return (
            <li key={step.id} className={`workflow-step workflow-step-${step.status}`}>
              <button
                type="button"
                aria-current={step.status === "current" ? "step" : undefined}
                aria-disabled={locked}
                aria-describedby={locked ? reasonId : undefined}
                disabled={locked}
                title={step.lockedReason}
                onClick={() => !locked && onSelect?.(step.id)}
              >
                <span aria-hidden="true">{step.status === "completed" ? "✓" : steps.indexOf(step) + 1}</span>
                <span>{step.label}</span>
                <span className="workflow-step-status">{statusLabel}</span>
              </button>
              {locked && step.lockedReason ? <small id={reasonId}>{step.lockedReason}</small> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
