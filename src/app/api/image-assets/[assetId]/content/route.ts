import { readFile, stat } from "node:fs/promises";
import type { ImageAssetRepository } from "@/features/images/repository";
import { renderPlaceholderSvg } from "@/features/images/render-placeholder-svg";
import { getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

const svgHeaders = {
  "content-type": "image/svg+xml; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "x-content-type-options": "nosniff"
};

const contentTypeByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function notFound() {
  return new Response(null, { status: 404 });
}

function contentTypeFor(filePath: string) {
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return contentTypeByExtension[extension] ?? "application/octet-stream";
}

export function createImageAssetContentRouteHandler(images: ImageAssetRepository) {
  return async function GET(_request: Request, context: RouteContext) {
    const { assetId } = await context.params;
    const asset = await images.findByAssetId(assetId);
    if (!asset || asset.status === "disabled") return notFound();

    // 生成结果由编排层写入受控目录（文件名是服务端生成的 assetId），
    // 这里只读该受控路径，不处理任何用户可控的路径片段。
    if (asset.status === "generated") {
      const filePath = asset.filePath;
      if (!filePath) return notFound();
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

    return new Response(
      renderPlaceholderSvg({
        aspectRatio: asset.aspectRatio,
        altText: asset.altText,
        purpose: asset.purpose
      }),
      { headers: svgHeaders }
    );
  };
}

export function GET(request: Request, context: RouteContext) {
  return createImageAssetContentRouteHandler(getImageAssetRepository())(request, context);
}
