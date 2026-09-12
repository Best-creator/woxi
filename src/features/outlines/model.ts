export const DEMO_OUTLINE_MODEL = "demo-outline";

export function resolveOutlineModel(selectedModel: string | undefined, defaultModel: string | undefined) {
  return selectedModel ?? defaultModel ?? DEMO_OUTLINE_MODEL;
}
