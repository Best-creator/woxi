import { rmSync } from "node:fs";
import { resolve } from "node:path";

for (const suffix of ["", "-shm", "-wal"]) {
  rmSync(resolve(`.data/e2e.db${suffix}`), { force: true });
}

