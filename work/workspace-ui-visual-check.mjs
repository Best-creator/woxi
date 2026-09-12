import { spawn, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const port = 3011;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve(root, "outputs", "workspace-ui-visual-check");
const env = {
  ...process.env,
  CONTENT_DB_PATH: ".data/workspace-ui-visual-check.db",
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
      // still starting
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Visual-check server did not become ready");
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `${path} failed`);
  return result;
}

const server = spawn(
  process.execPath,
  [resolve(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)],
  { cwd: root, env, stdio: "ignore" }
);

try {
  await waitForServer();
  await mkdir(outputDir, { recursive: true });

  const created = await post("/api/articles", { topic: "一天为什么是24小时？" });
  let article = created.article;
  await post(`/api/articles/${article.id}/sources`, {
    title: "课堂笔记",
    type: "markdown",
    content: "一天被分成24小时，是文明约定，不是物理定律。",
    expectedUpdatedAt: article.updatedAt
  });
  const generated = await post(`/api/articles/${article.id}/outline/generate`, {
    expectedUpdatedAt: (await (await fetch(`${baseUrl}/api/articles/${article.id}`)).json()).article.updatedAt,
    lengthPreset: "standard"
  });
  article = generated.article;
  await post(`/api/articles/${article.id}/outline/review`, {
    expectedUpdatedAt: article.updatedAt
  });
  const confirmed = await post(`/api/articles/${article.id}/outline/confirm`, {
    expectedUpdatedAt: (await (await fetch(`${baseUrl}/api/articles/${article.id}`)).json()).article.updatedAt,
    acknowledgeWarnings: false
  });
  article = confirmed.article;

  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${baseUrl}/`);
    await page.screenshot({ path: resolve(outputDir, "desktop-home.png"), fullPage: true });

    await page.goto(`${baseUrl}/articles/new`);
    await page.screenshot({ path: resolve(outputDir, "desktop-new.png"), fullPage: true });

    await page.goto(`${baseUrl}/articles/${article.id}?step=sources`);
    await page.getByRole("heading", { name: "资料来源" }).waitFor();
    await page.screenshot({ path: resolve(outputDir, "desktop-sources.png"), fullPage: true });

    await page.goto(`${baseUrl}/articles/${article.id}?step=outline`);
    await page.getByRole("button", { name: "生成理解与大纲" }).waitFor();
    await page.screenshot({ path: resolve(outputDir, "desktop-outline.png"), fullPage: true });

    await page.goto(`${baseUrl}/articles/${article.id}?step=article`);
    await page.getByRole("button", { name: "生成完整正文" }).waitFor();
    await page.screenshot({ path: resolve(outputDir, "desktop-article.png"), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/`);
    await page.screenshot({ path: resolve(outputDir, "mobile-home.png"), fullPage: true });
    await page.goto(`${baseUrl}/articles/${article.id}?step=outline`);
    await page.getByRole("button", { name: "生成理解与大纲" }).waitFor();
    await page.screenshot({ path: resolve(outputDir, "mobile-outline.png"), fullPage: true });
    await page.goto(`${baseUrl}/articles/${article.id}?step=sources`);
    await page.getByRole("heading", { name: "资料来源" }).waitFor();
    await page.screenshot({ path: resolve(outputDir, "mobile-sources.png"), fullPage: true });
  } finally {
    await browser.close();
  }
} finally {
  if (server.pid) {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  }
}
