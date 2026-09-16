import { z } from "zod";

/**
 * 视觉风格画像：与 style-lab（风格实验台）导出的 StyleProfile 字段一一对齐。
 * 这是「从小红书博主图集提炼出的可复用画风」，导入后供配图规划时注入绘制风格。
 */
export const StyleProfileSchema = z.object({
  name: z.string().trim().min(1).max(40),
  summary: z.string().trim().min(10).max(200),
  palette: z
    .array(z.string().regex(/^#[0-9a-fA-F]{6}$/, "色板必须是 #RRGGBB 格式"))
    .min(3)
    .max(10),
  lineWork: z.string().trim().min(10).max(300),
  characterDesign: z.string().trim().min(10).max(300),
  composition: z.string().trim().min(10).max(300),
  background: z.string().trim().min(5).max(300),
  textRendering: z.string().trim().min(5).max(300),
  promptTemplate: z.string().trim().min(50).max(800)
});

export type StyleProfile = z.infer<typeof StyleProfileSchema>;

/** style-lab 导出文件的包裹结构（version 不匹配时拒绝导入，防止脏数据）。 */
export const StyleExportFileSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().optional(),
  source: z.string().optional(),
  styles: z.array(StyleProfileSchema).min(1)
});

export type StyleExportFile = z.infer<typeof StyleExportFileSchema>;

export interface StyleLibraryEntry {
  id: string;
  name: string;
  profile: StyleProfile;
  /** 导入来源说明（如「style-lab 导出」），便于溯源。 */
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface StyleLibraryRepository {
  list(): Promise<StyleLibraryEntry[]>;
  findById(id: string): Promise<StyleLibraryEntry | null>;
  /** 按 name 幂等写入：同名风格重复导入时覆盖更新（风格库可再提炼、可再导入）。 */
  upsert(profile: StyleProfile, source: string, id?: string): Promise<StyleLibraryEntry>;
}
