import { notFound } from "next/navigation";
import {
  getArticleRepository,
  getContentWorkflowRepository,
  getImageAssetRepository,
  getOutlineWorkflowRepository,
  getSourceRepository,
  getWechatDraftPublisher
} from "@/server/services";
import { getServerConfig } from "@/server/config";
import { getPublicLlmConfigWithDiscovery } from "@/server/llm-models";
import { ArticleWorkspace } from "./article-workspace";
import { loadOutlineWorkspaceState } from "./outline-state";
import { loadContentWorkspaceState } from "./content-state";

export const dynamic = "force-dynamic";

export default async function ArticlePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const { step } = await searchParams;
  const article = await getArticleRepository().findById(id);
  if (!article) notFound();
  const sources = await getSourceRepository().list(id);
  const [imageAssets, outlineState, contentState] = await Promise.all([
    getImageAssetRepository().list(id),
    loadOutlineWorkspaceState({
      article,
      sources,
      workflow: getOutlineWorkflowRepository()
    }),
    loadContentWorkspaceState({
      article,
      sources,
      workflow: getContentWorkflowRepository()
    })
  ]);
  return (
    <ArticleWorkspace
      initialArticle={article}
      initialSources={sources}
      initialImageAssets={imageAssets}
      initialVersions={outlineState.versions}
      initialReview={outlineState.review}
      initialVersionReviews={outlineState.versionReviews}
      initialContentVersions={contentState.versions}
      initialContentReview={contentState.review}
      initialContentVersionReviews={contentState.versionReviews}
      initialStep={step ?? null}
      llmConfig={await getPublicLlmConfigWithDiscovery(getServerConfig())}
      imageGenerationEnabled={Boolean(getServerConfig().image)}
      wechatPublishEnabled={Boolean(getWechatDraftPublisher())}
    />
  );
}
