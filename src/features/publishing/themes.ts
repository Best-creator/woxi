export type ThemeId = "ink" | "clear" | "warm";

export interface WechatTheme {
  name: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
  surface: string;
  background: string;
}

export const WECHAT_THEMES: Record<ThemeId, WechatTheme> = {
  ink: {
    name: "墨色",
    text: "#242824",
    muted: "#6d746f",
    accent: "#167554",
    border: "#dce4df",
    surface: "#f3f7f5",
    background: "#ffffff"
  },
  clear: {
    name: "清朗",
    text: "#20262b",
    muted: "#68737c",
    accent: "#1769aa",
    border: "#dce5eb",
    surface: "#f1f7fa",
    background: "#ffffff"
  },
  warm: {
    name: "暖白",
    text: "#292724",
    muted: "#766f65",
    accent: "#a8522d",
    border: "#e8dfd4",
    surface: "#faf5ee",
    background: "#fffefd"
  }
};

