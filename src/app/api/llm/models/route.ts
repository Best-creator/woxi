import { getServerConfig } from "@/server/config";
import { discoverLlmModels, pickPreferredModel } from "@/server/llm-models";

export const runtime = "nodejs";

export async function GET() {
  const config = getServerConfig();
  if (!config.llm) {
    return Response.json({ models: [], defaultModel: null, enabled: false });
  }
  try {
    const models = await discoverLlmModels(config.llm);
    return Response.json({ models, defaultModel: pickPreferredModel(models), enabled: true });
  } catch (error) {
    const status = error instanceof Error && "code" in error && (error as { code?: string }).code === "authentication" ? 502 : 502;
    return Response.json({ error: error instanceof Error ? error.message : "模型列表暂时不可用" }, { status });
  }
}
