# Task 7 Report: Outline Workspace UI

## Delivered

- Added the `/articles/[id]/outline` server page. It loads the article, sources, outline revisions, current review, and public-only LLM configuration before rendering the client workspace.
- Added the outline workspace with generation model/length controls, editable Knowledge Brief and outline goals/word recommendations, source-aware stale review status, review and confirmation gates, warning acknowledgement, and manual version save/restore actions.
- Added `ModelSelect`, `LengthPresetControl`, `OutlineReviewPanel`, and `VersionHistory` components with focused Testing Library coverage.
- Moved confirmation out of `OutlineNav`, updated it for goal and per-section word-count editing, and routed article creation directly to the outline page.
- Added responsive desktop three-column and mobile single-column layout styles without fixed-width controls that cause horizontal overflow.

## Verification

- `./node_modules/.bin/vitest.cmd run src/components src/app/articles/[id]/outline src/app/articles/new/new-article-form.test.tsx`
  - 13 test files passed, 35 tests passed.
- `./node_modules/.bin/vitest.cmd run src/app/articles/[id]/article-workspace.test.tsx src/components/outline-nav.test.tsx src/app/articles/[id]/outline src/components src/app/articles/new/new-article-form.test.tsx`
  - 14 test files passed, 45 tests passed, including the legacy article workspace regression affected by moving confirmation to the outline review gate.
- `./node_modules/.bin/tsc.cmd --noEmit`
  - completed successfully with exit code 0.

`pnpm vitest` and `pnpm exec vitest` did not resolve the local executable in this environment (`vitest is not recognized`), so verification used the repository's installed `vitest.cmd` directly.
