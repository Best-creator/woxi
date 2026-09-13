import { z } from "zod";
import {
  getReferenceCharacterRepository,
  getCharacterImageStore
} from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RouteDeps {
  characters?: ReturnType<typeof getReferenceCharacterRepository>;
  store?: ReturnType<typeof getCharacterImageStore>;
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  persona: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional()
});

export function createCharacterRouteHandler({
  characters = getReferenceCharacterRepository(),
  store = getCharacterImageStore()
}: RouteDeps = {}) {
  return {
    async PATCH(request: Request, context: RouteContext) {
      const { id } = await context.params;
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
      }
      const patch = patchSchema.safeParse(body);
      if (!patch.success) {
        return Response.json({ error: "形象信息无效" }, { status: 400 });
      }
      const updated = await characters.update(id, patch.data);
      if (!updated) {
        return Response.json({ error: "参考形象不存在" }, { status: 404 });
      }
      return Response.json({ character: updated });
    },

    async DELETE(_request: Request, context: RouteContext) {
      const { id } = await context.params;
      const existing = await characters.findById(id);
      if (!existing) {
        return Response.json({ error: "参考形象不存在" }, { status: 404 });
      }
      await characters.remove(id);
      store.remove(existing.filePath);
      return Response.json({ ok: true });
    }
  };
}

export const PATCH = (request: Request, context: RouteContext) =>
  createCharacterRouteHandler().PATCH(request, context);
export const DELETE = (_request: Request, context: RouteContext) =>
  createCharacterRouteHandler().DELETE(_request, context);
