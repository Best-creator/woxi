import type { ImageAspectRatio } from "./domain";
import { heuristicComicStripMode } from "./comic-strip-mode-router";
import type { VisualPlan, VisualPlanInput, VisualPlanner } from "./visual-planner";

/** Demo 分镜的景别轮换：保证相邻分镜景别有变化，接近真实规划器的镜头语言。 */
const shotCycle = ["全景", "中景", "特写", "俯视", "近景", "仰视"] as const;

function summarize(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 100);
}

function storyboardPrompt(topic: string, summary: string, scene: number, shot: string) {
  return (
    `动漫分镜 第 ${scene} 格，${shot}镜头。围绕「${summary}」绘制日系动漫画风画面：` +
    `清晰线条、赛璐璐上色、明快配色，角色动作与表情突出「${topic}」的这个知识点，画面承担解释职责，` +
    `含旁白框「${topic}」。`
  );
}

export class DemoVisualPlanner implements VisualPlanner {
  async plan(input: VisualPlanInput): Promise<VisualPlan> {
    // Demo 规则：跳过与相邻块的距离过近者，按正文顺序取最多 4 个需要图示解释的段落。
    const explainable = input.blocks
      .filter((block) => block.type !== "image" && block.content.trim().length >= 30)
      .filter(
        (block, index, all) =>
          index === 0 || all[index - 1].content.trim().length < 30 || block.order - all[index - 1].order > 1
      )
      .slice(0, 4);

    // 排法决策与分镜设计同源：Demo 也按同一套确定性规则给出（E2E 全链路无 LLM 可跑）。
    const stripDecision = explainable.length
      ? heuristicComicStripMode({
          panels: explainable.map((block) => ({
            title: null,
            caption: block.content,
            chars: block.content.replace(/\s/g, "").length
          })),
          excerpt: input.blocks
            .slice(0, 3)
            .map((block) => block.content)
            .join("\n")
            .slice(0, 300)
        })
      : null;

    return {
      suggestions: [
        {
          type: "cover",
          anchorBlockId: null,
          purpose: `${input.topic}封面钩子（与首格分镜错开）`,
          prompt:
            `${input.topic}：以悬念式封面构图绘制日系动漫画风公众号封面——` +
            `放大该主题最具反差的符号元素作视觉焦点，不复述文章标题，` +
            `与第一格分镜（问题起点）错开场景与母题，清晰线条、赛璐璐上色，无水印。`,
          altText: `${input.topic}封面图`,
          aspectRatio: "cover"
        },
        ...explainable.map((block, index) => {
          const shot = shotCycle[index % shotCycle.length];
          const scene = index + 1;
          return {
            type: "storyboard" as const,
            anchorBlockId: block.id,
            purpose: `分镜 ${scene}｜${shot}：解释${summarize(block.content)}`,
            prompt: storyboardPrompt(input.topic, summarize(block.content), scene, shot),
            altText: `${input.topic}分镜${scene}`,
            aspectRatio: (index % 2 === 0 ? "landscape" : "portrait") as ImageAspectRatio
          };
        })
      ],
      stripDecision
    };
  }
}
