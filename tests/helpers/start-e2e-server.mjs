import { createServer } from "node:http";
import next from "next";

delete process.env.FORCE_COLOR;

const hostname = "127.0.0.1";
// 与 playwright.config.ts / run-e2e.mjs 共用 E2E_PORT（缺省 3000），
// dev server 被占用时可换端口并行跑 E2E。
const port = Number(process.env.E2E_PORT ?? 3000);
// 换端口还不够：dev server 的锁落在 `<distDirRoot>/dev/lock`（Next 16 在 dev 阶段会把
// distDir 拼成 `<distDirRoot>/dev`），默认 `.next` 下第二个实例会直接退出。
// 注意 `next({ conf: { distDir } })` 在 Next 16 会被静默忽略——自定义服务器
// （NextCustomServer.prepare）调用 getRequestHandlers 时不转发 conf。
// 所以改由 next.config.ts 读 WO_XI_DIST_DIR 来换独立构建目录：首次要完整编译一次，
// 之后复用缓存，与使用中的 dev server 真并行、互不干扰。
process.env.WO_XI_DIST_DIR ??= process.env.E2E_DIST_DIR ?? ".next/e2e-dev";
const app = next({ dev: true, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((request, response) => handle(request, response));
await new Promise((resolve) => server.listen(port, hostname, resolve));

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const forceExit = setTimeout(() => process.exit(0), 3_000);
  forceExit.unref();
  server.close();
  server.closeAllConnections();
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
