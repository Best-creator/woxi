"use client";

import { Check, Clipboard, FileDown, MousePointer2, Send, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ContentBlock } from "@/features/articles/domain";
import {
  blocksToPlainText,
  renderWechatHtml
} from "@/features/publishing/render-wechat-html";
import { WECHAT_THEMES, type ThemeId } from "@/features/publishing/themes";

export type RichCopy = (html: string, plainText: string) => Promise<void>;

export async function copyRichText(html: string, plainText: string) {
  const item = new ClipboardItem({
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([plainText], { type: "text/plain" })
  });
  await navigator.clipboard.write([item]);
}

export type PublishWechatDraft = (
  themeId: ThemeId,
  force: boolean
) => Promise<{ mediaId: string }>;

export type ExportPdf = (html: string) => void;

/**
 * 导出 PDF 的打印文档：文章正文沿用预览那份渲染结果，这里只补打印样式。
 * 公众号正文宽度上限 677px，A4（96dpi 下 794px）去掉页边距仍然放得下，不会横向截断。
 */
const printStyles = `
  @page { size: A4; margin: 12mm; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  img { max-width: 100%; height: auto; }
  img, h1, h2, h3, h4 { break-inside: avoid; }
`;

/**
 * 正文里的配图带 `loading="lazy"`（公众号正文需要），但打印 iframe 停在屏幕外，
 * 懒加载的图永远不会进入视口、也就永远不会去取——必须在这里换成立即加载，
 * 否则导出的 PDF 里图全是空的。
 */
export function buildPrintDocument(html: string) {
  const eagerHtml = html.replaceAll('loading="lazy"', 'loading="eager"');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>公众号文章</title><style>${printStyles}</style></head><body>${eagerHtml}</body></html>`;
}

/** 等打印文档里的图真正就绪，抽出来是为了能单独测（jsdom 里没有真实加载）。 */
export async function waitForPrintableImages(frameWindow: Window, timeoutMs = 8000) {
  const images = Array.from(frameWindow.document.images);
  if (images.length === 0) return;
  const loaded = Promise.all(
    images.map((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          })
    )
  );
  // 上游图床抽风时不能让打印一直卡着，到点就照常出 PDF（缺图好过点不动）。
  await Promise.race([
    loaded,
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))
  ]);
  // 再等一次解码，避免图取回来了但还没画进位图，打印时仍是空白。
  await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
}

/**
 * 默认实现：把同一份渲染结果放进一个离屏 iframe 再触发浏览器打印，
 * 用户在系统对话框里选「另存为 PDF」即可落盘。
 *
 * 这么做的好处是打印范围只有文章本身（不会带上工作台界面），中文与配图都由浏览器
 * 原样输出，也不需要引入服务端 PDF 渲染依赖。
 */
export function exportPreviewAsPdf(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  // 放在屏幕外而不是 1×1 透明块：打印时会按 iframe 自身尺寸排版，缩成 1px 会输出空白页。
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;";
  frame.srcdoc = buildPrintDocument(html);

  const remove = () => frame.remove();
  frame.onload = () => {
    const frameWindow = frame.contentWindow;
    if (!frameWindow) {
      remove();
      return;
    }
    frameWindow.addEventListener("afterprint", () => window.setTimeout(remove, 0), { once: true });
    // 兜底：用户长时间不关打印对话框时也不留下悬挂节点。
    window.setTimeout(remove, 600_000);
    void waitForPrintableImages(frameWindow).then(() => {
      frameWindow.focus();
      frameWindow.print();
    });
  };

  document.body.append(frame);
}

export function WechatPreview({
  blocks,
  copy = copyRichText,
  publishDraft,
  exportPdf = exportPreviewAsPdf,
  onClose
}: {
  blocks: ContentBlock[];
  copy?: RichCopy;
  /** 服务端配置了公众号凭据时提供；未提供则隐藏推送入口（只能复制粘贴）。 */
  publishDraft?: PublishWechatDraft;
  /** 导出 PDF 的打印入口；jsdom 里没有打印能力，测试可注入替身。 */
  exportPdf?: ExportPdf;
  onClose?: () => void;
}) {
  const [themeId, setThemeId] = useState<ThemeId>("ink");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "fallback">(
    "idle"
  );
  const [pushState, setPushState] = useState<"idle" | "pushing" | "pushed" | "error">("idle");
  const [pushMessage, setPushMessage] = useState("");
  const [forcePush, setForcePush] = useState(false);
  const [pdfMessage, setPdfMessage] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => renderWechatHtml(blocks, themeId), [blocks, themeId]);
  const plainText = useMemo(() => blocksToPlainText(blocks), [blocks]);

  async function handleCopy() {
    try {
      await copy(html, plainText);
      setCopyState("copied");
    } catch {
      setCopyState("fallback");
    }
  }

  async function handlePublish() {
    if (!publishDraft) return;
    setPushState("pushing");
    setPushMessage("");
    try {
      await publishDraft(themeId, forcePush);
      setPushState("pushed");
      setPushMessage("已推送到公众号草稿箱。到公众平台「草稿箱」确认排版后手动发布即可。");
    } catch (pushError) {
      setPushState("error");
      setPushMessage(pushError instanceof Error ? pushError.message : "推送失败，请稍后重试");
    }
  }

  function handleExportPdf() {
    setPdfMessage("");
    try {
      exportPdf(html);
      setPdfMessage("已打开打印对话框：把「目标打印机」选成「另存为 PDF」再保存即可。");
    } catch (pdfError) {
      setPdfMessage(pdfError instanceof Error ? pdfError.message : "导出 PDF 失败，请稍后重试");
    }
  }

  function selectPreview() {
    const body = iframeRef.current?.contentDocument?.body;
    const selection = iframeRef.current?.contentWindow?.getSelection();
    if (!body || !selection) return;
    const range = body.ownerDocument.createRange();
    range.selectNodeContents(body);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  return (
    <section className="preview-panel" aria-labelledby="preview-title">
      <header className="preview-toolbar">
        <div>
          <p className="eyebrow">发布检查</p>
          <h2 id="preview-title">公众号预览</h2>
        </div>
        <div className="preview-actions">
          <div className="theme-control" aria-label="排版主题">
            {(Object.keys(WECHAT_THEMES) as ThemeId[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={themeId === id}
                className={themeId === id ? "theme-button active" : "theme-button"}
                onClick={() => setThemeId(id)}
              >
                {WECHAT_THEMES[id].name}
              </button>
            ))}
          </div>
          <button className="button button-primary" type="button" onClick={handleCopy}>
            {copyState === "copied" ? <Check size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}
            复制到公众号
          </button>
          <button className="button button-secondary" type="button" onClick={handleExportPdf}>
            <FileDown size={16} aria-hidden="true" />
            导出 PDF
          </button>
          {publishDraft ? (
            <button
              className="button button-primary"
              type="button"
              disabled={pushState === "pushing"}
              onClick={() => void handlePublish()}
            >
              <Send size={16} aria-hidden="true" />
              {pushState === "pushing" ? "推送中..." : pushState === "pushed" ? "再次推送" : "推送到草稿箱"}
            </button>
          ) : null}
          {onClose ? (
            <button className="icon-button" type="button" onClick={onClose} aria-label="关闭预览" title="关闭预览">
              <X size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="preview-status" aria-live="polite">
        {copyState === "copied" ? "已复制富文本" : null}
        {copyState === "fallback" ? (
          <>
            <span>浏览器未允许富文本复制，请在下方预览中手动选择。</span>
            <button className="button button-secondary" type="button" onClick={selectPreview}>
              <MousePointer2 size={16} aria-hidden="true" />
              选择预览内容
            </button>
          </>
        ) : null}
        {pushState === "pushed" ? <span className="push-ok">{pushMessage}</span> : null}
        {pdfMessage ? <span className="pdf-hint">{pdfMessage}</span> : null}
        {pushState === "error" ? (
          <>
            <span className="push-error">{pushMessage}</span>
            <label className="push-force-toggle">
              <input
                type="checkbox"
                checked={forcePush}
                onChange={(event) => setForcePush(event.target.checked)}
              />
              强制重新推送（忽略相同内容检查）
            </label>
          </>
        ) : null}
      </div>

      <div className="phone-preview">
        <iframe
          ref={iframeRef}
          title="公众号文章预览"
          sandbox="allow-same-origin"
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">${html}</body></html>`}
        />
      </div>
    </section>
  );
}

