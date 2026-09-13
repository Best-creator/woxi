import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import { resolve } from "node:path";

const root = process.cwd();
const env = {
  ...process.env,
  CONTENT_DB_PATH: ".data/e2e.db",
  // Keep all E2E workflows in deterministic Demo mode, even with local credentials.
  LLM_API_KEY: "",
  LLM_MODEL: "",
  LLM_MODELS: "",
  IMAGE_API_KEY: "",
  // Zero external network: getWebSearch() returns NullWebSearch, so the
  // research endpoint fails fast offline instead of hitting Sogou/Bing.
  WO_XI_DISABLE_WEB_SEARCH: "1"
};
delete env.FORCE_COLOR;
delete env.NO_COLOR;

await new Promise((resolvePort, rejectPort) => {
  const socket = connect({ host: "127.0.0.1", port: 3000 });
  socket.once("connect", () => {
    socket.destroy();
    rejectPort(new Error("Port 3000 is already in use; stop the existing server before E2E tests"));
  });
  socket.once("error", (error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ECONNREFUSED") {
      resolvePort();
      return;
    }
    rejectPort(error);
  });
});

const server = spawn(
  process.execPath,
  [resolve(root, "tests/helpers/start-e2e-server.mjs")],
  { cwd: root, env, stdio: "inherit", detached: process.platform !== "win32" }
);

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`E2E server exited with code ${server.exitCode}`);
    }
    try {
      const response = await fetch("http://127.0.0.1:3000");
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("E2E server did not become ready within 120 seconds");
}

function stopServer() {
  if (!server.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      stdio: "ignore"
    });
  } else {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // The process group has already exited.
    }
  }
}

let exitCode = 1;
try {
  await waitForServer();
  const runner = spawn(
    process.execPath,
    [
      resolve(root, "node_modules/@playwright/test/cli.js"),
      "test",
      ...process.argv.slice(2)
    ],
    { cwd: root, env, stdio: "inherit" }
  );
  exitCode = await new Promise((resolveExit) => {
    runner.once("exit", (code) => resolveExit(code ?? 1));
  });
} finally {
  stopServer();
}

process.exit(exitCode);
