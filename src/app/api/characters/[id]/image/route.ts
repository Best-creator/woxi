import { getReferenceCharacterRepository, getCharacterImageStore } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export function createCharacterImageRouteHandler(
  characters = getReferenceCharacterRepository(),
  store = getCharacterImageStore()
) {
  return async function GET(_request: Request, context: RouteContext) {
    const { id } = await context.params;
    const character = await characters.findById(id);
    if (!character) {
      return Response.json({ error: "参考形象不存在" }, { status: 404 });
    }
    try {
      const bytes = store.read(character.filePath);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "content-type": character.mimeType,
          "cache-control": "private, max-age=300"
        }
      });
    } catch {
      return Response.json({ error: "参考图文件缺失" }, { status: 404 });
    }
  };
}

export const GET = (request: Request, context: RouteContext) =>
  createCharacterImageRouteHandler()(request, context);
