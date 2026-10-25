"use client";

import { useState, useTransition } from "react";

import { toggleVote } from "@/lib/feed/actions";

interface VoteButtonProps {
  postId: number;
  voteScore: number;
  voted: boolean;
}

/**
 * The up-vote. Optimistic: flips at once, then settles on what the database
 * says. `aria-pressed` carries the state for screen readers; the fill
 * change is backed by the label, never color alone.
 */
export function VoteButton({ postId, voteScore, voted }: VoteButtonProps) {
  const [state, setState] = useState({ voteScore, voted });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function tap() {
    const previous = state;
    setMessage(null);
    setState({ voted: !previous.voted, voteScore: previous.voteScore + (previous.voted ? -1 : 1) });
    startTransition(async () => {
      const r = await toggleVote(postId);
      if (r.ok) setState({ voteScore: r.voteScore, voted: r.voted });
      else {
        setState(previous);
        setMessage(r.message);
      }
    });
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <button
        type="button"
        onClick={tap}
        disabled={pending}
        aria-pressed={state.voted}
        aria-label={`${state.voted ? "Remove your vote" : "Vote up"} (${state.voteScore} ${state.voteScore === 1 ? "vote" : "votes"})`}
        style={{
          minWidth: "var(--cl-tap)",
          minHeight: "var(--cl-tap)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "0 14px",
          borderRadius: "var(--cl-radius-pill)",
          border: state.voted ? "0" : "1px solid var(--cl-border-strong)",
          background: state.voted ? "var(--cl-accent)" : "transparent",
          color: state.voted ? "var(--cl-on-accent)" : "var(--cl-text)",
          fontWeight: 700,
          fontSize: 15,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 4l8 9h-5v7H9v-7H4z" />
        </svg>
        <span>{state.voteScore}</span>
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          {state.voted ? "voted" : "votes"}
        </span>
      </button>
      {message ? (
        <span role="status" style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>
          {message}
        </span>
      ) : null}
    </span>
  );
}
