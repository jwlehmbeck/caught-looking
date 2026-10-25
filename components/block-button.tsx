"use client";

import { useState, useTransition } from "react";

import { blockUser, unblockUser } from "@/lib/safety/actions";

interface BlockButtonProps {
  userId: string;
  username: string;
  /** Whether the viewer already has this person blocked. */
  initiallyBlocked?: boolean;
}

/**
 * Block / Unblock toggle (44 px). Blocking hides the person's posts,
 * comments and chat everywhere for the viewer only.
 */
export function BlockButton({ userId, username, initiallyBlocked = false }: BlockButtonProps) {
  const [blocked, setBlocked] = useState(initiallyBlocked);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const r = blocked ? await unblockUser(userId) : await blockUser(userId);
      setMessage(r.message);
      if (r.ok) setBlocked(!blocked);
    });
  }

  return (
    <span style={{ display: "inline-grid", gap: 4 }}>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={blocked}
        aria-label={blocked ? `Unblock ${username}` : `Block ${username}`}
        style={{
          minWidth: "var(--cl-tap)",
          minHeight: "var(--cl-tap)",
          padding: "0 14px",
          borderRadius: "var(--cl-radius-pill)",
          border: "1px solid var(--cl-border-strong)",
          background: blocked ? "var(--cl-bg-raised)" : "transparent",
          color: "var(--cl-text)",
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        {pending ? "…" : blocked ? "Unblock" : "Block"}
      </button>
      {message ? (
        <span role="status" style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>
          {message}
        </span>
      ) : null}
    </span>
  );
}
