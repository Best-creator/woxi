import { DatabaseSync } from "node:sqlite";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { migrateDatabase } from "@/server/db";

export function createTestDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrateDatabase(db);
  return db;
}

export function createTestRepository() {
  return new SqliteArticleRepository(createTestDatabase());
}
