import { createServer } from "node:http";
import next from "next";

delete process.env.FORCE_COLOR;

const hostname = "127.0.0.1";
// 与 playwright.config.ts / run-e2e.mjs 共用 E2E_PORT（缺省 3000），
// dev server 被占用时可换端口并行跑 E2E。
const port = Number(process.env.E2E_PORT ?? 3000);
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
