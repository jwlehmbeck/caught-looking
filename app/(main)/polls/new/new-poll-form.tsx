"use client";

import { useActionState, useState } from "react";

import { createPoll, type CreatePollState } from "@/lib/polls/actions";
import { CLOSE_CHOICES, POLL_MAX_OPTIONS, POLL_OPTION_MAX, POLL_QUESTION_MAX } from "@/lib/polls/rules";

export interface TeamOption {
  id: number;
  abbreviation: string;
  name: string;
  city: string;
}

const field: React.CSSProperties = {
  font: "inherit",
  color: "var(--cl-text)",
  background: "var(--cl-bg)",
  border: "1px solid var(--cl-border-strong)",
  borderRadius: "var(--cl-radius-sm)",
  padding: "0 12px",
  minHeight: "var(--cl-tap)",
  width: "100%",
};

const labelStyle: React.CSSProperties = { display: "grid", gap: 6, fontSize: 14, color: "var(--cl-text-muted)" };

export function NewPollForm({ teams }: { teams: TeamOption[] }) {
  const [state, action, pending] = useActionState<CreatePollState, FormData>(createPoll, null);
  const [optionCount, setOptionCount] = useState(2);

  return (
    <form
      action={action}
      style={{
        background: "var(--cl-bg-card)",
        border: "1px solid var(--cl-border)",
        borderRadius: "var(--cl-radius)",
        padding: 16,
        display: "grid",
        gap: 16,
      }}
    >
      <label style={labelStyle}>
        Question
        <textarea name="question" required maxLength={POLL_QUESTION_MAX} rows={2} style={{ ...field, padding: 12, resize: "vertical" }} />
      </label>

      <fieldset style={{ border: 0, display: "grid", gap: 8, padding: 0 }}>
        <legend style={{ fontSize: 14, color: "var(--cl-text-muted)", marginBottom: 6 }}>Options (2 to 4)</legend>
        {Array.from({ length: optionCount }, (_, i) => (
          <label key={i} style={labelStyle}>
            Option {i + 1}
            <input name={`option_${i}`} type="text" required={i < 2} maxLength={POLL_OPTION_MAX} style={field} />
          </label>
        ))}
        {optionCount < POLL_MAX_OPTIONS ? (
          <button
            type="button"
            onClick={() => setOptionCount((n) => Math.min(POLL_MAX_OPTIONS, n + 1))}
            style={{ ...field, width: "auto", justifySelf: "start", background: "transparent", cursor: "pointer" }}
          >
            + Add option
          </button>
        ) : null}
      </fieldset>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={labelStyle}>
          Team A (optional)
          <select name="team_a" defaultValue="" style={field}>
            <option value="">None</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.abbreviation} · {t.city} {t.name}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Team B (optional)
          <select name="team_b" defaultValue="" style={field}>
            <option value="">None</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.abbreviation} · {t.city} {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label style={labelStyle}>
        Closes in
        <select name="closes_in" defaultValue="24h" style={field}>
          {CLOSE_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Game id (optional)
        <input name="game_id" type="text" inputMode="numeric" pattern="[0-9]*" style={field} />
      </label>

      {state && !state.ok ? (
        <p role="alert" style={{ fontSize: 14, color: "var(--cl-text)" }}>
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        style={{
          ...field,
          background: "var(--cl-accent)",
          color: "var(--cl-on-accent)",
          border: 0,
          fontWeight: 700,
          borderRadius: "var(--cl-radius-pill)",
          cursor: "pointer",
        }}
      >
        {pending ? "Creating…" : "Create poll"}
      </button>
    </form>
  );
}
