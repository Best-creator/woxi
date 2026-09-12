"use client";

import { Check, Pencil } from "lucide-react";
import { useState } from "react";
import type { KnowledgeBrief } from "@/features/articles/domain";

const fields: Array<{
  key: keyof KnowledgeBrief;
  label: string;
  multiline?: boolean;
}> = [
  { key: "oneSentence", label: "一句话解释" },
  { key: "concepts", label: "核心概念", multiline: true },
  { key: "prerequisites", label: "前置知识", multiline: true },
  { key: "misconceptions", label: "常见误区", multiline: true },
  { key: "analogies", label: "类比和例子", multiline: true },
  { key: "unsupportedNotes", label: "待核对内容", multiline: true }
];

const emptyBrief: KnowledgeBrief = {
  oneSentence: "",
  concepts: [],
  prerequisites: [],
  misconceptions: [],
  analogies: [],
  unsupportedNotes: []
};

function valuesFor(brief: KnowledgeBrief, key: keyof KnowledgeBrief) {
  const value = brief[key];
  return Array.isArray(value) ? value.join("\n") : value;
}

export interface KnowledgeBriefEditorProps {
  brief: KnowledgeBrief | null;
  readOnly?: boolean;
  disabled?: boolean;
  onChange: (brief: KnowledgeBrief) => void;
}

export function KnowledgeBriefEditor({
  brief,
  readOnly = false,
  disabled = false,
  onChange
}: KnowledgeBriefEditorProps) {
  const current = brief ?? emptyBrief;
  const [isEditing, setIsEditing] = useState(false);
  const showEditor = isEditing && !readOnly;

  function updateField(key: keyof KnowledgeBrief, value: string) {
    const previous = current[key];
    const next = {
      ...current,
      [key]: Array.isArray(previous)
        ? value.split("\n").map((item) => item.trim()).filter(Boolean)
        : value
    };
    onChange(next);
  }

  return (
    <section className="brief-editor" aria-labelledby="brief-heading">
      <div className="brief-editor-heading">
        <div>
          <p className="panel-label">知识梳理</p>
          <h2 id="brief-heading">Knowledge Brief</h2>
        </div>
        {readOnly ? <span className="read-only-label">只读</span> : (
          <button
            className="icon-button"
            type="button"
            aria-label={showEditor ? "完成知识梳理编辑" : "编辑知识梳理"}
            title={showEditor ? "完成" : "编辑"}
            disabled={disabled}
            onClick={() => setIsEditing((value) => !value)}
          >
            {showEditor ? <Check size={15} aria-hidden="true" /> : <Pencil size={15} aria-hidden="true" />}
          </button>
        )}
      </div>
      <div className="brief-fields">
        {fields.map((field) => {
          const value = current[field.key];
          return (
          <div className="brief-field" key={field.key}>
            <span>{field.label}</span>
            {showEditor ? field.multiline ? (
              <textarea
                aria-label={field.label}
                value={valuesFor(current, field.key)}
                rows={3}
                disabled={disabled}
                onChange={(event) => updateField(field.key, event.target.value)}
              />
            ) : (
              <input
                aria-label={field.label}
                value={valuesFor(current, field.key)}
                disabled={disabled}
                onChange={(event) => updateField(field.key, event.target.value)}
              />
            ) : Array.isArray(value) ? (
              value.length ? (
                <ul className="brief-readonly-list">
                  {value.map((item) => (
                    <li key={`${field.key}-${item}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div className="brief-readonly">暂无</div>
              )
            ) : (
              <div className="brief-readonly">{value || "暂无"}</div>
            )}
          </div>
          );
        })}
      </div>
    </section>
  );
}
