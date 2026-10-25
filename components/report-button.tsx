"use client";

import { useId, useState, useTransition } from "react";

import { fileReport } from "@/lib/safety/actions";
import { CRISIS_LINE, REPORT_CATEGORIES, type ReportTargetType } from "@/lib/safety/categories";

interface ReportButtonProps {
  targetType: ReportTargetType;
  targetId: string | number;
  /** Shown to screen readers: "Report this comment". */
  label?: string;
}

const tap: React.CSSProperties = {
  minWidth: "var(--cl-tap)",
  minHeight: "var(--cl-tap)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "0 12px",
  borderRadius: "var(--cl-radius-pill)",
  border: "1px solid var(--cl-border-strong)",
  background: "transparent",
  color: "var(--cl-text-muted)",
  fontSize: 14,
  fontWeight: 500,
};

/**
 * A 44 px flag button that opens a small form: six reasons, optional
 * details, one submit. Posts through the `fileReport` server action.
 */
export function ReportButton({ targetType, targetId, label = "Report" }: ReportButtonProps) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [details, setDetails] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!category) {
      setResult({ ok: false, message: "Pick a reason." });
      return;
    }
    startTransition(async () => {
      const r = await fileReport({ targetType, targetId: String(targetId), category, details });
      setResult(r);
      if (r.ok) {
        setCategory("");
        setDetails("");
      }
    });
  }

  return (
    <span style={{ display: "inline-block" }}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setResult(null);
        }}
        aria-expanded={open}
        aria-controls={formId}
        aria-label={label}
        style={tap}
      >
        <span aria-hidden="true">⚑</span>
        <span>{label}</span>
      </button>

      {open ? (
        <form
          id={formId}
          onSubmit={submit}
          style={{
            marginTop: 8,
            padding: 16,
            background: "var(--cl-bg-card)",
            border: "1px solid var(--cl-border)",
            borderRadius: "var(--cl-radius)",
            display: "grid",
            gap: 8,
            maxWidth: 360,
          }}
        >
          <p style={{ fontWeight: 700 }}>What&apos;s wrong?</p>
          <fieldset style={{ border: 0, display: "grid", gap: 4 }}>
            <legend style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
              Reason
            </legend>
            {REPORT_CATEGORIES.map((c) => (
              <label
                key={c.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  minHeight: "var(--cl-tap)",
                  padding: "0 4px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="category"
                  value={c.value}
                  checked={category === c.value}
                  onChange={() => setCategory(c.value)}
                  style={{ width: 20, height: 20, accentColor: "var(--cl-accent)" }}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </fieldset>

          {category === "urgent" ? (
            <p
              role="note"
              style={{
                padding: 12,
                borderRadius: "var(--cl-radius-sm)",
                background: "var(--cl-bg-raised)",
                color: "var(--cl-text)",
                fontSize: 14,
              }}
            >
              {CRISIS_LINE}
            </p>
          ) : null}

          <label style={{ display: "grid", gap: 4, fontSize: 14, color: "var(--cl-text-muted)" }}>
            Anything else? (optional)
            <textarea
              name="details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={500}
              rows={3}
              style={{
                font: "inherit",
                color: "var(--cl-text)",
                background: "var(--cl-bg)",
                border: "1px solid var(--cl-border-strong)",
                borderRadius: "var(--cl-radius-sm)",
                padding: 10,
                resize: "vertical",
              }}
            />
          </label>

          {result ? (
            <p
              role="status"
              style={{ fontSize: 14, color: result.ok ? "var(--cl-accent)" : "var(--cl-text)" }}
            >
              {result.message}
            </p>
          ) : null}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={pending}
              style={{
                ...tap,
                flex: 1,
                background: "var(--cl-accent)",
                color: "var(--cl-on-accent)",
                border: 0,
                fontWeight: 700,
              }}
            >
              {pending ? "Sending…" : "Send report"}
            </button>
            <button type="button" onClick={() => setOpen(false)} style={tap}>
              Close
            </button>
          </div>
        </form>
      ) : null}
    </span>
  );
}
