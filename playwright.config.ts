import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  // E2E 跑在 `next dev` 上：首次访问某个路由要现编译，慢盘上会明显超过默认的 5s/30s 预算。
  // 这里放宽等待上限，断言本身没有放松。
  timeout: 90_000,
  expect: { timeout: 20_000 },
  // 兜底：Playwright 停止 worker 时偶发不退出（本机已复现多次），它会静默等满 5 分钟
  // 再强杀，导致汇总结果永远打不出来、整条命令看起来像卡死。加上全局上限后，这种情况
  // 会退化成一次可见的失败而不是无限等待。正常一次全量约 3~4 分钟，这里留足余量。
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
