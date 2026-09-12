import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ArticleRevision, OutlineRevisionSnapshot } from "@/features/revisions/domain";
import { VersionHistory } from "./version-history";

const version: ArticleRevision<OutlineRevisionSnapshot> = {
  id: "revision-2",
  articleId: "article-1",
  scope: "outline",
  version: 2,
  contentHash: "hash",
  model: "writer-large",
  reason: "manual",
  createdAt: "2026-09-10T00:00:00.000Z",
  snapshot: {
    title: "机会成本",
    brief: { oneSentence: "取舍", concepts: [], prerequisites: [], misconceptions: [], analogies: [], unsupportedNotes: [] },
    outline: [],
    lengthPreset: "standard",
    recommendedTotalWords: 1200,
    sourceContextSnapshot: ""
  }
};

describe("VersionHistory", () => {
  it("saves the current draft from the compact strip", async () => {
    const onSave = vi.fn();
    render(<VersionHistory versions={[version]} onSave={onSave} />);

    await userEvent.click(screen.getByRole("button", { name: "保存当前版本" }));

    expect(onSave).toHaveBeenCalledOnce();
  });

  it("selects a version for preview without restoring it", async () => {
    const onSelect = vi.fn();
    render(<VersionHistory versions={[version]} selectedVersionId={version.id} onSave={vi.fn()} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole("button", { name: "查看大纲 v2" }));

    expect(onSelect).toHaveBeenCalledWith("revision-2");
    expect(screen.getByRole("button", { name: "查看大纲 v2" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "查看大纲 v2" })).toHaveTextContent("v2");
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复大纲 v2" })).not.toBeInTheDocument();
  });

  it("marks a review-applied version so it can be styled separately from other versions", () => {
    render(
      <VersionHistory
        versions={[
          { ...version, id: "revision-reviewed", version: 2, reason: "review_applied" },
          { ...version, id: "revision-generated", version: 1, reason: "generated" }
        ]}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "查看大纲 v2，审核修订" })).toHaveClass("version-chip-reviewed");
    expect(screen.getByRole("button", { name: "查看大纲 v1" })).not.toHaveClass("version-chip-reviewed");
  });

  it("disables mutations while an outline action is pending", () => {
    render(<VersionHistory versions={[version]} onSave={vi.fn()} disabled />);

    expect(screen.getByRole("button", { name: "保存当前版本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "查看大纲 v2" })).toBeDisabled();
  });
});
