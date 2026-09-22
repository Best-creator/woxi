"use client";

import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { OutlineSection } from "@/features/articles/domain";

export interface OutlineNavProps {
  sections: OutlineSection[];
  /** 全篇剧情推演（大纲生成器产出的故事线蓝图）；只读展示，改它靠重新生成或修订大纲。 */
  storyline?: string | null;
  readOnly?: boolean;
  disabled?: boolean;
  onChange?: (sections: OutlineSection[]) => void;
}

export function OutlineNav({
  sections,
  storyline,
  readOnly = false,
  disabled = false,
  onChange
}: OutlineNavProps) {
  const [isEditing, setIsEditing] = useState(false);
  const showEditor = isEditing && !readOnly;

  function updateSections(next: OutlineSection[]) {
    if (readOnly || disabled) return;
    onChange?.(next.map((section, order) => ({ ...section, order })));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    updateSections(next);
  }

  function addSection() {
    updateSections([
      ...sections,
      { id: `section-${Date.now()}`, title: "新章节", order: sections.length }
    ]);
  }

  function rename(index: number, title: string) {
    updateSections(sections.map((section, itemIndex) =>
      itemIndex === index ? { ...section, title } : section
    ));
  }

  function updateSection(index: number, changes: Partial<OutlineSection>) {
    updateSections(sections.map((section, itemIndex) =>
      itemIndex === index ? { ...section, ...changes } : section
    ));
  }

  return (
    <nav className="outline-nav" aria-label="文章大纲">
      <div className="outline-heading">
        <p className="panel-label">文章大纲</p>
        <span className="outline-heading-actions">
          {showEditor ? (
            <button className="icon-button" type="button" onClick={addSection} aria-label="新增章节" title="新增章节" disabled={disabled}>
              <Plus size={15} aria-hidden="true" />
            </button>
          ) : null}
          {!readOnly ? (
            <button
              className="icon-button"
              type="button"
              aria-label={showEditor ? "完成章节结构编辑" : "编辑章节结构"}
              title={showEditor ? "完成" : "编辑"}
              disabled={disabled}
              onClick={() => setIsEditing((value) => !value)}
            >
              {showEditor ? <Check size={15} aria-hidden="true" /> : <Pencil size={15} aria-hidden="true" />}
            </button>
          ) : null}
        </span>
      </div>
      {storyline ? (
        <div className="outline-storyline">
          <p className="panel-label">剧情推演</p>
          <p className="outline-storyline-text">{storyline}</p>
        </div>
      ) : null}
      {sections.length === 0 ? (
        <p className="panel-empty">生成初稿后显示章节</p>
      ) : (
        <ol>
          {sections.map((section, index) => (
            <li key={section.id} className="outline-section-card">
              <span className="outline-section-index" aria-hidden="true">{index + 1}</span>
              {showEditor ? (
                <div className="outline-section-fields">
                  <input
                    className="outline-section-title"
                    aria-label={`${section.title}标题`}
                    value={section.title}
                    disabled={disabled}
                    onChange={(event) => rename(index, event.target.value)}
                  />
                  <div className="outline-section-meta">
                    <input
                      aria-label={`${section.title}目标`}
                      placeholder="本节目标"
                      value={section.goal ?? ""}
                      disabled={disabled}
                      onChange={(event) => updateSection(index, { goal: event.target.value })}
                    />
                    <label className="outline-word-field">
                      <span>字数</span>
                      <input
                        aria-label={`${section.title}建议字数`}
                        type="number"
                        min="50"
                        max="2000"
                        value={section.recommendedWords ?? ""}
                        disabled={disabled}
                        onChange={(event) => updateSection(index, {
                          recommendedWords: event.target.value ? Number(event.target.value) : undefined
                        })}
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="outline-section-fields">
                  <p className="outline-section-title">{section.title}</p>
                  {section.goal ? <p className="outline-section-goal">{section.goal}</p> : null}
                  {section.recommendedWords ? <p className="outline-section-words">{section.recommendedWords} 字</p> : null}
                </div>
              )}
              {showEditor ? (
                <span className="outline-actions">
                  <button type="button" className="icon-button" aria-label={`${section.title}上移`} title="上移" onClick={() => move(index, -1)} disabled={disabled || index === 0}>
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-button" aria-label={`${section.title}下移`} title="下移" onClick={() => move(index, 1)} disabled={disabled || index === sections.length - 1}>
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-button" aria-label={`${section.title}删除`} title="删除" onClick={() => updateSections(sections.filter((_, itemIndex) => itemIndex !== index))} disabled={disabled}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}
