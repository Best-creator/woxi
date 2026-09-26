import { copyFileSync } from "node:fs";
import { rm } from "node:fs/promises";

/**
 * 删除一张生成文件的磁盘副本。
 *
 * 版本记录被删、生成中途失败、配图整张被移除时都要清文件，否则磁盘上会越堆越多
 * 没有任何记录指向的孤儿图。失败一律吞掉：图还在不在不该阻塞已经成功的数据库变更，
 * 但删不掉的文件也确实没什么补救手段，记在返回值里交给调用方决定要不要提示。
 */
export async function removeGenerationFile(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath) return false;
  try {
    await rm(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** 批量清理（配图被删时一次带走它名下所有版本的文件）。 */
export async function removeGenerationFiles(
  filePaths: ReadonlyArray<string | null | undefined>
): Promise<number> {
  let removed = 0;
  for (const filePath of filePaths) {
    if (await removeGenerationFile(filePath)) removed += 1;
  }
  return removed;
}

/**
 * 同步复制一份生成文件（跨槽位「设为封面」时给封面做独立副本）。
 *
 * selectGeneration 跑在 sqlite 的同步事务里，不能 await，所以用 copyFileSync。
 * 每条版本记录的 file_path 必须互相独立：删除版本会按 file_path 清文件，
 * 共用路径会让删封面版本顺手删掉段落那张图。失败吞掉返回 false，由调用方回退。
 */
export function copyGenerationFile(sourcePath: string, targetPath: string): boolean {
  try {
    copyFileSync(sourcePath, targetPath);
    return true;
  } catch {
    return false;
  }
}
