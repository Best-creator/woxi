import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, normalize(record[key])])
    );
  }
  return value;
}

export function hashSnapshot(snapshot: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(normalize(snapshot)))
    .digest("hex");
}
