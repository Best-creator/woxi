import { z } from "zod";
import type { StyleLibraryRepository } from "@/features/style-library/domain";
import { importStyles } from "@/features/style-library/import-styles";
import { getStyleLibraryRepository } from "@/server/services";

export const runtime = "nodejs";

const importSchema = z.object({
  /** style-lab「导出 JSON」的完整文件内容（{version, styles:[...]}）。 */
  file: z.unknown()
});

export function createStyleLibraryRouteHandler(repository: StyleLibraryRepository) {
  return {
    async GET() {
      const entries = await repository.list();
      return Response.json({
        styles: entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          summary: entry.profile.summary,
          palette: entry.profile.palette,
          source: entry.source,
          updatedAt: entry.updatedAt
        }))
      });
    },

    async POST(request: Request) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
      }
      const input = importSchema.safeParse(body);
      if (!input.success) {
        return Response.json({ error: "请求体缺少 file 字段" }, { status: 400 });
      }
      const result = await importStyles(input.data.file, repository);
      if (!result.imported && !result.skipped) {
        return Response.json({ error: result.errors[0] ?? "导入失败：文件里没有可用的风格" }, { status: 400 });
      }
      return Response.json(result);
    }
  };
}

export function GET() {
  return createStyleLibraryRouteHandler(getStyleLibraryRepository()).GET();
}

export function POST(request: Request) {
  return createStyleLibraryRouteHandler(getStyleLibraryRepository()).POST(request);
}
