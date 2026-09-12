import type { OutlineWorkflowRepository } from "./workflow-repository";

export interface RestoreOutlineVersionCommand {
  articleId: string;
  versionId: string;
  expectedUpdatedAt: string;
}

export type RestoreOutlineVersionResult = Awaited<ReturnType<OutlineWorkflowRepository["restoreOutline"]>>;

export async function restoreOutlineVersion(
  command: RestoreOutlineVersionCommand,
  dependencies: { workflow: OutlineWorkflowRepository }
): Promise<RestoreOutlineVersionResult> {
  return dependencies.workflow.restoreOutline(command);
}
