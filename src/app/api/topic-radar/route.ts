import { getTopicRadar } from "@/features/topic-radar/run";
import type { TopicRadarSnapshot } from "@/features/topic-radar/types";

export const runtime = "nodejs";

/**
 * 热点选题雷达：GET /api/topic-radar（?refresh=1 强制绕过 30 分钟缓存）。
 * 只读、无外部写依赖；上游七路来源内部已隔离失败，这里兜底 502。
 */
export function createTopicRadarRouteHandlers(fetchRadar: (options: { refresh?: boolean }) => Promise<TopicRadarSnapshot>) {
  return {
    async GET(request: Request) {
      const url = new URL(request.url);
      const refresh = url.searchParams.get("refresh") === "1";
      try {
        const snapshot = await fetchRadar({ refresh });
        return Response.json(snapshot);
      } catch {
        return Response.json({ error: "热点选题抓取失败，请稍后重试" }, { status: 502 });
      }
    }
  };
}

export function GET(request: Request) {
  return createTopicRadarRouteHandlers(getTopicRadar).GET(request);
}
