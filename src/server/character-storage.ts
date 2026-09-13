import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CHARACTER_MIME_TYPES } from "@/features/characters/domain";
import { getServerConfig } from "./config";

export interface CharacterImageStore {
  /** 保存图片字节，返回相对存储路径（供数据库记录）。 */
  save(id: string, mimeType: string, bytes: Buffer): string;
  read(filePath: string): Buffer;
  remove(filePath: string): void;
}

export function createCharacterImageStore(rootDir: string): CharacterImageStore {
  return {
    save(id, mimeType, bytes) {
      const extension = CHARACTER_MIME_TYPES[mimeType];
      if (!extension) throw new Error(`不支持的参考图类型：${mimeType}`);
      mkdirSync(rootDir, { recursive: true });
      const filePath = join(rootDir, `${id}.${extension}`);
      writeFileSync(filePath, bytes);
      return filePath;
    },
    read(filePath) {
      return readFileSync(resolve(filePath));
    },
    remove(filePath) {
      try {
        unlinkSync(resolve(filePath));
      } catch {
        // 文件可能已被手动清理；删除记录不应因此失败。
      }
    }
  };
}

/** 参考图统一存放在数据库同目录的 uploads/characters 下，随数据目录一起备份/迁移。 */
export function characterImageStoreDir(databasePath: string) {
  return join(dirname(resolve(databasePath)), "uploads", "characters");
}

export function getCharacterImageStore() {
  return createCharacterImageStore(characterImageStoreDir(getServerConfig().databasePath));
}
