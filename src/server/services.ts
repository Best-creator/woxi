import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { DemoContentGenerator, DemoContentReviewer } from "@/features/content/demo-content-agents";
import { OpenAiContentGenerator } from "@/features/content/openai-content-generator";
import { OpenAiContentReviewer } from "@/features/content/openai-content-reviewer";
import type { ContentGenerator, ContentReviewer } from "@/features/content/ports";
import { DemoVisualPlanner } from "@/features/images/demo-visual-planner";
import { OpenAiVisualPlanner } from "@/features/images/openai-visual-planner";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import type { ImageGenerator } from "@/features/images/image-generator";
import { OpenAiImageGenerator } from "@/features/images/openai-image-generator";
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
import type { VisualPlanner } from "@/features/images/visual-planner";
import { openDatabase } from "./db";
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
let contentGenerator: ContentGenerator | undefined;
let contentReviewer: ContentReviewer | undefined;
let visualPlanner: VisualPlanner | undefined;
let outlineGenerator: OutlineGenerator | undefined;
let outlineReviewer: OutlineReviewer | undefined;
let openAiJsonClient: OpenAiJsonClient | undefined;
let webSearch: WebSearchPort | undefined;
let imageGenerator: ImageGenerator | undefined;
let database: ReturnType<typeof openDatabase> | undefined;

function getDatabase() {
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

export function getContentGenerator(): ContentGenerator {
  if (!contentGenerator) {
    const client = getOpenAiJsonClient();
    contentGenerator = client ? new OpenAiContentGenerator(client) : new DemoContentGenerator();
  }
  return contentGenerator;
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
      ? new OpenAiVisualPlanner(config.llm)
      : new DemoVisualPlanner();
  }
  return visualPlanner;
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
  const config = getServerConfig().image;
  if (!config) return null;
  imageGenerator ??= new OpenAiImageGenerator(config);
  return imageGenerator;
}
