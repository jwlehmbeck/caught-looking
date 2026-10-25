"use client";

import { useActionState } from "react";

import { generateInvites, type InviteState } from "./actions";

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

const initial: InviteState = { codes: [], error: null };

/** Admin form: generate N codes, show them once. */
export function InviteGenerator() {
  const [state, action, pending] = useActionState(generateInvites, initial);

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <form action={action} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 14, color: "var(--cl-text-muted)" }}>
          How many codes
          <input name="count" type="number" min={1} max={100} defaultValue={5} style={field} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 14, color: "var(--cl-text-muted)" }}>
          Uses per code
          <input name="max_uses" type="number" min={1} max={1000} defaultValue={1} style={field} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 14, color: "var(--cl-text-muted)" }}>
          Expires in (days, 0 = never)
          <input name="days" type="number" min={0} max={365} defaultValue={30} style={field} />
        </label>
        <button
          type="submit"
          disabled={pending}
          style={{
            minHeight: "var(--cl-tap)",
            borderRadius: "var(--cl-radius-pill)",
            border: 0,
            background: "var(--cl-accent)",
            color: "var(--cl-on-accent)",
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          {pending ? "Generating…" : "Generate codes"}
        </button>
      </form>

      {state.error ? (
        <p role="alert" style={{ color: "var(--cl-text)" }}>
          {state.error}
        </p>
      ) : null}

      {state.codes.length > 0 ? (
        <div
          style={{
            padding: 16,
            background: "var(--cl-bg-card)",
            border: "1px solid var(--cl-border)",
            borderRadius: "var(--cl-radius)",
            display: "grid",
            gap: 8,
          }}
        >
          <p style={{ fontWeight: 700 }}>Copy these now. They won&apos;t be shown again.</p>
          <ul style={{ listStyle: "none", display: "grid", gap: 6 }}>
            {state.codes.map((code) => (
              <li
                key={code}
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 20,
                  letterSpacing: 2,
                  padding: "8px 12px",
                  background: "var(--cl-bg)",
                  borderRadius: "var(--cl-radius-sm)",
                  userSelect: "all",
                }}
              >
                {code}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
