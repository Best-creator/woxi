export const DEMO_RESEARCH_MODEL = "demo-research";

export function resolveResearchModel(
  selectedModel: string | undefined,
  defaultModel: string | undefined
) {
  return selectedModel ?? defaultModel ?? DEMO_RESEARCH_MODEL;
}
