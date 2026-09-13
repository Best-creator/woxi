export interface ReferenceCharacter {
  id: string;
  name: string;
  /** 角色身份设定，例如「自媒体科普老师」。 */
  persona: string;
  /** 形象外形描述，用于在绘图提示词中复现该形象；可由 AI 从参考图提取。 */
  description: string;
  mimeType: string;
  /** 参考图在磁盘上的存储路径；仅服务端删除文件时使用。 */
  filePath: string;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewReferenceCharacter {
  name: string;
  persona: string;
  description: string;
  mimeType: string;
  filePath: string;
}

export interface ReferenceCharacterPatch {
  name?: string;
  persona?: string;
  description?: string;
}

export interface ReferenceCharacterRepository {
  list(): Promise<ReferenceCharacter[]>;
  findById(id: string): Promise<ReferenceCharacter | null>;
  /** id 可由调用方预生成（先落文件、再建记录）；缺省时自动生成。 */
  create(input: NewReferenceCharacter, id?: string): Promise<ReferenceCharacter>;
  update(id: string, patch: ReferenceCharacterPatch): Promise<ReferenceCharacter | null>;
  remove(id: string): Promise<boolean>;
}

/** 允许上传的参考图类型；超集越少越能保证存储扩展名可靠。 */
export const CHARACTER_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif"
};

export const CHARACTER_MAX_BYTES = 5 * 1024 * 1024;
