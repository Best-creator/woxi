// @vitest-environment node

import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../../../../tests/helpers/test-db";
import { createCharacterImageStore } from "@/server/character-storage";
import { SqliteReferenceCharacterRepository } from "@/features/characters/sqlite-repository";
import { createCharactersRouteHandler } from "./route";
import { createCharacterRouteHandler } from "./[id]/route";
import { createCharacterImageRouteHandler } from "./[id]/image/route";

function setup() {
  const characters = new SqliteReferenceCharacterRepository(createTestDatabase());
  const store = createCharacterImageStore(mkdtempSync(join(tmpdir(), "woxi-chars-")));
  return { characters, store };
}

function pngForm(name = "蘑菇老师") {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "mushroom.png", { type: "image/png" }));
  form.set("name", name);
  form.set("persona", "自媒体科普老师");
  return form;
}

describe("characters routes", () => {
  it("uploads a reference image, lists it, serves the bytes, updates and deletes it", async () => {
    const deps = setup();
    const collection = createCharactersRouteHandler(deps);

    const created = await collection.POST(new Request("http://test/characters", { method: "POST", body: pngForm() }));
    expect(created.status).toBe(201);
    const character = (await created.json()).character;
    expect(character.name).toBe("蘑菇老师");
    expect(character.persona).toBe("自媒体科普老师");
    expect(character.publicUrl).toBe(`/api/characters/${character.id}/image`);
    // 文件确实写到磁盘。
    expect(readFileSync(character.filePath)).toBeDefined();

    const listed = await collection.GET();
    expect((await listed.json()).characters).toHaveLength(1);

    const image = await createCharacterImageRouteHandler(deps.characters, deps.store)(
      new Request("http://test/image"),
      { params: Promise.resolve({ id: character.id }) }
    );
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");

    const patched = await createCharacterRouteHandler(deps).PATCH(
      new Request("http://test/character", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "红伞白点的卡通蘑菇，戴眼镜" })
      }),
      { params: Promise.resolve({ id: character.id }) }
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).character.description).toContain("戴眼镜");

    const removed = await createCharacterRouteHandler(deps).DELETE(
      new Request("http://test/character", { method: "DELETE" }),
      { params: Promise.resolve({ id: character.id }) }
    );
    expect(removed.status).toBe(200);
    expect(existsSync(character.filePath)).toBe(false);
    expect((await createCharacterImageRouteHandler(deps.characters, deps.store)(
      new Request("http://test/image"),
      { params: Promise.resolve({ id: character.id }) }
    )).status).toBe(404);
  });

  it("rejects invalid uploads with 400", async () => {
    const collection = createCharactersRouteHandler(setup());

    const missingName = await collection.POST(new Request("http://test/characters", {
      method: "POST",
      body: (() => { const form = pngForm(); form.set("name", ""); return form; })()
    }));
    const badType = await collection.POST(new Request("http://test/characters", {
      method: "POST",
      body: (() => {
        const form = new FormData();
        form.set("file", new File([new Uint8Array([1])], "a.txt", { type: "text/plain" }));
        form.set("name", "x");
        return form;
      })()
    }));
    const noFile = await collection.POST(new Request("http://test/characters", {
      method: "POST",
      body: (() => { const form = new FormData(); form.set("name", "x"); return form; })()
    }));

    expect(missingName.status).toBe(400);
    expect(badType.status).toBe(400);
    expect(noFile.status).toBe(400);
  });

  it("maps missing characters to 404 on patch, delete, and image reads", async () => {
    const deps = setup();
    const item = createCharacterRouteHandler(deps);
    const missing = { params: Promise.resolve({ id: "nope" }) };

    const patched = await item.PATCH(new Request("http://test", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" })
    }), missing);
    const deleted = await item.DELETE(new Request("http://test", { method: "DELETE" }), missing);
    const image = await createCharacterImageRouteHandler(deps.characters, deps.store)(
      new Request("http://test"), missing
    );

    expect(patched.status).toBe(404);
    expect(deleted.status).toBe(404);
    expect(image.status).toBe(404);
  });
});
