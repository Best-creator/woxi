import { readFile, stat } from "node:fs/promises";
import type { ImageAssetRepository } from "@/features/images/repository";
import { getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ generationId: string }>;
}

const contentTypeByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function contentTypeFor(filePath: string) {
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return contentTypeByExtension[extension] ?? "application/octet-stream";
}

function notFound() {
  return new Response(null, { status: 404 });
}

/**
 * 按「生成版本 id」读图，供版本条缩略图与大图预览使用。
 *
 * 与 /api/image-assets/[assetId]/content 的区别：那个永远只给「当前选中」那一版，
 * 这个能取到历史版本，所以选用之前就能先看清楚。
 */
export function createImageGenerationContentRouteHandler(images: ImageAssetRepository) {
  return async function GET(_request: Request, context: RouteContext) {
    const { generationId } = await context.params;
    const generation = await images.findGenerationById(generationId);
    if (!generation) return notFound();

    if (generation.filePath) {
      // 只读编排层写入的受控路径，不处理任何用户可控的路径片段。
      const filePath = generation.filePath;
      try {
        if (!(await stat(filePath)).isFile()) return notFound();
        const binary = await readFile(filePath);
        return new Response(new Uint8Array(binary), {
          headers: {
            "content-type": contentTypeFor(filePath),
            "cache-control": "no-store"
          }
        });
      } catch {
        return notFound();
      }
    }

    // 只有远程图时直接跳过去（上游图床）；本机访问不到图床的站点由此自然回落 404。
    if (generation.publicUrl) {
      return Response.redirect(generation.publicUrl, 302);
    }
    return notFound();
  };
}

export function GET(request: Request, context: RouteContext) {
  return createImageGenerationContentRouteHandler(getImageAssetRepository())(request, context);
}
