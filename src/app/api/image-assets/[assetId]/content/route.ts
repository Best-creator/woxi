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

function notFound() {
  return new Response(null, { status: 404 });
}

export function createImageAssetContentRouteHandler(images: ImageAssetRepository) {
  return async function GET(_request: Request, context: RouteContext) {
    const { assetId } = await context.params;
    const asset = await images.findByAssetId(assetId);
    if (!asset || asset.status === "disabled") return notFound();

    // Generated files require a trusted storage layer; this phase never reads user-controlled paths.
    if (asset.status === "generated") return notFound();

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
