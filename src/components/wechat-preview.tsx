"use client";

import { Check, Clipboard, MousePointer2, X } from "lucide-react";
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

export function WechatPreview({
  blocks,
  copy = copyRichText,
  onClose
}: {
  blocks: ContentBlock[];
  copy?: RichCopy;
  onClose?: () => void;
}) {
  const [themeId, setThemeId] = useState<ThemeId>("ink");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "fallback">(
    "idle"
  );
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

