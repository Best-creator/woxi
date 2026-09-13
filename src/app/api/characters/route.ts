import { randomUUID } from "node:crypto";
import { CHARACTER_MAX_BYTES, CHARACTER_MIME_TYPES } from "@/features/characters/domain";
import {
  getReferenceCharacterRepository,
  getCharacterImageStore
} from "@/server/services";

export const runtime = "nodejs";

interface RouteDeps {
  characters?: ReturnType<typeof getReferenceCharacterRepository>;
  store?: ReturnType<typeof getCharacterImageStore>;
}

export function createCharactersRouteHandler({
  characters = getReferenceCharacterRepository(),
  store = getCharacterImageStore()
}: RouteDeps = {}) {
  return {
    async GET() {
      const list = await characters.list();
      return Response.json({ characters: list });
    },

    async POST(request: Request) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return Response.json({ error: "请求不是有效的表单数据" }, { status: 400 });
      }

      const file = form.get("file");
      const name = String(form.get("name") ?? "").trim();
      const persona = String(form.get("persona") ?? "").trim();
      const description = String(form.get("description") ?? "").trim();

      if (!name || name.length > 40) {
        return Response.json({ error: "请填写不超过 40 字的形象名称" }, { status: 400 });
      }
      if (persona.length > 200) {
        return Response.json({ error: "身份设定不能超过 200 字" }, { status: 400 });
      }
      if (description.length > 1000) {
        return Response.json({ error: "形象描述不能超过 1000 字" }, { status: 400 });
      }
      if (!(file instanceof File)) {
        return Response.json({ error: "请选择一张参考图" }, { status: 400 });
      }
      const mimeType = file.type;
      if (!CHARACTER_MIME_TYPES[mimeType]) {
        return Response.json({ error: "参考图仅支持 PNG / JPG / WebP / GIF" }, { status: 400 });
      }
      if (file.size > CHARACTER_MAX_BYTES) {
        return Response.json({ error: "参考图不能超过 5MB" }, { status: 400 });
      }

      const id = randomUUID();
      const filePath = store.save(id, mimeType, Buffer.from(await file.arrayBuffer()));
      const character = await characters.create({ name, persona, description, mimeType, filePath }, id);
      return Response.json({ character }, { status: 201 });
    }
  };
}

export const GET = () => createCharactersRouteHandler().GET();
export const POST = (request: Request) => createCharactersRouteHandler().POST(request);
