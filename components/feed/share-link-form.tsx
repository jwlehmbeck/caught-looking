"use client";

import { useActionState } from "react";

import { createLinkPost } from "@/lib/feed/actions";
import { EMPTY_CREATE_POST_STATE } from "@/lib/feed/types";

export interface TeamOption {
  id: number;
  abbreviation: string;
  name: string;
  city: string;
}

interface ShareLinkFormProps {
  teams: TeamOption[];
  defaultTeamId: number | null;
}

const input: React.CSSProperties = {
  font: "inherit",
  color: "var(--cl-text)",
  background: "var(--cl-bg)",
  border: "1px solid var(--cl-border-strong)",
  borderRadius: "var(--cl-radius-sm)",
  padding: "0 12px",
  minHeight: "var(--cl-tap)",
  width: "100%",
};

const label: React.CSSProperties = { display: "grid", gap: 6, fontSize: 14, fontWeight: 600 };

/** Title, link and team tag. The server does every check; this only echoes errors. */
export function ShareLinkForm({ teams, defaultTeamId }: ShareLinkFormProps) {
  const [state, action, pending] = useActionState(createLinkPost, EMPTY_CREATE_POST_STATE);
  const teamValue = state.values.teamId || (defaultTeamId !== null ? String(defaultTeamId) : "");

  return (
    <form action={action} style={{ display: "grid", gap: 16 }}>
      <label style={label}>
        Title
        <input
          name="title"
          type="text"
          required
          maxLength={140}
          defaultValue={state.values.title}
          placeholder="What happened?"
          autoComplete="off"
          style={input}
        />
      </label>

      <label style={label}>
        Link
        <input
          name="url"
          type="url"
          required
          inputMode="url"
          defaultValue={state.values.url}
          placeholder="https://www.mlb.com/video/…"
          autoComplete="off"
          style={input}
        />
        <span style={{ fontSize: 13, fontWeight: 400, color: "var(--cl-text-muted)" }}>
          MLB.com pages or YouTube videos. Other links are turned away.
        </span>
      </label>

      <label style={label}>
        Team tag (optional)
        <select name="team_id" defaultValue={teamValue} style={{ ...input, appearance: "auto" }}>
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.city} {t.name} ({t.abbreviation})
            </option>
          ))}
        </select>
        <span style={{ fontSize: 13, fontWeight: 400, color: "var(--cl-text-muted)" }}>
          Tagged posts show up on that team&apos;s fans&apos; My Team tab.
        </span>
      </label>

      {state.error ? (
        <p role="alert" style={{ fontSize: 14, color: "var(--cl-text)", padding: 12, background: "var(--cl-bg-raised)", borderRadius: "var(--cl-radius-sm)" }}>
          {state.error}
        </p>
      ) : null}

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
        {pending ? "Posting…" : "Share to the feed"}
      </button>
    </form>
  );
}
