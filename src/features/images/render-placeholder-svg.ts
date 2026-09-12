import type { ImageAspectRatio } from "./domain";

const canvases: Record<ImageAspectRatio, { width: number; height: number }> = {
  cover: { width: 900, height: 383 },
  landscape: { width: 1200, height: 800 },
  square: { width: 1000, height: 1000 },
  portrait: { width: 900, height: 1200 }
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function splitLines(value: string, charactersPerLine: number) {
  const characters = Array.from(value.trim());
  const lines: string[] = [];
  for (let index = 0; index < characters.length && lines.length < 4; index += charactersPerLine) {
    lines.push(characters.slice(index, index + charactersPerLine).join(""));
  }
  return lines.length ? lines : ["图片正在准备中"];
}

export function renderPlaceholderSvg(input: {
  aspectRatio: ImageAspectRatio;
  altText: string;
  purpose: string;
}) {
  const { width, height } = canvases[input.aspectRatio];
  const title = escapeXml(input.altText);
  const charactersPerLine = Math.max(16, Math.floor(width / 28));
  const labelBaseline = Math.round(height * 0.4);
  const descriptionBaseline = labelBaseline + 52;
  const lines = splitLines(`${input.purpose}：${input.altText}`, charactersPerLine)
    .map(escapeXml)
    .map((line, index) => `<tspan x="${width / 2}" dy="${index === 0 ? 0 : 34}">${line}</tspan>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${title}</title>
  <desc id="description">待生成的图片占位图</desc>
  <rect width="${width}" height="${height}" fill="#F4F6F2"/>
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="#D9E1DA" stroke="#2F7D47" stroke-width="3"/>
  <circle cx="${width / 2}" cy="${labelBaseline - 62}" r="24" fill="#2F7D47"/>
  <text x="${width / 2}" y="${labelBaseline}" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#183323">待生成</text>
  <text x="${width / 2}" y="${descriptionBaseline}" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#183323">${lines}</text>
</svg>`;
}
