"use client";

import { Save } from "lucide-react";
import type { ArticleRevision } from "@/features/revisions/domain";

export interface VersionHistoryProps<TSnapshot = unknown> {
  versions: ArticleRevision<TSnapshot>[];
  selectedVersionId?: string | null;
  disabled?: boolean;
  canSave?: boolean;
  heading?: string;
  versionPrefix?: string;
  saveLabel?: string;
  reviewedReason?: ArticleRevision<TSnapshot>["reason"];
  onSave: () => void;
  onSelect?: (versionId: string) => void;
}

export function VersionHistory<TSnapshot>({
  versions,
  selectedVersionId = null,
  disabled = false,
  canSave = true,
  heading = "大纲版本",
  versionPrefix = "大纲",
  saveLabel = "保存当前版本",
  reviewedReason = "review_applied",
  onSave,
  onSelect
}: VersionHistoryProps<TSnapshot>) {
  return (
    <section className="version-history" aria-labelledby="version-history-heading">
      <div className="version-strip">
        <h2 id="version-history-heading">{heading}</h2>
        <button className="button button-secondary version-save-button" type="button" disabled={disabled || !canSave} onClick={onSave}>
          <Save size={15} aria-hidden="true" />
          {saveLabel}
        </button>
        {versions.length ? (
          <ol className="version-list">
            {versions.map((version) => {
              const selected = selectedVersionId === version.id;
              const reviewed = version.reason === reviewedReason;
              return (
                <li key={version.id} className={selected ? "is-selected" : undefined}>
                  <button
                    className={reviewed ? "version-chip version-chip-reviewed" : "version-chip"}
                    type="button"
                    aria-label={reviewed ? `查看${versionPrefix} v${version.version}，审核修订` : `查看${versionPrefix} v${version.version}`}
                    aria-current={selected ? "true" : undefined}
                    disabled={disabled}
                    onClick={() => onSelect?.(version.id)}
                  >
                    {versionPrefix} v{version.version}
                  </button>
                </li>
              );
            })}
          </ol>
        ) : <p className="panel-empty">尚无版本</p>}
      </div>
    </section>
  );
}
