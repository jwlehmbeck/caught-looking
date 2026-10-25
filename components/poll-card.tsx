"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { ReportButton } from "@/components/report-button";
import { closePoll, hidePoll, votePoll } from "@/lib/polls/actions";
import { closesInLabel, isClosed, percentages, type PollTeam, type PollView } from "@/lib/polls/rules";

interface PollCardProps {
  poll: PollView;
  /** Mods and admins see Close / Hide. */
  staff?: boolean;
  /** Link the question to the poll page (feed, game page). */
  linkToPoll?: boolean;
}

const tap: React.CSSProperties = {
  minHeight: "var(--cl-tap)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "0 14px",
  borderRadius: "var(--cl-radius-pill)",
  border: "1px solid var(--cl-border-strong)",
  background: "transparent",
  color: "var(--cl-text)",
  font: "inherit",
  fontSize: 15,
  fontWeight: 500,
  cursor: "pointer",
};

/** A team tag: abbreviation text plus a color swatch (never color alone). */
function TeamChip({ team }: { team: PollTeam }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 10px 2px 6px",
        borderRadius: "var(--cl-radius-pill)",
        border: "1px solid var(--cl-border-strong)",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.5,
      }}
    >
      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, background: team.color }} />
      <span>{team.abbreviation}</span>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{team.name}</span>
    </span>
  );
}

/**
 * One poll. Before voting the options are 44 px buttons; after voting (or
 * once the poll closes) they become labelled percentage bars with the
 * viewer's pick marked. Results come back from the vote RPC itself, so a
 * vote never needs a refresh.
 */
export function PollCard({ poll: initial, staff = false, linkToPoll = false }: PollCardProps) {
  const [poll, setPoll] = useState<PollView>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const closed = isClosed({ status: poll.status, closesAt: poll.closes_at });
  const showResults = poll.results_visible || closed;
  const counts = poll.options.map((o) => o.count ?? 0);
  const pcts = percentages(counts);
  const total = poll.total ?? counts.reduce((a, b) => a + b, 0);
  const headingId = `poll-${poll.id}-q`;

  function vote(optionId: number) {
    if (pending || closed || poll.my_option_id !== null) return;
    setMessage(null);
    startTransition(async () => {
      const r = await votePoll(poll.id, optionId);
      if (r.ok) setPoll(r.poll);
      else setMessage(r.message);
    });
  }

  function staffAction(kind: "close" | "hide") {
    setMessage(null);
    startTransition(async () => {
      const r = kind === "close" ? await closePoll(poll.id) : await hidePoll(poll.id);
      setMessage(r.message);
      if (r.ok) {
        setPoll((p) => ({
          ...p,
          status: kind === "close" ? "closed" : "hidden",
          closes_at: kind === "close" ? new Date().toISOString() : p.closes_at,
          results_visible: true,
        }));
      }
    });
  }

  return (
    <article
      aria-labelledby={headingId}
      data-testid="poll-card"
      style={{
        background: "var(--cl-bg-card)",
        border: "1px solid var(--cl-border)",
        borderRadius: "var(--cl-radius)",
        padding: 16,
        display: "grid",
        gap: 12,
      }}
    >
      <header style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: "var(--cl-text-muted)" }}>
          <span style={{ textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>Rivalry poll</span>
          <span>{closesInLabel({ status: poll.status, closesAt: poll.closes_at })}</span>
        </div>
        <h2 id={headingId} style={{ fontSize: 20, lineHeight: 1.25 }}>
          {linkToPoll ? (
            <Link href={`/polls/${poll.id}`} style={{ color: "inherit" }}>
              {poll.question}
            </Link>
          ) : (
            poll.question
          )}
        </h2>
        {poll.team_a || poll.team_b ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {poll.team_a ? <TeamChip team={poll.team_a} /> : null}
            {poll.team_a && poll.team_b ? <span style={{ fontSize: 12, color: "var(--cl-text-muted)", alignSelf: "center" }}>vs</span> : null}
            {poll.team_b ? <TeamChip team={poll.team_b} /> : null}
          </div>
        ) : null}
      </header>

      {showResults ? (
        <ol aria-label="Results" style={{ listStyle: "none", display: "grid", gap: 8 }}>
          {poll.options.map((o, i) => {
            const mine = o.id === poll.my_option_id;
            return (
              <li key={o.id} style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 15 }}>
                  <span style={{ fontWeight: mine ? 700 : 500 }}>
                    {o.label}
                    {mine ? <span style={{ color: "var(--cl-accent)" }}> · your pick</span> : null}
                  </span>
                  <span style={{ fontFamily: "var(--cl-font-display)", fontSize: 18 }} aria-label={`${pcts[i]} percent`}>
                    {pcts[i]}%
                  </span>
                </div>
                <div
                  role="img"
                  aria-label={`${o.label}: ${pcts[i]}% (${o.count ?? 0} ${o.count === 1 ? "vote" : "votes"})`}
                  style={{ height: 10, borderRadius: 5, background: "var(--cl-border-strong)", overflow: "hidden" }}
                >
                  <div style={{ width: `${pcts[i]}%`, height: "100%", background: mine ? "var(--cl-accent)" : "var(--cl-text-muted)" }} />
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div role="group" aria-labelledby={headingId} style={{ display: "grid", gap: 8 }}>
          {poll.options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => vote(o.id)}
              disabled={pending}
              aria-pressed={false}
              style={{ ...tap, justifyContent: "flex-start", width: "100%", textAlign: "left" }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>
          {showResults ? `${total.toLocaleString("en-US")} ${total === 1 ? "vote" : "votes"}` : "Vote to see results"}
        </span>
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {staff && poll.status === "open" && !closed ? (
            <button type="button" onClick={() => staffAction("close")} disabled={pending} style={tap}>
              Close
            </button>
          ) : null}
          {staff && poll.status !== "hidden" ? (
            <button type="button" onClick={() => staffAction("hide")} disabled={pending} style={tap}>
              Hide
            </button>
          ) : null}
          <ReportButton targetType="poll" targetId={poll.id} label="Report" />
        </span>
      </footer>

      {message ? (
        <p role="status" style={{ fontSize: 14, color: "var(--cl-text)" }}>
          {message}
        </p>
      ) : null}
    </article>
  );
}
