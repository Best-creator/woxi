import { spawn, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const port = 3001;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve(root, "outputs", "task-7-visual-check");
const env = {
  ...process.env,
  CONTENT_DB_PATH: ".data/task7-visual-check.db",
  LLM_API_KEY: "",
  LLM_MODEL: "",
  IMAGE_API_KEY: ""
};

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Visual-check server did not become ready");
}

const server = spawn(
  process.execPath,
  [resolve(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", String(port)],
  { cwd: root, env, stdio: "ignore" }
);

try {
  await waitForServer();
  await mkdir(outputDir, { recursive: true });
  const articleResponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic: "什么是机会成本" })
  });
  const { article } = await articleResponse.json();
  await fetch(`${baseUrl}/api/articles/${article.id}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt: article.updatedAt })
  });
  const generated = await fetch(`${baseUrl}/api/articles/${article.id}`);
  const { article: generatedArticle } = await generated.json();
  await fetch(`${baseUrl}/api/articles/${article.id}/image-plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt: generatedArticle.updatedAt })
  });

  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${baseUrl}/articles/${article.id}`);
    await page.locator("img.image-plan-thumbnail").first().waitFor();
    await page.screenshot({ path: resolve(outputDir, "desktop-workspace.png"), fullPage: true });
    await page.getByRole("button", { name: "预览" }).click();
    await page.frameLocator("iframe[title='公众号文章预览']").locator("img").first().waitFor();
    await page.screenshot({ path: resolve(outputDir, "wechat-preview.png"), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "关闭预览" }).click();
    await page.screenshot({ path: resolve(outputDir, "mobile-workspace.png"), fullPage: true });
  } finally {
    await browser.close();
  }
} finally {
  if (server.pid) {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  }
}
