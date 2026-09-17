import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteReferenceCharacterRepository } from "@/features/characters/sqlite-repository";
import type { CharacterDescriber } from "@/features/characters/character-describer";
import { OpenAiCharacterDescriber } from "@/features/characters/openai-character-describer";
import { DemoContentReviewer } from "@/features/content/demo-content-agents";
import { DemoStoryboardDesigner } from "@/features/content/demo-storyboard-designer";
import { OpenAiStoryboardDesigner } from "@/features/content/openai-storyboard-designer";
import { OpenAiContentReviewer } from "@/features/content/openai-content-reviewer";
import type { ContentReviewer, StoryboardDesigner } from "@/features/content/ports";
import { DemoVisualPlanner } from "@/features/images/demo-visual-planner";
import { OpenAiVisualPlanner } from "@/features/images/openai-visual-planner";
import {
  HeuristicComicStripModeRouter,
  OpenAiComicStripModeRouter,
  type ComicStripModeRouter
} from "@/features/images/comic-strip-mode-router";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import type { ImageGenerator } from "@/features/images/image-generator";
import { OpenAiImageGenerator } from "@/features/images/openai-image-generator";
import type { ImageCatalogEntry, ImageSite } from "@/features/images/image-catalog";
import { fetchImageCatalog } from "@/features/images/image-catalog";
import type { WechatDraftPublisher } from "@/features/publishing/wechat-draft";
import { OfficialWechatDraftPublisher } from "@/features/publishing/official-wechat-draft-publisher";
import { DemoOutlineGenerator, DemoOutlineReviewer } from "@/features/outlines/demo-outline-agents";
import { OpenAiOutlineGenerator } from "@/features/outlines/openai-outline-generator";
import { OpenAiOutlineReviewer } from "@/features/outlines/openai-outline-reviewer";
import type { OutlineGenerator, OutlineReviewer } from "@/features/outlines/ports";
import { BingWebSearch } from "@/features/research/bing-web-search";
import { NullWebSearch, isWebSearchDisabled } from "@/features/research/null-web-search";
import { ResilientWebSearch } from "@/features/research/resilient-web-search";
import { SogouWebSearch } from "@/features/research/sogou-web-search";
import type { WebSearchPort } from "@/features/research/types";
import { SqliteRevisionRepository } from "@/features/revisions/sqlite-repository";
import { SqliteOutlineWorkflowRepository } from "@/features/outlines/sqlite-workflow-repository";
import { SqliteContentWorkflowRepository } from "@/features/content/sqlite-workflow-repository";
import { SqliteStyleLibraryRepository } from "@/features/style-library/sqlite-repository";
import type { VisualPlanner } from "@/features/images/visual-planner";
import { openDatabase } from "./db";
import { getCharacterImageStore } from "./character-storage";
export { getCharacterImageStore };
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { SqliteSourceWorkflow } from "@/features/sources/sqlite-workflow";
import { getServerConfig } from "./config";
import { DEMO_OUTLINE_MODEL } from "@/features/outlines/model";
import { DEMO_CONTENT_MODEL } from "@/features/content/model";
import { DEMO_RESEARCH_MODEL } from "@/features/research/model";

let articleRepository: SqliteArticleRepository | undefined;
let sourceRepository: SqliteSourceRepository | undefined;
let sourceWorkflow: SqliteSourceWorkflow | undefined;
let imageAssetRepository: SqliteImageAssetRepository | undefined;
let revisionRepository: SqliteRevisionRepository | undefined;
let outlineWorkflowRepository: SqliteOutlineWorkflowRepository | undefined;
let contentWorkflowRepository: SqliteContentWorkflowRepository | undefined;
let contentReviewer: ContentReviewer | undefined;
let storyboardDesigner: StoryboardDesigner | undefined;
let visualPlanner: VisualPlanner | undefined;
let outlineGenerator: OutlineGenerator | undefined;
let outlineReviewer: OutlineReviewer | undefined;
let openAiJsonClient: OpenAiJsonClient | undefined;
let webSearch: WebSearchPort | undefined;
let imageGenerator: ImageGenerator | undefined;
let characterRepository: SqliteReferenceCharacterRepository | undefined;
let characterDescriber: CharacterDescriber | undefined;
let database: ReturnType<typeof openDatabase> | undefined;

/** 供轻量仓储（如配图偏好）复用的共享数据库连接。 */
export function getDatabase() {
  return getDatabaseInternal();
}

function getDatabaseInternal() {
  if (!database) {
    database = openDatabase(getServerConfig().databasePath);
  }
  return database;
}

export function getArticleRepository() {
  articleRepository ??= new SqliteArticleRepository(getDatabase());
  return articleRepository;
}

export function getSourceRepository() {
  sourceRepository ??= new SqliteSourceRepository(getDatabase());
  return sourceRepository;
}

export function getSourceWorkflow() {
  sourceWorkflow ??= new SqliteSourceWorkflow(getDatabase());
  return sourceWorkflow;
}

export function getImageAssetRepository() {
  imageAssetRepository ??= new SqliteImageAssetRepository(getDatabase());
  return imageAssetRepository;
}

export function getRevisionRepository() {
  revisionRepository ??= new SqliteRevisionRepository(getDatabase());
  return revisionRepository;
}

export function getOutlineWorkflowRepository() {
  outlineWorkflowRepository ??= new SqliteOutlineWorkflowRepository(getDatabase());
  return outlineWorkflowRepository;
}

export function getContentWorkflowRepository() {
  contentWorkflowRepository ??= new SqliteContentWorkflowRepository(getDatabase());
  return contentWorkflowRepository;
}

export function getOutlineDefaultModel() {
  return getServerConfig().llm?.model ?? DEMO_OUTLINE_MODEL;
}

export function getOutlineReviewDefaultModel() {
  const llm = getServerConfig().llm;
  return llm?.reviewModel || llm?.model || DEMO_OUTLINE_MODEL;
}

export function getContentDefaultModel() {
  return getServerConfig().llm?.model ?? DEMO_CONTENT_MODEL;
}

export function getContentReviewDefaultModel() {
  const llm = getServerConfig().llm;
  return llm?.reviewModel || llm?.model || DEMO_CONTENT_MODEL;
}

export function getStoryboardDesigner(): StoryboardDesigner {
  if (!storyboardDesigner) {
    const client = getOpenAiJsonClient();
    storyboardDesigner = client ? new OpenAiStoryboardDesigner(client) : new DemoStoryboardDesigner();
  }
  return storyboardDesigner;
}

export function getContentReviewer(): ContentReviewer {
  if (!contentReviewer) {
    const client = getOpenAiJsonClient();
    contentReviewer = client ? new OpenAiContentReviewer(client) : new DemoContentReviewer();
  }
  return contentReviewer;
}

export function getVisualPlanner() {
  if (!visualPlanner) {
    const config = getServerConfig();
    visualPlanner = config.llm
      ? new OpenAiVisualPlanner({
          baseUrl: config.llm.baseUrl,
          apiKey: config.llm.apiKey,
          // 视觉规划是结构化 JSON 输出任务，深度推理模型（reasoning tokens 占比高）
          // 规划一次可达两分钟，容易撞上超时；优先用 LLM_VISUAL_MODEL 指定的快模型。
          model: config.llm.visualModel || config.llm.model
        })
      : new DemoVisualPlanner();
  }
  return visualPlanner;
}

let comicStripModeRouter: ComicStripModeRouter | undefined;

/** 漫画长图排法路由：配了 LLM 用模型决策，没配用确定性规则（E2E 依赖）。 */
export function getComicStripModeRouter(): ComicStripModeRouter {
  if (!comicStripModeRouter) {
    const client = getOpenAiJsonClient();
    comicStripModeRouter = client
      ? new OpenAiComicStripModeRouter(
          client,
          getServerConfig().llm?.visualModel || getServerConfig().llm?.model
        )
      : new HeuristicComicStripModeRouter();
  }
  return comicStripModeRouter;
}

export function getReferenceCharacterRepository() {
  characterRepository ??= new SqliteReferenceCharacterRepository(getDatabase());
  return characterRepository;
}

let styleLibraryRepository: SqliteStyleLibraryRepository | undefined;

export function getStyleLibraryRepository() {
  styleLibraryRepository ??= new SqliteStyleLibraryRepository(getDatabase());
  return styleLibraryRepository;
}

export function getCharacterDescriber(): CharacterDescriber | null {
  const config = getServerConfig();
  if (!config.llm) return null;
  if (!characterDescriber) {
    characterDescriber = new OpenAiCharacterDescriber({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: getVisionDefaultModel()
    });
  }
  return characterDescriber;
}

/** 看图任务（参考形象提取）的默认模型；优先 LLM_VISION_MODEL。 */
export function getVisionDefaultModel() {
  const llm = getServerConfig().llm;
  return llm?.visionModel || llm?.model || "";
}

function getOpenAiJsonClient() {
  const config = getServerConfig();
  if (!config.llm) return undefined;
  openAiJsonClient ??= new OpenAiJsonClient(config.llm);
  return openAiJsonClient;
}

/** 供联网资料等功能使用的 JSON 客户端；未配置 LLM 时返回 null（调用方自行降级）。 */
export function getLlmJsonClient() {
  return getOpenAiJsonClient() ?? null;
}

export function getResearchDefaultModel() {
  const llm = getServerConfig().llm;
  return llm?.researchModel || llm?.model || DEMO_RESEARCH_MODEL;
}

export function getOutlineGenerator(): OutlineGenerator {
  if (!outlineGenerator) {
    const client = getOpenAiJsonClient();
    outlineGenerator = client ? new OpenAiOutlineGenerator(client) : new DemoOutlineGenerator();
  }
  return outlineGenerator;
}

export function getOutlineReviewer(): OutlineReviewer {
  if (!outlineReviewer) {
    const client = getOpenAiJsonClient();
    outlineReviewer = client ? new OpenAiOutlineReviewer(client) : new DemoOutlineReviewer();
  }
  return outlineReviewer;
}

export function getWebSearch(): WebSearchPort {
  webSearch ??= isWebSearchDisabled()
    ? new NullWebSearch()
    : new ResilientWebSearch(new SogouWebSearch(), new BingWebSearch());
  return webSearch;
}

/** 真实图片生成器；未配置 IMAGE_API_KEY 时返回 null（调用方自行降级或拒绝）。 */
export function getImageGenerator(): ImageGenerator | null {
  const sites = getImageSites();
  if (!sites) return null;
  imageGenerator ??= new OpenAiImageGenerator(sites, fetch, getImageModelCatalog);
  return imageGenerator;
}

/** 全部生图站点（主站 + IMAGE2 额外站）；主站未配置时返回 null。 */
function getImageSites(): ImageSite[] | null {
  const config = getServerConfig();
  if (!config.image) return null;
  const host = (url: string) => {
    try {
      return new URL(url).hostname.split(".")[0];
    } catch {
      return url;
    }
  };
  const sites: ImageSite[] = [{ ...config.image, name: host(config.image.baseUrl) }];
  for (const extra of config.extraImageSites) {
    if (extra.baseUrl !== config.image.baseUrl) {
      sites.push({ ...extra, name: host(extra.baseUrl) });
    }
  }
  return sites;
}

// 生图模型目录：模块级 TTL 缓存，避免每次下拉渲染都请求上游 /v1/models。
const IMAGE_CATALOG_TTL_MS = 10 * 60_000;
let imageCatalogCache: { entries: ImageCatalogEntry[]; fetchedAt: number } | null = null;

/** TTL 内返回缓存目录；过期或首次调用时重新聚合（单站失败自动跳过）。 */
export async function getImageModelCatalog(): Promise<ImageCatalogEntry[]> {
  if (imageCatalogCache && Date.now() - imageCatalogCache.fetchedAt < IMAGE_CATALOG_TTL_MS) {
    return imageCatalogCache.entries;
  }
  const sites = getImageSites() ?? [];
  const entries = await fetchImageCatalog(sites);
  imageCatalogCache = { entries, fetchedAt: Date.now() };
  return entries;
}

/** 测试钩子：清空模型目录缓存。 */
export function resetImageModelCatalogForTest() {
  imageCatalogCache = null;
  imageGenerator = undefined;
}

/**
 * 设置面板保存配置后的热生效钩子：丢弃全部按旧配置构建的适配器单例与生图模型目录缓存，
 * 下一次 getXxx() 按新配置重建。不影响仓储类单例（与 provider 配置无关）。
 */
export function resetProviderAdapters() {
  openAiJsonClient = undefined;
  storyboardDesigner = undefined;
  contentReviewer = undefined;
  visualPlanner = undefined;
  outlineGenerator = undefined;
  outlineReviewer = undefined;
  comicStripModeRouter = undefined;
  characterDescriber = undefined;
  imageGenerator = undefined;
  wechatDraftPublisher = undefined;
  imageCatalogCache = null;
}

let wechatDraftPublisher: WechatDraftPublisher | undefined;

/**
 * 公众号草稿箱推送器；未配置 WECHAT_APPID/WECHAT_APPSECRET 时返回 null。
 * 单例内含 access_token 缓存（2 小时有效，提前刷新）。
 */
export function getWechatDraftPublisher(): WechatDraftPublisher | null {
  const wechat = getServerConfig().wechat;
  if (!wechat) return null;
  wechatDraftPublisher ??= new OfficialWechatDraftPublisher(wechat);
  return wechatDraftPublisher;
}
