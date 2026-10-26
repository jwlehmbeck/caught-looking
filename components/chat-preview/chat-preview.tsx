import Link from "next/link";

import { LocalTime } from "@/components/local-time";

export interface ChatPreviewMessage {
  id: number;
  username: string | null;
  body: string;
}

const card: React.CSSProperties = {
  background: "var(--cl-bg-card)",
  borderRadius: "var(--cl-radius)",
  padding: "14px 16px",
  display: "grid",
  gap: 10,
};

const joinStyle: React.CSSProperties = {
  justifySelf: "start",
  minHeight: "var(--cl-tap)",
  display: "inline-flex",
  alignItems: "center",
  padding: "0 18px",
  borderRadius: "var(--cl-radius-pill)",
  background: "var(--cl-accent)",
  color: "var(--cl-on-accent)",
  fontWeight: 700,
  fontSize: 14,
};

/** The last couple of messages from one live game's chat, with a way in. */
export function LiveChatPreview({
  gameId,
  matchup,
  messages,
}: {
  gameId: number;
  /** "NYY @ LAD" */
  matchup: string;
  messages: ChatPreviewMessage[];
}) {
  return (
    <section aria-labelledby="chat-preview-heading" style={card}>
      <h2 id="chat-preview-heading" style={{ fontSize: 20 }}>
        LIVE CHAT · {matchup}
      </h2>
      {messages.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>Quiet so far. Say something.</p>
      ) : (
        <ul style={{ listStyle: "none", display: "grid", gap: 6 }} aria-label="Latest messages">
          {messages.map((m) => (
            <li key={m.id} style={{ fontSize: 14, lineHeight: 1.4, overflowWrap: "anywhere" }}>
              <span style={{ fontWeight: 700, color: "var(--cl-accent)" }}>@{m.username ?? "deleted"}</span> {m.body}
            </li>
          ))}
        </ul>
      )}
      <Link href={`/game/${gameId}#chat`} style={joinStyle}>
        Join the chat
      </Link>
    </section>
  );
}

/** Nothing live: when the next game starts, with a link to it. */
export function NextGamePreview({ gameId, matchup, startsAt }: { gameId: number; matchup: string; startsAt: string }) {
  return (
    <section aria-label="Next game" style={{ ...card, gap: 4 }}>
      <p style={{ fontSize: 15 }}>
        <strong>
          Next game <LocalTime iso={startsAt} />
        </strong>
      </p>
      <p style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>Chat opens when it locks.</p>
      <Link
        href={`/game/${gameId}`}
        style={{ minHeight: "var(--cl-tap)", display: "inline-flex", alignItems: "center", fontWeight: 700, fontSize: 14, justifySelf: "start" }}
      >
        {matchup} →
      </Link>
    </section>
  );
}
