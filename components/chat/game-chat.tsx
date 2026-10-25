"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { formatLocalTime } from "@/components/local-time";
import { ReportButton } from "@/components/report-button";
import {
  getChatHistory,
  getChatWindow,
  getMyBlocks,
  sendChatMessage,
  setChatSlowMode,
  type ChatMessage,
  type ChatWindow,
} from "@/lib/chat/actions";
import {
  CHAT_MAX_CHARS,
  SLOW_MODE_CHOICES,
  appendMessage,
  bodyLength,
  bodyProblem,
  removeMessage,
  slowModeRemainingSeconds,
  visibleMessages,
} from "@/lib/chat/rules";
import { createClient } from "@/lib/supabase/client";

interface GameChatProps {
  gameId: number;
  initialWindow: ChatWindow | null;
  /** The viewer's id, so their own sends are never hidden by their block list. */
  viewerId: string;
  /** Mods and admins get the slow-mode selector. */
  isStaff?: boolean;
}

type Connection = "connecting" | "live" | "reconnecting" | "offline";

interface BroadcastMessage {
  id: number;
  game_id: number;
  author_id: string | null;
  username: string | null;
  body: string;
  created_at: string;
  status: string;
}

const card: React.CSSProperties = {
  background: "var(--cl-bg-raised)",
  border: "1px solid var(--cl-border)",
  borderRadius: "var(--cl-radius)",
  padding: 16,
  display: "grid",
  gap: 12,
};

const muted: React.CSSProperties = { fontSize: 14, color: "var(--cl-text-muted)" };

const notice: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: "var(--cl-radius-sm)",
  background: "var(--cl-bg-card)",
  border: "1px solid var(--cl-border)",
  fontSize: 15,
};

const tap: React.CSSProperties = {
  minHeight: "var(--cl-tap)",
  minWidth: "var(--cl-tap)",
  borderRadius: "var(--cl-radius-pill)",
  border: 0,
  background: "var(--cl-accent)",
  color: "var(--cl-on-accent)",
  fontWeight: 700,
  fontSize: 15,
  padding: "0 18px",
};

function toMessage(b: BroadcastMessage): ChatMessage {
  return {
    id: b.id,
    gameId: b.game_id,
    authorId: b.author_id,
    username: b.username,
    body: b.body,
    createdAt: b.created_at,
  };
}

function whenText(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/** Copy for the states in which the viewer cannot send. */
function gateCopy(w: ChatWindow): string | null {
  switch (w.reason) {
    case "pre_lock":
      return "Chat opens at first pitch.";
    case "closed":
      return "Chat closed 30 minutes after the final. You can still read it.";
    case "account_age":
      return `New accounts can chat 24 hours after signing up — unlocks at ${whenText(w.unlocksAt)}.`;
    case "muted":
      return w.sanctionEndsAt
        ? `You're muted in chat until ${whenText(w.sanctionEndsAt)}. You can still read along.`
        : "You're muted in chat. You can still read along.";
    case "suspended":
      return w.sanctionEndsAt
        ? `Your account is suspended until ${whenText(w.sanctionEndsAt)}.`
        : "Your account is suspended.";
    case "banned":
      return "Your account is banned.";
    case "no_profile":
    case "no_game":
      return "Chat isn't available right now.";
    case "ok":
      return null;
  }
}

/**
 * The room for one game. History comes from the block-filtered RPC; live
 * messages arrive on the private Realtime topic `game:{id}` (subscribe only;
 * sends go through the `sendChatMessage` server action). Presence gives the
 * "N in chat" count.
 */
export function GameChat({ gameId, initialWindow, viewerId, isStaff = false }: GameChatProps) {
  const [window_, setWindow] = useState<ChatWindow | null>(initialWindow);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [blocked, setBlocked] = useState<Set<string>>(() => new Set());
  const [connection, setConnection] = useState<Connection>("connecting");
  const [inChat, setInChat] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [slowPending, startSlow] = useTransition();
  const [slowNote, setSlowNote] = useState<string | null>(null);

  const listRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const started = window_ ? window_.open || window_.readOnly : false;
  const slowSeconds = window_?.slowModeSeconds ?? 10;
  const remaining = slowModeRemainingSeconds(lastSentAt, now, slowSeconds);
  const problem = bodyProblem(draft);
  const count = bodyLength(draft);

  // Tick once a second while a slow-mode countdown is showing.
  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [remaining]);

  // History + block list at join.
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    (async () => {
      const [history, blocks] = await Promise.all([getChatHistory(gameId), getMyBlocks()]);
      if (cancelled) return;
      setBlocked(new Set(blocks));
      setMessages((prev) => {
        const merged = [...history];
        for (const m of prev) if (!merged.some((h) => h.id === m.id)) merged.push(m);
        return merged;
      });
      setHistoryLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, started]);

  // Live subscription. Private topic; clients can only receive.
  useEffect(() => {
    if (!started) return;
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let active = true;

    (async () => {
      // Private channels need the user's JWT on the Realtime socket.
      await supabase.realtime.setAuth();
      if (!active) return;
      channel = supabase.channel(`game:${gameId}`, { config: { private: true, presence: { key: viewerId } } });
      channel
        .on("broadcast", { event: "message" }, ({ payload }) => {
          const b = payload as BroadcastMessage;
          if (!b || typeof b.id !== "number" || b.status !== "live") return;
          setMessages((prev) => appendMessage(prev, toMessage(b)));
        })
        .on("broadcast", { event: "moderation" }, ({ payload }) => {
          const p = payload as { id?: number; status?: string };
          if (typeof p?.id === "number" && p.status !== "live") {
            setMessages((prev) => removeMessage(prev, p.id as number));
          }
        })
        .on("presence", { event: "sync" }, () => {
          if (channel) setInChat(Object.keys(channel.presenceState()).length);
        })
        .subscribe(async (status) => {
          if (!active) return;
          if (status === "SUBSCRIBED") {
            setConnection("live");
            await channel?.track({ at: Date.now() });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setConnection("reconnecting");
          } else if (status === "CLOSED") {
            setConnection("offline");
          }
        });
    })();

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [gameId, started, viewerId]);

  // Re-check the window every minute so "closes 30 minutes after the final"
  // and unlocking accounts are reflected without a reload.
  useEffect(() => {
    const t = setInterval(async () => {
      const w = await getChatWindow(gameId);
      if (w) setWindow(w);
    }, 60_000);
    return () => clearInterval(t);
  }, [gameId]);

  const visible = useMemo(() => visibleMessages(messages, blocked), [messages, blocked]);

  // Auto-scroll only when the reader is already near the bottom.
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  function send() {
    if (!window_?.canSend || pending || remaining > 0 || problem) return;
    const body = draft;
    setError(null);
    startTransition(async () => {
      const r = await sendChatMessage(gameId, body);
      if (r.ok) {
        setDraft("");
        setLastSentAt(Date.now());
        setNow(Date.now());
        setMessages((prev) => appendMessage(prev, r.message));
        stickToBottom.current = true;
        inputRef.current?.focus();
      } else {
        setError(r.message);
        if (r.error === "slow_mode") {
          setLastSentAt(Date.now());
          setNow(Date.now());
        }
        // A filtered or held message keeps its draft so they can edit it.
        if (["pre_lock", "closed", "account_age", "muted", "suspended", "banned"].includes(r.error)) {
          const w = await getChatWindow(gameId);
          if (w) setWindow(w);
        }
      }
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function changeSlowMode(seconds: number) {
    startSlow(async () => {
      const r = await setChatSlowMode(gameId, seconds);
      setSlowNote(r.message);
      if (r.ok) setWindow((w) => (w ? { ...w, slowModeSeconds: seconds } : w));
    });
  }

  const gate = window_ ? gateCopy(window_) : "Chat isn't available right now.";
  const sendLabel = pending ? "Sending…" : remaining > 0 ? `Wait ${remaining}s` : "Send";

  return (
    <section id="chat" aria-labelledby="chat-heading" style={card}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h2 id="chat-heading" style={{ fontSize: 22, textTransform: "uppercase" }}>
          Live chat
        </h2>
        {started ? (
          <p style={muted} aria-live="off">
            {inChat > 0 ? `${inChat} in chat` : ""}
            {connection === "reconnecting" ? " · Reconnecting…" : connection === "offline" ? " · Disconnected" : connection === "connecting" ? " · Connecting…" : ""}
          </p>
        ) : null}
      </header>

      {started ? (
        <ol
          ref={listRef}
          onScroll={onScroll}
          aria-label="Messages"
          aria-live="polite"
          aria-relevant="additions"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gap: 10,
            maxHeight: 360,
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          {historyLoaded && visible.length === 0 ? (
            <li style={{ ...muted, padding: "12px 0" }}>Be the first to say something.</li>
          ) : null}
          {visible.map((m) => (
            <li key={m.id} style={{ display: "grid", gap: 2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {m.username ? (
                  <Link href={`/profile/${m.username}`} style={{ fontWeight: 700, fontSize: 15 }}>
                    {m.username}
                  </Link>
                ) : (
                  <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cl-text-muted)" }}>[deleted]</span>
                )}
                <time dateTime={m.createdAt} style={{ ...muted, fontSize: 12 }}>
                  {formatLocalTime(m.createdAt)}
                </time>
                {m.authorId !== viewerId ? (
                  <span style={{ marginLeft: "auto" }}>
                    <ReportButton targetType="chat_message" targetId={m.id} label="Report" />
                  </span>
                ) : null}
              </div>
              <p style={{ fontSize: 15, overflowWrap: "anywhere" }}>{m.body}</p>
            </li>
          ))}
        </ol>
      ) : null}

      {gate ? (
        <p role="status" style={notice}>
          {gate}
        </p>
      ) : null}

      {window_?.canSend ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          style={{ display: "grid", gap: 6 }}
        >
          <label htmlFor="chat-input" style={muted}>
            Message · {count}/{CHAT_MAX_CHARS}
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              id="chat-input"
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={CHAT_MAX_CHARS + 20}
              placeholder="Say something"
              aria-describedby={error ? "chat-error" : undefined}
              aria-invalid={problem === "too_long" ? true : undefined}
              style={{
                flex: 1,
                font: "inherit",
                fontSize: 16,
                color: "var(--cl-text)",
                background: "var(--cl-bg)",
                border: `1px solid ${problem === "too_long" ? "var(--cl-accent)" : "var(--cl-border-strong)"}`,
                borderRadius: "var(--cl-radius-sm)",
                padding: "11px 12px",
                minHeight: "var(--cl-tap)",
                resize: "none",
              }}
            />
            <button
              type="submit"
              disabled={pending || remaining > 0 || problem !== null}
              aria-disabled={pending || remaining > 0 || problem !== null}
              style={{ ...tap, opacity: pending || remaining > 0 || problem !== null ? 0.6 : 1 }}
            >
              {sendLabel}
            </button>
          </div>
          {problem === "too_long" ? (
            <p style={{ ...muted, color: "var(--cl-text)" }}>Keep it to {CHAT_MAX_CHARS} characters.</p>
          ) : null}
          {error ? (
            <p id="chat-error" role="alert" style={{ fontSize: 14, color: "var(--cl-text)" }}>
              {error}
            </p>
          ) : null}
          <p style={{ ...muted, fontSize: 12 }}>
            One message every {slowSeconds} seconds. No links. Be good to each other.
          </p>
        </form>
      ) : null}

      {isStaff && started ? (
        <fieldset style={{ border: 0, padding: 0, display: "grid", gap: 6 }}>
          <legend style={{ ...muted, marginBottom: 4 }}>Slow mode (mods)</legend>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Slow mode">
            {SLOW_MODE_CHOICES.map((s) => {
              const on = slowSeconds === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={slowPending}
                  aria-pressed={on}
                  onClick={() => changeSlowMode(s)}
                  style={{
                    ...tap,
                    background: on ? "var(--cl-accent)" : "transparent",
                    color: on ? "var(--cl-on-accent)" : "var(--cl-text)",
                    border: on ? 0 : "1px solid var(--cl-border-strong)",
                  }}
                >
                  {s} s
                </button>
              );
            })}
          </div>
          {slowNote ? (
            <p role="status" style={muted}>
              {slowNote}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </section>
  );
}
