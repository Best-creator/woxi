/**
 * 生图提示词的平台词净化。
 *
 * 为什么要净化：上游（Copilot / M365 系网关）的内容策略对「公众号 / 微信」这类平台名很敏感——
 * 带它们的请求会被整批拦掉（`upstream_content_blocked`，报「M365 content policy blocked」），
 * **换账号也一样过不去**。而这些词对画面没有任何贡献：它们只是在说「这张图给谁看」，
 * 删掉不影响画风、角色与内容。
 *
 * 真实例子（都来自本项目实际发送的文本）：
 *   「中国微信知识号手绘条漫画风」→「中国科普知识手绘条漫画风」
 *   「微信竖向长图，宽固定高不限」→「手机竖向长图，宽固定高不限」
 *
 * 命中面：画风引导（风格库画像，采集自真实公众号）、参考形象描述、帧提示词里模型自己写的
 * 「适合公众号阅读」等，都从这一处过。
 *
 * 只净化**送给上游的那一份文本**：库里的原始画像、面板里可编辑的提示词、审核留档都保持原样，
 * 作者改文案时看到的仍是他自己写的字。
 */
const PLATFORM_TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  // 顺序有讲究：先替长短语，否则会被后面「微信」「公众号」这两个通用词先吃掉。
  [/微信公众号/g, "知识图文"],
  [/公众号/g, "知识图文"],
  [/微信知识号/g, "科普知识"],
  [/知识号/g, "科普知识"],
  // 「微信竖向长图」「微信正文」这类版式描述：去平台名、留版式。
  [/微信/g, "手机"],
  [/We ?Chat|Weixin/gi, "mobile"],
  [/视频号/g, "短视频"],
  [/小红书/g, "图文社区"],
  [/抖音/g, "短视频"],
  [/微博/g, "社交平台"],
  [/知乎/g, "问答社区"],
  [/哔哩哔哩|bilibili|B站/gi, "视频网站"]
];

/** 净化提示词里可能触发上游内容策略的平台名；没有命中时原样返回。 */
export function sanitizeImagePrompt(prompt: string): string {
  let sanitized = prompt;
  for (const [pattern, replacement] of PLATFORM_TERM_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}
