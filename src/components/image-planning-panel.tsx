"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Layers,
  MapPin,
  Maximize2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Article, ContentBlock } from "@/features/articles/domain";
import type { ReferenceCharacter } from "@/features/characters/domain";
import type {
  ImageAsset,
  ImageAspectRatio,
  ImageGeneration,
  ImageLibraryItem
} from "@/features/images/domain";
import type { ImageAssetPatch } from "@/features/images/repository";
import { ModelSelect } from "./model-select";

/** 批量生成的逐张结果摘要：ok=false 的张数就是「继续生成」要补的量。 */
export interface ImageBatchSummary {
  results: Array<{ assetId: string; ok: boolean; message?: string }>;
  succeeded: number;
  failed: number;
}

export interface ImageMutationPayload {
  article: Article;
  assets: ImageAsset[];
  /**
   * 长图类接口的附加回执（其他配图接口不返回）。
   * 旧漫画长图（comic-strip）返回排法与理由；分段拼接（segment-strips）返回
   * 每段的 segmentId/title/route 与帧数。两类条目形状不同，字段全部可选共用一条类型。
   */
  strips?: Array<{
    assetId: string;
    width: number;
    height: number;
    panels?: number;
    mode?: string;
    reason?: string;
    segmentId?: string;
    title?: string;
    route?: string;
    frames?: number;
  }>;
  /** 分段拼接接口的附加回执：本次拼接实际使用的字体族（映射回选项名回显）。 */
  fontFamily?: string;
  /** 批量生成接口的附加回执（单张生成不返回）。 */
  batch?: ImageBatchSummary;
}

/** 规划引导参数：绘制风格与参考形象均为可选项。 */
export interface ImagePlanGuideOptions {
  style?: string;
  characterId?: string;
}

export interface ImagePlanningPanelProps {
  article: Article;
  assets: ImageAsset[];
  readOnly?: boolean;
  locked?: boolean;
  onResult: (article: Article, assets: ImageAsset[]) => void;
  planImages?: (expectedUpdatedAt: string, model?: string, options?: ImagePlanGuideOptions) => Promise<ImageMutationPayload>;
  updateAsset?: (
    assetId: string,
    input: ImageAssetPatch & { expectedUpdatedAt: string }
  ) => Promise<ImageMutationPayload>;
  deleteAsset?: (assetId: string, expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
  refreshPlaceholder?: (
    assetId: string,
    expectedUpdatedAt: string
  ) => Promise<ImageMutationPayload>;
  /** 真实图片生成服务；未提供（未配置）时不显示生成入口。model 为 UI 选中的生图模型（可跨站点）。 */
  generateImage?: (
    assetId: string,
    expectedUpdatedAt: string,
    model?: string
  ) => Promise<ImageMutationPayload>;
  /**
   * 批量并行生成：服务端一次请求内并行跑上游、串行推进乐观锁。
   * 未提供时「一键生成全部」入口不显示。
   */
  generateBatch?: (input: { expectedUpdatedAt: string; model?: string }) => Promise<ImageMutationPayload>;
  /** 在多个生成版本之间切换；也接受本文其他配图的版本（等于把它挪到这张上）。 */
  selectGeneration?: (
    assetId: string,
    generationId: string,
    expectedUpdatedAt: string
  ) => Promise<ImageMutationPayload>;
  /** 删除某一版生成结果（连同磁盘文件）。 */
  deleteGeneration?: (generationId: string, expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
  /** 配图规划的模型选择：默认走服务端 LLM_VISUAL_MODEL（快模型），可手动切换。 */
  llmEnabled?: boolean;
  availableModels?: string[];
}

const typeLabels: Record<ImageAsset["type"], string> = {
  cover: "封面图",
  storyboard: "动漫分镜",
  concept: "概念图",
  process: "流程图",
  comparison: "对比图",
  knowledge_card: "知识卡片",
  comic_strip: "漫画长图"
};

const statusLabels: Record<ImageAsset["status"], string> = {
  planned: "已规划",
  placeholder: "待生成",
  generating: "生成中",
  generated: "已生成",
  disabled: "已停用",
  failed: "生成失败"
};

const aspectRatios: Array<{ value: ImageAspectRatio; label: string }> = [
  { value: "cover", label: "封面 2.35:1" },
  { value: "landscape", label: "横图 3:2" },
  { value: "square", label: "方图 1:1" },
  { value: "portrait", label: "竖图 3:4" }
];

const STYLE_NONE = "__none__";
const STYLE_CUSTOM = "__custom__";
const CHARACTER_NONE = "__none__";
const CHARACTER_UPLOAD = "__upload__";

const stylePresets: Array<{ value: string; label: string }> = [
  { value: "简笔画", label: "简笔画（线条涂鸦）" },
  { value: "扁平插画", label: "扁平插画" },
  { value: "手绘水彩", label: "手绘水彩" },
  { value: "卡通贴纸", label: "卡通贴纸" },
  { value: "黑板板书", label: "黑板板书" },
  { value: "像素风", label: "像素风" },
  { value: "3D 可爱风", label: "3D 可爱风" }
];

/** 风格库条目（style-lab 提炼后导入）；value 用 library:<id> 标记，由服务端解析成完整风格文本。 */
interface StyleLibrarySummary {
  id: string;
  name: string;
  summary: string;
  palette: string[];
  source: string;
  updatedAt: string;
}

function libraryStyleValue(id: string) {
  return `library:${id}`;
}

interface ImageDraft {
  prompt: string;
  altText: string;
  assetUpdatedAt: string;
}

function draftFor(asset: ImageAsset, drafts: Record<string, ImageDraft>) {
  const draft = drafts[asset.id];
  return draft?.assetUpdatedAt === asset.updatedAt
    ? draft
    : { prompt: asset.prompt, altText: asset.altText, assetUpdatedAt: asset.updatedAt };
}

function sourceFor(asset: ImageAsset) {
  if (asset.status === "generated") {
    // 生成成功：优先远程图；本地落盘图走 content 路由。URL 追加 updatedAt 破缓存，
    // 否则重新生成后 src 不变，浏览器继续显示旧图（占位/上一版），看起来像"没反应"。
    return (
      asset.publicUrl ??
      `/api/image-assets/${asset.id}/content?v=${encodeURIComponent(asset.updatedAt)}`
    );
  }
  return asset.publicUrl ?? asset.placeholderUrl ?? `/api/image-assets/${asset.id}/content`;
}

/** 拉一次素材库；失败返回 null，调用方静默降级（版本条显示为空，不影响生成本身）。 */
async function fetchGenerations(articleId: string): Promise<ImageLibraryItem[] | null> {
  try {
    const response = await fetch(`/api/articles/${articleId}/image-generations`);
    if (!response.ok) return null;
    const data = (await response.json()) as { generations?: ImageLibraryItem[] };
    return Array.isArray(data.generations) ? data.generations : [];
  } catch {
    return null;
  }
}

function truncate(value: string) {
  return value.length > 36 ? `${value.slice(0, 36)}...` : value;
}

/** 预览框按配图比例留位，避免加载完成后页面跳动。 */
const aspectRatioCss: Record<ImageAspectRatio, string> = {
  cover: "2.35 / 1",
  landscape: "3 / 2",
  square: "1 / 1",
  portrait: "3 / 4"
};

/**
 * 某一版生成结果的取图地址。
 * 生成文件按 `{assetId}-{generationId}` 命名，每个版本一个不可变 URL，
 * 因此不需要像资产那样追 `?v=` 破缓存。
 */
function generationSrc(generation: ImageGeneration) {
  return generation.publicUrl ?? `/api/image-generations/${generation.id}/content`;
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 版本条按时间正序排列，编号随时间递增：最早生成的是第 1 版，最新的是第 N 版。
 * 参数必须是已按正序排好的数组（generationsByAsset 保证），不能用仓储返回的倒序列表。
 */
function versionLabel(generations: ImageGeneration[], generationId: string) {
  const index = generations.findIndex((generation) => generation.id === generationId);
  return index === -1 ? 0 : index + 1;
}

function readableError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function ImagePlanningPanel({
  article,
  assets: allAssets,
  readOnly = false,
  locked = false,
  onResult,
  planImages,
  updateAsset,
  deleteAsset,
  refreshPlaceholder,
  generateImage,
  generateBatch,
  selectGeneration,
  deleteGeneration,
  llmEnabled = false,
  availableModels = []
}: ImagePlanningPanelProps) {
  // 漫画长图不是「一张待规划的配图」：它由「合成漫画长图」入口独立管理，
  // 混进这里会多出一张没法生成、也没法重新规划的卡片，还会打乱分镜的序号。
  const assets = allAssets.filter((asset) => asset.type !== "comic_strip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ImageDraft>>({});
  const [planModel, setPlanModel] = useState("");
  // 生图模型：从 /api/image-models 拉聚合目录（可跨站点），空值 = 服务端默认模型。
  const [imageModels, setImageModels] = useState<Array<{ id: string; provider: string }>>([]);
  const [imageModel, setImageModel] = useState("");
  // 一键生成的批量进度：本次要生成的张数（生成中显示在按钮文案里）。
  const [batchTotal, setBatchTotal] = useState<number | null>(null);
  // 文章素材库：本文全部生成版本。版本条与「换一张」都读这一份，避免两处顺序不一致。
  const [generations, setGenerations] = useState<ImageLibraryItem[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  // 大图预览的目标：看哪一张配图的哪一版，以及在「换一张」时要移到哪个位置。
  const [preview, setPreview] = useState<{ assetId: string; generationId: string; targetAssetId: string } | null>(null);
  // 素材库按 assetId 分组，省得每次渲染都过滤一遍。
  // 仓储给的是最新在前（素材库就按这个顺序浏览），版本条反过来按时间正序排：
  // 这样「第 1 版」永远在最左边，大图预览左右翻页的方向和肉眼看到的顺序一致。
  const generationsByAsset = new Map<string, ImageLibraryItem[]>();
  for (const generation of generations) {
    const bucket = generationsByAsset.get(generation.assetId) ?? [];
    bucket.unshift(generation);
    generationsByAsset.set(generation.assetId, bucket);
  }
  const anchors = article.blocks.filter((block) => block.type !== "image");
  // 初始阶段（还没有任何生成成功的图）显示「一键生成全部」；进入调整阶段后靠单张按钮针对性重生成。
  const hasGenerated = assets.some((asset) => asset.status === "generated");
  const pendingCount = assets.filter(
    (asset) => asset.status !== "disabled" && asset.status !== "generated" && asset.status !== "generating"
  ).length;

  // 绘制风格：预设下拉 + 风格库条目 + 自定义文本，最终以字符串参与规划。
  // 风格库条目以 library:<id> 标记参与持久化与规划，服务端解析成完整风格文本。
  const [styleOption, setStyleOption] = useState(STYLE_NONE);
  const [styleInput, setStyleInput] = useState("");
  const effectiveStyle =
    styleOption === STYLE_CUSTOM ? styleInput.trim() : styleOption === STYLE_NONE ? "" : styleOption;

  // 风格库：全局共享（style-lab 导入），选择后随规划请求提交。
  const [libraryStyles, setLibraryStyles] = useState<StyleLibrarySummary[]>([]);

  // 参考形象库：全局共享，选择后随规划请求提交。
  const [characters, setCharacters] = useState<ReferenceCharacter[]>([]);
  const [characterId, setCharacterId] = useState("");
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadPersona, setUploadPersona] = useState("");
  const [uploading, setUploading] = useState(false);
  const [characterError, setCharacterError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsLoadedRef = useRef(false);
  const selectedCharacter = characters.find((item) => item.id === characterId) ?? null;

  // 形象库与本文配图偏好：挂载时各拉一次，失败静默降级（不影响手动上传/规划）。
  useEffect(() => {
    let cancelled = false;
    settingsLoadedRef.current = false;
    fetch("/api/characters")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { characters?: ReferenceCharacter[] }) => {
        if (!cancelled) setCharacters(Array.isArray(data.characters) ? data.characters : []);
      })
      .catch(() => undefined);
    fetch("/api/style-library")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { styles?: StyleLibrarySummary[] }) => {
        if (!cancelled) setLibraryStyles(Array.isArray(data.styles) ? data.styles : []);
      })
      .catch(() => undefined);
    fetch("/api/image-models")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { models?: Array<{ id: string; provider: string }> }) => {
        if (!cancelled) setImageModels(Array.isArray(data.models) ? data.models : []);
      })
      .catch(() => undefined);
    fetch(`/api/articles/${article.id}/image-settings`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { style?: unknown; characterId?: unknown }) => {
        if (cancelled) return;
        const style = typeof data.style === "string" ? data.style : "";
        if (style.startsWith("library:")) {
          // 风格库标记直接回显；条目被删时下拉回落显示「不指定风格」，重新规划会得到明确报错。
          setStyleOption(style);
        } else if (stylePresets.some((preset) => preset.value === style)) {
          setStyleOption(style);
        } else if (style) {
          setStyleOption(STYLE_CUSTOM);
          setStyleInput(style);
        }
        if (typeof data.characterId === "string") setCharacterId(data.characterId);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) settingsLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [article.id]);

  // 偏好变化即时持久化，下次进入配图步骤自动回显。
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    const controller = new AbortController();
    fetch(`/api/articles/${article.id}/image-settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ style: effectiveStyle, characterId: characterId || null }),
      signal: controller.signal
    }).catch(() => undefined);
    return () => controller.abort();
  }, [article.id, characterId, effectiveStyle]);

  // 选中形象的编辑草稿由 CharacterEditor 组件自持（key 重挂载即重置）。

  /** 生成版本列表：挂载时拉一次，之后每次生成/选用/删除成功都刷新。 */
  useEffect(() => {
    let cancelled = false;
    fetchGenerations(article.id).then((items) => {
      if (!cancelled && items) setGenerations(items);
    });
    return () => {
      cancelled = true;
    };
  }, [article.id]);

  async function refreshGenerations() {
    const items = await fetchGenerations(article.id);
    if (items) setGenerations(items);
  }

  // 大图预览的键盘操作：左右翻版、Esc 关闭。挂在 window 上，弹窗打开时无需先聚焦。
  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreview(null);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const versions = generationsByAsset.get(preview.assetId) ?? [];
      const index = versions.findIndex((item) => item.id === preview.generationId);
      if (index === -1) return;
      // 版本条是时间正序，所以「左」＝更早的一版、「右」＝更新的一版，和看到的顺序一致。
      const next = event.key === "ArrowLeft" ? index - 1 : index + 1;
      const target = versions[(next + versions.length) % versions.length];
      if (target) setPreview((current) => (current ? { ...current, generationId: target.id } : current));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // generationsByAsset 每次都重建，不作为依赖；preview 变化已足够重挂监听。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  function updateDraft(asset: ImageAsset, field: "prompt" | "altText", value: string) {
    setDrafts((current) => ({
      ...current,
      [asset.id]: { ...draftFor(asset, current), [field]: value }
    }));
  }

  async function run(operation: () => Promise<ImageMutationPayload>) {
    if (locked) return;
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      onResult(result.article, result.assets);
      // 生成会新增一版、选用/删除会改版本状态，两种情况下版本条都要重拉。
      await refreshGenerations();
    } catch (requestError) {
      setError(readableError(requestError, "配图操作失败，请稍后重试"));
    } finally {
      setBusy(false);
    }
  }

  /**
   * 一键生成（也用于失败后补生成）：一次批量请求交给服务端并行跑，
   * 乐观锁由服务端串行推进（前端并行打单张接口必然 409，这正是旧串行循环的原因）。
   * 只生成「未生成」的资产——已成功的不动，失败/待生成的可反复点按钮续生成。
   */
  async function generateAllImages() {
    if (!generateBatch || locked) return;
    const pending = assets.filter(
      (asset) => asset.status !== "disabled" && asset.status !== "generated" && asset.status !== "generating"
    );
    if (pending.length === 0) return;
    setBusy(true);
    setError("");
    setBatchTotal(pending.length);
    try {
      const payload = await generateBatch({
        expectedUpdatedAt: article.updatedAt,
        ...(imageModel ? { model: imageModel } : {})
      });
      onResult(payload.article, payload.assets);
      await refreshGenerations();
      if (payload.batch?.failed) {
        setError(
          `已生成 ${payload.batch.succeeded} 张，${payload.batch.failed} 张失败——再点一次按钮可只补失败与未完成的。`
        );
      }
    } catch (requestError) {
      setError(readableError(requestError, "批量生成失败，请稍后重试"));
    } finally {
      setBusy(false);
      setBatchTotal(null);
    }
  }

  function patchAsset(assetId: string, patch: ImageAssetPatch) {
    if (locked || !updateAsset) return;
    void run(() => updateAsset(assetId, { ...patch, expectedUpdatedAt: article.updatedAt }));
  }

  function openPreview(assetId: string, generationId: string) {
    setPreview({ assetId, generationId, targetAssetId: assetId });
  }

  /** 预览里的当前版本；列表被刷新掉（例如那一版刚被删）就自动收敛为 null。 */
  const previewGenerations = preview ? generationsByAsset.get(preview.assetId) ?? [] : [];
  const previewGeneration =
    previewGenerations.find((generation) => generation.id === preview?.generationId) ?? null;
  const previewAsset = preview ? assets.find((asset) => asset.id === preview.assetId) ?? null : null;

  function stepPreview(direction: -1 | 1) {
    if (!preview || previewGenerations.length === 0) return;
    const index = previewGenerations.findIndex((item) => item.id === preview.generationId);
    const next = (index + direction + previewGenerations.length) % previewGenerations.length;
    const target = previewGenerations[next];
    if (target) setPreview({ ...preview, generationId: target.id });
  }

  /**
   * 选用预览中这一版。
   * 目标位置可以在弹窗里改（默认是它自己所属的那张配图）：选别的位置＝把这一版挪过去，
   * 这样就能把某张生成得好的图用到别的段落上。
   */
  async function applyPreviewedGeneration() {
    if (!preview || !selectGeneration || locked) return;
    setBusy(true);
    setError("");
    try {
      const result = await selectGeneration(
        preview.targetAssetId,
        preview.generationId,
        article.updatedAt
      );
      onResult(result.article, result.assets);
      await refreshGenerations();
      setPreview(null);
    } catch (requestError) {
      setError(readableError(requestError, "切换生成版本失败，请稍后重试"));
    } finally {
      setBusy(false);
    }
  }

  async function deletePreviewedGeneration() {
    if (!preview || !deleteGeneration || locked) return;
    if (!window.confirm("删除这一版生成结果？文件会一并删除，无法恢复。")) return;
    setBusy(true);
    setError("");
    try {
      const result = await deleteGeneration(preview.generationId, article.updatedAt);
      onResult(result.article, result.assets);
      await refreshGenerations();
      setPreview(null);
    } catch (requestError) {
      setError(readableError(requestError, "删除生成版本失败，请稍后重试"));
    } finally {
      setBusy(false);
    }
  }

  function planGuideOptions(): ImagePlanGuideOptions {
    return {
      ...(effectiveStyle ? { style: effectiveStyle } : {}),
      ...(characterId ? { characterId } : {})
    };
  }

  function analyzePlan() {
    if (!planImages) return;
    const options = planGuideOptions();
    const model = planModel || undefined;
    void run(() =>
      options.style || options.characterId
        ? planImages(article.updatedAt, model, options)
        : planImages(article.updatedAt, model)
    );
  }

  function reanalyzePlan() {
    if (!planImages) return;
    const confirmed = window.confirm(
      "重新分析会替换当前配图计划（包括已编辑的提示词），确定继续？"
    );
    if (confirmed) analyzePlan();
  }

  async function handleUploadCharacter() {
    if (!uploadFile || !uploadName.trim()) {
      setCharacterError("请选择参考图并填写形象名称");
      return;
    }
    setUploading(true);
    setCharacterError("");
    try {
      const form = new FormData();
      form.set("file", uploadFile);
      form.set("name", uploadName.trim());
      form.set("persona", uploadPersona.trim());
      const response = await fetch("/api/characters", { method: "POST", body: form });
      const data = (await response.json()) as { character?: ReferenceCharacter; error?: string };
      if (!response.ok || !data.character) {
        throw new Error(data.error ?? "参考图上传失败，请稍后重试");
      }
      const created = data.character;
      setCharacters((current) => [...current, created]);
      setCharacterId(created.id);
      setShowUploadForm(false);
      setUploadFile(null);
      setUploadName("");
      setUploadPersona("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (uploadError) {
      setCharacterError(readableError(uploadError, "参考图上传失败，请稍后重试"));
    } finally {
      setUploading(false);
    }
  }

  function characterSelectValue() {
    if (showUploadForm) return CHARACTER_UPLOAD;
    return characterId && characters.some((item) => item.id === characterId)
      ? characterId
      : CHARACTER_NONE;
  }

  // 回显的风格库标记可能已失效（条目被删）→ 下拉回落显示「不指定风格」。
  const styleSelectValue =
    styleOption.startsWith("library:") &&
    !libraryStyles.some((item) => libraryStyleValue(item.id) === styleOption)
      ? STYLE_NONE
      : styleOption;
  const selectedLibraryStyle = libraryStyles.find(
    (item) => libraryStyleValue(item.id) === styleOption
  );

  function onCharacterSelectChange(value: string) {
    setCharacterError("");
    if (value === CHARACTER_UPLOAD) {
      setShowUploadForm(true);
      return;
    }
    setShowUploadForm(false);
    setCharacterId(value === CHARACTER_NONE ? "" : value);
  }

  const guide = (
    <div className="plan-guide">
      <div className="plan-guide-row">
        <label className="plan-guide-field">
          <span>绘制风格（可选）</span>
          <select
            aria-label="绘制风格"
            value={styleSelectValue}
            disabled={locked || busy}
            onChange={(event) => setStyleOption(event.target.value)}
          >
            <option value={STYLE_NONE}>不指定风格</option>
            {stylePresets.map((preset) => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
            {libraryStyles.length > 0 ? (
              <optgroup label="风格库（提炼导入）">
                {libraryStyles.map((style) => (
                  <option key={style.id} value={libraryStyleValue(style.id)}>
                    {style.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <option value={STYLE_CUSTOM}>自定义…</option>
          </select>
        </label>
        {selectedLibraryStyle ? (
          <p className="plan-style-hint">
            {selectedLibraryStyle.summary}
            {selectedLibraryStyle.palette.slice(0, 6).map((hex) => (
              <span
                key={hex}
                className="plan-style-swatch"
                style={{ background: hex }}
                title={hex}
              />
            ))}
          </p>
        ) : null}
        {styleOption === STYLE_CUSTOM ? (
          <label className="plan-guide-field">
            <span>自定义风格描述</span>
            <input
              aria-label="自定义风格描述"
              value={styleInput}
              placeholder="例如：蜡笔手绘风，暖色调"
              disabled={locked || busy}
              onChange={(event) => setStyleInput(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      <div className="plan-guide-row">
        <label className="plan-guide-field">
          <span>参考形象（可选）</span>
          <select
            aria-label="参考形象"
            value={characterSelectValue()}
            disabled={locked || busy}
            onChange={(event) => onCharacterSelectChange(event.target.value)}
          >
            <option value={CHARACTER_NONE}>不使用参考形象</option>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>{character.name}</option>
            ))}
            <option value={CHARACTER_UPLOAD}>上传新形象…</option>
          </select>
        </label>
      </div>

      {showUploadForm ? (
        <div className="plan-upload-form">
          <label className="plan-guide-field">
            <span>参考图（PNG / JPG / WebP / GIF，≤5MB）</span>
            <input
              aria-label="参考图文件"
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={locked || uploading}
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <div className="plan-guide-row">
            <label className="plan-guide-field">
              <span>形象名称</span>
              <input
                aria-label="形象名称"
                value={uploadName}
                placeholder="例如：蘑菇老师"
                maxLength={40}
                disabled={locked || uploading}
                onChange={(event) => setUploadName(event.target.value)}
              />
            </label>
            <label className="plan-guide-field">
              <span>身份设定（可选）</span>
              <input
                aria-label="身份设定"
                value={uploadPersona}
                placeholder="例如：自媒体科普老师"
                maxLength={200}
                disabled={locked || uploading}
                onChange={(event) => setUploadPersona(event.target.value)}
              />
            </label>
          </div>
          <div className="plan-upload-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={uploading}
              onClick={() => {
                setShowUploadForm(false);
                setUploadFile(null);
                setUploadName("");
                setUploadPersona("");
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              取消
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={uploading || locked}
              onClick={() => void handleUploadCharacter()}
            >
              <Upload size={15} aria-hidden="true" />
              {uploading ? "上传中..." : "上传并保存到形象库"}
            </button>
          </div>
        </div>
      ) : null}

      {selectedCharacter && !showUploadForm ? (
        <CharacterEditor
          key={selectedCharacter.id}
          character={selectedCharacter}
          locked={locked}
          llmEnabled={llmEnabled}
          availableModels={availableModels}
          onUpdated={(updated) =>
            setCharacters((current) => current.map((item) => (item.id === updated.id ? updated : item)))
          }
          onDeleted={(id) => {
            setCharacters((current) => current.filter((item) => item.id !== id));
            setCharacterId("");
          }}
          onError={setCharacterError}
        />
      ) : null}

      {characterError ? <p className="image-plan-error" role="alert">{characterError}</p> : null}

      <div className="plan-guide-actions">
        <ModelSelect
          enabled={llmEnabled}
          availableModels={availableModels}
          value={planModel}
          id="image-plan-model"
          label="规划模型"
          disabled={locked || busy}
          includeDefaultOption
          defaultOptionLabel="默认（gemini-3.8-flash）"
          onChange={setPlanModel}
        />
        {generateImage && imageModels.length > 0 ? (
          (() => {
            const multiProvider = new Set(imageModels.map((item) => item.provider)).size > 1;
            return (
              <label className="plan-guide-field">
                <span>生图模型</span>
                <select
                  aria-label="生图模型"
                  value={imageModel}
                  disabled={locked || busy}
                  onChange={(event) => setImageModel(event.target.value)}
                  title="生成配图使用的模型；可跨站点选择，报错时可换模型重试"
                >
                  <option value="">默认模型</option>
                  {imageModels.map((item) => (
                    <option key={item.id} value={item.id}>
                      {multiProvider ? `${item.id}（${item.provider}）` : item.id}
                    </option>
                  ))}
                </select>
              </label>
            );
          })()
        ) : null}
        <button
          className="button button-primary generation-button"
          type="button"
          disabled={locked || busy || !planImages}
          onClick={assets.length ? reanalyzePlan : analyzePlan}
        >
          <ImagePlus size={16} aria-hidden="true" />
          {busy ? "正在分析..." : assets.length ? "按当前风格与形象重新设计分镜" : "根据正文设计动漫分镜"}
        </button>
        {generateBatch && (batchTotal !== null || pendingCount > 0) ? (
          <button className="button button-secondary" type="button" disabled={locked || busy} onClick={() => void generateAllImages()}>
            <Wand2 size={16} aria-hidden="true" />
            {batchTotal !== null
              ? `正在并行生成 ${batchTotal} 张配图...`
              : hasGenerated
                ? `继续生成未完成的配图（${pendingCount} 张）`
                : `一键生成全部配图（${pendingCount} 张）`}
          </button>
        ) : null}
      </div>
    </div>
  );

  if (!assets.length) {
    if (!anchors.length) return null;
    return (
      <div className="image-planning-panel">
        {locked ? (
          <p className="image-plan-lock-notice" role="status">
            正在保存文章，保存完成后可操作配图
          </p>
        ) : null}
        {error ? <p className="image-plan-error" role="alert">{error}</p> : null}
        {!readOnly ? guide : null}
      </div>
    );
  }

  return (
    <>
    <section className="image-planning-panel" aria-label="配图工作区">
      {locked ? (
        <p className="image-plan-lock-notice" role="status">
          正在保存文章，保存完成后可操作配图
        </p>
      ) : null}
      {error ? <p className="image-plan-error" role="alert">{error}</p> : null}
      {!readOnly ? guide : null}
      <ol className="image-plan-list">
        {assets.map((asset, index) => {
          const draft = draftFor(asset, drafts);
          const anchor = anchors.find((block) => block.id === asset.anchorBlockId);
          const versions = generationsByAsset.get(asset.id) ?? [];
          const activeVersion = versions.find((generation) => generation.selected) ?? null;
          return (
            <li className="image-plan-item" key={asset.id}>
              <button
                type="button"
                className="image-plan-preview"
                style={{ aspectRatio: aspectRatioCss[asset.aspectRatio] }}
                disabled={locked || !activeVersion}
                title={activeVersion ? "点击看大图，可左右切换各版本" : "尚未生成，无法预览"}
                aria-label={`预览配图 ${index + 1}`}
                onClick={() => activeVersion && openPreview(asset.id, activeVersion.id)}
              >
                {/* 占位图走内部 API 路由，动态地址，next/image 不适用。 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="image-plan-thumbnail"
                  src={sourceFor(asset)}
                  alt={asset.altText || "文章配图"}
                  loading="lazy"
                />
                {activeVersion ? (
                  <span className="image-plan-preview-hint">
                    <Maximize2 size={13} aria-hidden="true" />
                    点击放大
                  </span>
                ) : null}
                {versions.length > 1 ? (
                  <span className="image-plan-preview-count">{versions.length} 版</span>
                ) : null}
              </button>
              <div className="image-plan-summary">
                <div className="image-plan-meta">
                  <strong>{typeLabels[asset.type]}</strong>
                  <span className={`image-status image-status-${asset.status}`}>
                    {statusLabels[asset.status]}
                  </span>
                </div>
                {asset.type === "cover" ? null : (
                  <p className="image-plan-anchor">
                    <MapPin size={13} aria-hidden="true" />
                    {anchor ? truncate(anchor.content) : "待重新定位"}
                  </p>
                )}
                <p className="image-plan-purpose">{asset.purpose}</p>
              </div>

              {versions.length ? (
                <div className="image-generation-strip">
                  <p className="image-generation-strip-label">
                    <Layers size={13} aria-hidden="true" />
                    生成版本 {versions.length} 版
                    {activeVersion ? `，正在使用第 ${versionLabel(versions, activeVersion.id)} 版` : ""}
                  </p>
                  <ol>
                    {versions.map((generation) => {
                      const number = versionLabel(versions, generation.id);
                      return (
                        <li key={generation.id}>
                          <button
                            type="button"
                            className={`image-generation-thumb${generation.selected ? " image-generation-thumb-current" : ""}`}
                            title={`第 ${number} 版 · ${formatGeneratedAt(generation.createdAt)}${generation.model ? ` · ${generation.model}` : ""}`}
                            aria-label={`查看配图 ${index + 1} 的第 ${number} 版`}
                            disabled={locked}
                            onClick={() => openPreview(asset.id, generation.id)}
                          >
                            {/* 版本文件按 generationId 命名，URL 不可变，不需要破缓存参数。 */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={generationSrc(generation)} alt="" loading="lazy" />
                            {generation.selected ? (
                              <span className="image-generation-badge">使用中</span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : null}

              {!readOnly ? (
                <div className="image-plan-fields">
                  <label>
                    <span>提示词</span>
                    <textarea
                      aria-label={`配图提示词 ${index + 1}`}
                      value={draft.prompt}
                      rows={3}
                      disabled={locked || busy}
                      onChange={(event) => updateDraft(asset, "prompt", event.target.value)}
                      onBlur={(event) => {
                        const prompt = event.target.value.trim();
                        if (prompt && prompt !== asset.prompt) patchAsset(asset.id, { prompt });
                      }}
                    />
                  </label>
                  <label>
                    <span>替代文本</span>
                    <input
                      aria-label={`配图替代文本 ${index + 1}`}
                      value={draft.altText}
                      disabled={locked || busy}
                      onChange={(event) => updateDraft(asset, "altText", event.target.value)}
                      onBlur={(event) => {
                        const altText = event.target.value.trim();
                        if (altText && altText !== asset.altText) patchAsset(asset.id, { altText });
                      }}
                    />
                  </label>
                  <label>
                    <span>比例</span>
                    <select
                      aria-label={`配图比例 ${index + 1}`}
                      value={asset.aspectRatio}
                      disabled={locked || busy}
                      onChange={(event) =>
                        patchAsset(asset.id, { aspectRatio: event.target.value as ImageAspectRatio })
                      }
                    >
                      {aspectRatios.map((ratio) => (
                        <option key={ratio.value} value={ratio.value}>{ratio.label}</option>
                      ))}
                    </select>
                  </label>
                  {asset.type !== "cover" ? (
                    <label>
                      <span>插入位置</span>
                      <select
                        aria-label={`配图锚点 ${index + 1}`}
                        value={asset.anchorBlockId ?? ""}
                        disabled={locked || busy}
                        onChange={(event) => patchAsset(asset.id, { anchorBlockId: event.target.value })}
                      >
                        {anchors.map((block: ContentBlock) => (
                          <option key={block.id} value={block.id}>{truncate(block.content)}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <div className="image-plan-actions">
                    <label className="image-enabled-toggle">
                      <input
                        aria-label={`启用配图 ${index + 1}`}
                        type="checkbox"
                        checked={asset.status !== "disabled"}
                        disabled={locked || busy}
                        onChange={(event) => patchAsset(asset.id, { enabled: event.target.checked })}
                      />
                      启用
                    </label>
                    {generateImage ? (
                      <button
                        className="icon-button image-generate-button"
                        type="button"
                        title={
                          asset.status === "generated"
                            ? `重新生成配图 ${index + 1}`
                            : `生成配图 ${index + 1}`
                        }
                        aria-label={
                          asset.status === "generated"
                            ? `重新生成配图 ${index + 1}`
                            : `生成配图 ${index + 1}`
                        }
                        disabled={locked || busy || asset.status === "disabled" || asset.status === "generating"}
                        onClick={() =>
                          void run(() =>
                            generateImage(
                              asset.id,
                              article.updatedAt,
                              imageModel || undefined
                            )
                          )
                        }
                      >
                        <Sparkles size={15} aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      className="icon-button"
                      type="button"
                      title={`重建占位图 ${index + 1}`}
                      aria-label={`重建占位图 ${index + 1}`}
                      disabled={locked || busy || asset.status === "disabled" || !refreshPlaceholder}
                      onClick={() => refreshPlaceholder && void run(() => refreshPlaceholder(asset.id, article.updatedAt))}
                    >
                      <RefreshCw size={15} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title={`删除配图 ${index + 1}`}
                      aria-label={`删除配图 ${index + 1}`}
                      disabled={locked || busy || !deleteAsset}
                      onClick={() => deleteAsset && void run(() => deleteAsset(asset.id, article.updatedAt))}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {generations.length ? (
        <div className="image-library">
          <button
            type="button"
            className="image-library-toggle"
            aria-expanded={showLibrary}
            onClick={() => setShowLibrary((current) => !current)}
          >
            <Layers size={14} aria-hidden="true" />
            素材库（本文已生成 {generations.length} 张）
            <ChevronRight
              size={14}
              aria-hidden="true"
              className={`image-library-chevron${showLibrary ? " image-library-chevron-open" : ""}`}
            />
          </button>
          {showLibrary ? (
            <div className="image-library-body">
              <p className="image-library-hint">
                点开任意一张看大图。在弹窗里可以「移到」别的配图上——同一张图只会出现在一个位置，
                所以移走之后原位置会自动回落到它剩下的最新一版。
              </p>
              <ol className="image-library-grid">
                {generations.map((generation) => {
                  const ownerIndex = assets.findIndex((asset) => asset.id === generation.assetId);
                  return (
                    <li key={generation.id}>
                      <button
                        type="button"
                        className={`image-library-thumb${generation.selected ? " image-library-thumb-current" : ""}`}
                        disabled={locked}
                        title={`${typeLabels[generation.assetType]} · ${formatGeneratedAt(generation.createdAt)}`}
                        aria-label={`预览素材库图片：${typeLabels[generation.assetType]}，${formatGeneratedAt(generation.createdAt)}`}
                        onClick={() => openPreview(generation.assetId, generation.id)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={generationSrc(generation)} alt="" loading="lazy" />
                        <span className="image-library-caption">
                          {ownerIndex === -1 ? "已移除" : `配图 ${ownerIndex + 1}`}
                          {generation.selected ? " · 使用中" : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>

    {preview && previewGeneration && previewAsset ? (
      <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="配图大图预览">
        <div className="image-lightbox-panel">
          <header className="image-lightbox-toolbar">
            <div>
              <p className="panel-label">大图预览</p>
              <h2>
                {typeLabels[previewAsset.type]} · 第{" "}
                {versionLabel(previewGenerations, previewGeneration.id)} / {previewGenerations.length} 版
              </h2>
            </div>
            <button className="icon-button" type="button" aria-label="关闭预览" onClick={() => setPreview(null)}>
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="image-lightbox-stage">
            <button
              className="icon-button image-lightbox-step"
              type="button"
              aria-label="上一版"
              disabled={previewGenerations.length < 2 || busy}
              onClick={() => stepPreview(-1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="image-lightbox-image"
              src={generationSrc(previewGeneration)}
              alt={previewAsset.altText || "配图预览"}
            />
            <button
              className="icon-button image-lightbox-step"
              type="button"
              aria-label="下一版"
              disabled={previewGenerations.length < 2 || busy}
              onClick={() => stepPreview(1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="image-lightbox-meta">
            <p className="image-lightbox-facts">
              {formatGeneratedAt(previewGeneration.createdAt)}
              {previewGeneration.model ? ` · ${previewGeneration.model}` : ""}
              {previewGeneration.selected ? " · 正在使用这一版" : ""}
            </p>
            {previewGeneration.prompt ? (
              <p className="image-lightbox-prompt">{previewGeneration.prompt}</p>
            ) : null}
          </div>

          {previewGenerations.length > 1 ? (
            <ol className="image-lightbox-strip">
              {previewGenerations.map((generation) => (
                <li key={generation.id}>
                  <button
                    type="button"
                    className={`image-generation-thumb${generation.id === previewGeneration.id ? " image-generation-thumb-active" : ""}${generation.selected ? " image-generation-thumb-current" : ""}`}
                    aria-label={`切到第 ${versionLabel(previewGenerations, generation.id)} 版`}
                    disabled={busy}
                    onClick={() => setPreview({ ...preview, generationId: generation.id })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={generationSrc(generation)} alt="" loading="lazy" />
                  </button>
                </li>
              ))}
            </ol>
          ) : null}

          {error ? <p className="image-plan-error" role="alert">{error}</p> : null}

          <div className="image-lightbox-actions">
            {selectGeneration ? (
              <label className="plan-guide-field image-lightbox-target">
                <span>用到</span>
                <select
                  aria-label="用到哪张配图"
                  value={preview.targetAssetId}
                  disabled={locked || busy}
                  onChange={(event) => setPreview({ ...preview, targetAssetId: event.target.value })}
                >
                  {assets.map((asset, assetIndex) => (
                    <option key={asset.id} value={asset.id}>
                      配图 {assetIndex + 1}（{typeLabels[asset.type]}）
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {deleteGeneration ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={locked || busy}
                onClick={() => void deletePreviewedGeneration()}
              >
                <Trash2 size={15} aria-hidden="true" />
                删除这一版
              </button>
            ) : null}
            {selectGeneration ? (
              <button
                className="button button-primary"
                type="button"
                disabled={
                  locked ||
                  busy ||
                  (previewGeneration.selected && preview.targetAssetId === preview.assetId)
                }
                onClick={() => void applyPreviewedGeneration()}
              >
                <Check size={15} aria-hidden="true" />
                {preview.targetAssetId === preview.assetId ? "使用这一版" : "移到这张配图"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

interface CharacterEditorProps {
  character: ReferenceCharacter;
  locked: boolean;
  llmEnabled: boolean;
  availableModels: string[];
  onUpdated: (character: ReferenceCharacter) => void;
  onDeleted: (id: string) => void;
  onError: (message: string) => void;
}

/** 单个参考形象的查看/编辑卡：以 key 重挂载方式切换目标形象，编辑草稿随挂载初始化。 */
function CharacterEditor({
  character,
  locked,
  llmEnabled,
  availableModels,
  onUpdated,
  onDeleted,
  onError
}: CharacterEditorProps) {
  const [persona, setPersona] = useState(character.persona);
  const [description, setDescription] = useState(character.description);
  const [describeModel, setDescribeModel] = useState("");
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    onError("");
    try {
      const response = await fetch(`/api/characters/${character.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona: persona.trim(), description: description.trim() })
      });
      const data = (await response.json()) as { character?: ReferenceCharacter; error?: string };
      if (!response.ok || !data.character) {
        throw new Error(data.error ?? "形象保存失败，请稍后重试");
      }
      onUpdated(data.character);
    } catch (saveError) {
      onError(readableError(saveError, "形象保存失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  async function describe() {
    setPending(true);
    onError("");
    try {
      const response = await fetch(`/api/characters/${character.id}/describe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(describeModel ? { model: describeModel } : {})
      });
      const data = (await response.json()) as { character?: ReferenceCharacter; error?: string };
      if (!response.ok || !data.character) {
        throw new Error(data.error ?? "形象提取失败，请稍后重试");
      }
      const updated = data.character;
      onUpdated(updated);
      setDescription(updated.description);
    } catch (describeError) {
      onError(readableError(describeError, "形象提取失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!window.confirm(`删除参考形象「${character.name}」？已生成的配图不受影响。`)) return;
    setPending(true);
    onError("");
    try {
      const response = await fetch(`/api/characters/${character.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "形象删除失败，请稍后重试");
      }
      onDeleted(character.id);
    } catch (deleteError) {
      onError(readableError(deleteError, "形象删除失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="plan-character-card">
      {/* 内部 API 路由图片。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="plan-character-thumb"
        src={character.publicUrl}
        alt={`参考形象 ${character.name}`}
      />
      <div className="plan-character-fields">
        <p className="plan-character-name">{character.name}</p>
        <label className="plan-guide-field">
          <span>身份设定</span>
          <input
            aria-label="编辑身份设定"
            value={persona}
            maxLength={200}
            disabled={locked || pending}
            onChange={(event) => setPersona(event.target.value)}
          />
        </label>
        <label className="plan-guide-field">
          <span>形象描述（用于绘图提示词复现形象）</span>
          <textarea
            aria-label="形象描述"
            value={description}
            rows={3}
            placeholder="上传后可点击「AI 提取形象」自动生成，也可手动修改"
            disabled={locked || pending}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="plan-character-actions">
          <ModelSelect
            enabled={llmEnabled}
            availableModels={availableModels}
            value={describeModel}
            id="character-describe-model"
            label="视觉模型"
            disabled={locked || pending}
            includeDefaultOption
            defaultOptionLabel="默认（服务端配置）"
            onChange={setDescribeModel}
          />
          <button
            className="button button-secondary"
            type="button"
            disabled={locked || pending || !llmEnabled}
            onClick={() => void describe()}
          >
            <Wand2 size={15} aria-hidden="true" />
            {pending ? "处理中..." : "AI 提取形象"}
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={locked || pending}
            onClick={() => void save()}
          >
            保存修改
          </button>
          <button
            className="button button-secondary plan-character-delete"
            type="button"
            disabled={locked || pending}
            onClick={() => void remove()}
          >
            <Trash2 size={15} aria-hidden="true" />
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
