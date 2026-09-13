// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../../../tests/helpers/test-db";
import { SqliteReferenceCharacterRepository } from "./sqlite-repository";

describe("SqliteReferenceCharacterRepository", () => {
  it("creates, lists, updates, and removes characters", async () => {
    const repo = new SqliteReferenceCharacterRepository(createTestDatabase());

    const created = await repo.create({
      name: "蘑菇老师",
      persona: "自媒体科普老师",
      description: "圆润的红伞白点蘑菇卡通形象",
      mimeType: "image/png",
      filePath: "/tmp/mushroom.png"
    });

    expect(created.name).toBe("蘑菇老师");
    expect(created.publicUrl).toBe(`/api/characters/${created.id}/image`);
    expect((await repo.list()).map((item) => item.id)).toEqual([created.id]);

    const updated = await repo.update(created.id, { persona: "科普博主" });
    expect(updated?.persona).toBe("科普博主");
    expect(updated?.description).toBe("圆润的红伞白点蘑菇卡通形象");

    // 未传 id 时自动生成，两条记录互不影响。
    const second = await repo.create({
      name: " second ",
      persona: "",
      description: "",
      mimeType: "image/jpeg",
      filePath: "/tmp/second.jpg"
    });
    expect(second.id).not.toBe(created.id);
    expect(await repo.findById(second.id)).not.toBeNull();

    expect(await repo.remove(created.id)).toBe(true);
    expect(await repo.findById(created.id)).toBeNull();
    expect(await repo.update(created.id, { name: "x" })).toBeNull();
    expect(await repo.remove(created.id)).toBe(false);
  });
});
