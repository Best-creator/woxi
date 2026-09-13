import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  // 产物目录（trace / 截图等）默认落在仓库根的 `test-results/`，两个问题：
  // 1) 本机在用户目录下删除单个文件的耗时可到 260~550ms，而系统临时目录只要 0.7ms；
  //    Playwright 收尾要逐个删除这些 artifact，落在仓库目录里会把内部超时（停 worker 300s、
  //    teardown 360s）顶穿，表现为「用例都过了但进程卡死、汇总行打不出来」。
  // 2) 产物本来就不该污染工作区。
  // 放到系统临时目录后，收尾删除走快路径。
  outputDir: join(tmpdir(), "wo-xi-playwright-output"),
  // E2E 跑在 `next dev` 上：首次访问某个路由要现编译，慢盘上会明显超过默认的 5s/30s 预算。
  // 这里放宽等待上限，断言本身没有放松。
  timeout: 90_000,
  expect: { timeout: 20_000 },
  // 兜底：即便收尾仍然被拖慢，也让它退化成一次有界的可见失败，而不是无限挂起。
  globalTimeout: 6 * 60_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1440, height: 1000 },
        permissions: ["clipboard-read", "clipboard-write"]
      }
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"],
        channel: "chrome",
        viewport: { width: 390, height: 844 }
      }
    }
  ]
});
