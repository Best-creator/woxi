import type { StyleLibraryRepository } from "./domain";
import { StyleExportFileSchema } from "./domain";

export interface ImportStylesResult {
  /** 成功写入（新增或覆盖）的风格数量。 */
  imported: number;
  /** 与库中现有风格同名且内容完全一致的条数（无变化，跳过写入）。 */
  skipped: number;
  /** 逐条校验失败的说明（含定位信息，导入是宽容的：坏一条不影响其他）。 */
  errors: string[];
}

/**
 * 导入 style-lab 导出的风格文件：
 * 整体走 Zod 校验（version 兜底防串格式），再逐条幂等写入；
 * 同名且 JSON 内容相同的条目跳过——同一份文件重复导入是安全操作。
 */
export async function importStyles(
  payload: unknown,
  repository: StyleLibraryRepository,
  source = "style-lab 导出"
): Promise<ImportStylesResult> {
  const parsed = StyleExportFileSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      imported: 0,
      skipped: 0,
      errors: [
        `导出文件格式无效（${issue?.path.join(".") || "根节点"}：${issue?.message ?? "结构不符"}）`
      ]
    };
  }

  const result: ImportStylesResult = { imported: 0, skipped: 0, errors: [] };
  const existing = await repository.list();
  const existingByName = new Map(existing.map((entry) => [entry.name, entry]));

  for (const profile of parsed.data.styles) {
    const current = existingByName.get(profile.name);
    if (current && JSON.stringify(current.profile) === JSON.stringify(profile)) {
      result.skipped += 1;
      continue;
    }
    await repository.upsert(profile, source);
    result.imported += 1;
  }
  return result;
}
