export const DEMO_CONTENT_MODEL = "demo-content";

export function resolveContentModel(
  selectedModel: string | undefined,
  defaultModel: string | undefined
) {
  return selectedModel ?? defaultModel ?? DEMO_CONTENT_MODEL;
}
