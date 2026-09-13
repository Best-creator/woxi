import { z } from "zod";
import {
  getReferenceCharacterRepository,
  getCharacterImageStore,
  getCharacterDescriber
} from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 150;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RouteDeps {
  characters?: ReturnType<typeof getReferenceCharacterRepository>;
  store?: ReturnType<typeof getCharacterImageStore>;
  describer?: ReturnType<typeof getCharacterDescriber>;
}

const requestSchema = z.object({
  model: z.string().trim().min(1).optional()
});

/** AI 看图提取形象描述：读参考图 → 视觉模型生成外形描述 → 存回形象档案。 */
export function createCharacterDescribeRouteHandler({
  characters = getReferenceCharacterRepository(),
  store = getCharacterImageStore(),
  describer = getCharacterDescriber()
}: RouteDeps = {}) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    const character = await characters.findById(id);
    if (!character) {
      return Response.json({ error: "参考形象不存在" }, { status: 404 });
    }
    if (!describer) {
      return Response.json({ error: "未配置 LLM 服务，请检查 env/.env.local" }, { status: 400 });
    }

    let input: { model?: string };
    try {
      input = requestSchema.parse(await request.json());
    } catch {
      input = {};
    }

    let bytes: Buffer;
    try {
      bytes = store.read(character.filePath);
    } catch {
      return Response.json({ error: "参考图文件缺失，请重新上传" }, { status: 400 });
    }
    const imageDataUrl = `data:${character.mimeType};base64,${bytes.toString("base64")}`;

    try {
      const description = await describer.describe({
        imageDataUrl,
        ...(input.model ? { model: input.model } : {})
      });
      const updated = await characters.update(id, { description });
      return Response.json({ character: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : "形象提取失败，请稍后重试";
      return Response.json({ error: message }, { status: 502 });
    }
  };
}

export const POST = (request: Request, context: RouteContext) =>
  createCharacterDescribeRouteHandler()(request, context);
