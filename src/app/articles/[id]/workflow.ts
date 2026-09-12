import type { Article } from "@/features/articles/domain";

export const WORKFLOW_STEPS = ["sources", "outline", "article", "images"] as const;
export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];
export type WorkflowStepStatus = "current" | "completed" | "available" | "locked";

export interface WorkflowStepState {
  id: WorkflowStep;
  label: string;
  status: WorkflowStepStatus;
  lockedReason?: string;
}

const labels: Record<WorkflowStep, string> = {
  sources: "资料来源",
  outline: "文章大纲",
  article: "正文文章",
  images: "配图"
};

export function isArticleDraftCurrent(article: Article) {
  return (
    article.blocks.length > 0 &&
    article.planning.contentOutlineRevisionId !== null &&
    article.planning.contentOutlineRevisionId === article.planning.confirmedOutlineRevisionId
  );
}

export function parseWorkflowStep(value: string | null | undefined): WorkflowStep | null {
  if (!value) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  return (WORKFLOW_STEPS as readonly string[]).includes(decoded)
    ? (decoded as WorkflowStep)
    : null;
}

export function getWorkflowSteps(
  article: Article,
  imageAssetCount: number,
  activeStep?: string | null
): WorkflowStepState[] {
  const sourcesComplete = article.brief !== null;
  const outlineReady = article.topic.trim().length > 0;
  const outlineComplete = article.outline.length > 0 && article.outlineConfirmedAt !== null && article.planning.confirmedOutlineRevisionId !== null && (article.status === "outline_ready" || article.status === "editing" || article.status === "content_ready" || article.status === "ready_to_publish");
  const articleComplete = outlineComplete && isArticleDraftCurrent(article) && (article.status === "editing" || article.status === "content_ready" || article.status === "ready_to_publish");
  const imagesComplete = articleComplete && imageAssetCount > 0;
  const complete: Record<WorkflowStep, boolean> = {
    sources: sourcesComplete,
    outline: outlineComplete,
    article: articleComplete,
    images: imagesComplete
  };
  const enterable: Record<WorkflowStep, boolean> = {
    sources: true,
    outline: outlineReady,
    article: outlineComplete,
    images: articleComplete
  };
  const requested = parseWorkflowStep(activeStep);
  const current = requested && enterable[requested]
    ? requested
    : WORKFLOW_STEPS.find((step) => enterable[step] && !complete[step])
      ?? [...WORKFLOW_STEPS].reverse().find((step) => enterable[step])
      ?? "sources";

  return WORKFLOW_STEPS.map((id) => ({
    id,
    label: labels[id],
    status: id === current ? "current" : complete[id] ? "completed" : enterable[id] ? "available" : "locked",
    ...(enterable[id] ? {} : { lockedReason: `请先完成${labels[WORKFLOW_STEPS[WORKFLOW_STEPS.indexOf(id) - 1]]}` })
  }));
}
