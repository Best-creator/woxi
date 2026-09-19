import type { NextConfig } from "next";

// 为什么这里读一个环境变量：Next 16 在 dev 阶段会把 distDir 拼成 `<distDirRoot>/dev`，
// dev 锁落在 `<distDirRoot>/dev/lock` 上。默认 distDirRoot=`.next` 时，只要本机已经
// 有一个 dev server 在跑（用户自己开着开发），第二个 dev server 会直接退出——E2E
// 因此起不来。而 `next({ conf: { distDir } })` 在 Next 16 已失效：自定义服务器
// （NextCustomServer）调用 getRequestHandlers 时不转发 conf，distDir 会被静默忽略。
// 于是改走配置文件读环境变量：只有 E2E 启动器会设置 WO_XI_DIST_DIR，
// 日常开发与构建不受影响。
const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  ...(process.env.WO_XI_DIST_DIR ? { distDir: process.env.WO_XI_DIST_DIR } : {})
};

export default nextConfig;
