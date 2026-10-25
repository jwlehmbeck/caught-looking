"use client";

import { useId, useState, useTransition } from "react";

import { ReportButton } from "@/components/report-button";
import { TimeAgo } from "@/components/feed/time-ago";
import { addComment } from "@/lib/feed/actions";
import { COMMENT_MAX_LENGTH, type PostComment } from "@/lib/feed/types";

interface CommentsProps {
  postId: number;
  initial: PostComment[];
  viewerId: string | null;
}

const tap: React.CSSProperties = {
  minHeight: "var(--cl-tap)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 14px",
  borderRadius: "var(--cl-radius-pill)",
  border: "1px solid var(--cl-border-strong)",
  background: "transparent",
  color: "var(--cl-text)",
  fontSize: 14,
  fontWeight: 600,
};

const textarea: React.CSSProperties = {
  font: "inherit",
  color: "var(--cl-text)",
  background: "var(--cl-bg)",
  border: "1px solid var(--cl-border-strong)",
  borderRadius: "var(--cl-radius-sm)",
  padding: 12,
  resize: "vertical",
  width: "100%",
  minHeight: 88,
};

function CommentForm({
  postId,
  parentId,
  onPosted,
  onCancel,
  label,
}: {
  postId: number;
  parentId: number | null;
  onPosted: (c: PostComment) => void;
  onCancel?: () => void;
  label: string;
}) {
  const id = useId();
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const length = Array.from(body).length;
  const over = length > COMMENT_MAX_LENGTH;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (body.trim().length === 0 || over) return;
    setMessage(null);
    startTransition(async () => {
      const r = await addComment(postId, body, parentId);
      if (r.ok) {
        setBody("");
        onPosted(r.comment);
        onCancel?.();
      } else {
        setMessage(r.message);
        if (r.error === "held") setBody("");
      }
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
      <label htmlFor={id} style={{ fontSize: 14, fontWeight: 600 }}>
        {label}
      </label>
      <textarea
        id={id}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={COMMENT_MAX_LENGTH + 50}
        rows={3}
        placeholder="Keep it about the game."
        aria-describedby={`${id}-count`}
        style={textarea}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span id={`${id}-count`} style={{ fontSize: 13, color: over ? "var(--cl-accent)" : "var(--cl-text-muted)" }}>
          {length}/{COMMENT_MAX_LENGTH}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {onCancel ? (
            <button type="button" onClick={onCancel} style={tap}>
              Cancel
            </button>
          ) : null}
          <button
            type="submit"
            disabled={pending || over || body.trim().length === 0}
            style={{ ...tap, background: "var(--cl-accent)", color: "var(--cl-on-accent)", border: 0, fontWeight: 700 }}
          >
            {pending ? "Posting…" : "Post"}
          </button>
        </span>
      </div>
      {message ? (
        <p role="status" style={{ fontSize: 14, color: "var(--cl-text)" }}>
          {message}
        </p>
      ) : null}
    </form>
  );
}

function CommentItem({
  comment,
  postId,
  viewerId,
  canReply,
  onPosted,
}: {
  comment: PostComment;
  postId: number;
  viewerId: string | null;
  canReply: boolean;
  onPosted: (c: PostComment) => void;
}) {
  const [replying, setReplying] = useState(false);
  const own = viewerId !== null && comment.authorId === viewerId;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <p style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>
        <span style={{ fontWeight: 700, color: "var(--cl-text)" }}>{comment.username ?? "[deleted]"}</span> ·{" "}
        <TimeAgo iso={comment.createdAt} />
        {comment.status === "hidden" ? " · being checked" : ""}
      </p>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{comment.body}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canReply && comment.status === "live" ? (
          <button type="button" onClick={() => setReplying((v) => !v)} aria-expanded={replying} style={tap}>
            {replying ? "Close" : "Reply"}
          </button>
        ) : null}
        {!own && comment.status === "live" ? <ReportButton targetType="comment" targetId={comment.id} label="Report" /> : null}
      </div>
      {replying ? (
        <CommentForm
          postId={postId}
          parentId={comment.id}
          label={`Reply to ${comment.username ?? "this comment"}`}
          onPosted={onPosted}
          onCancel={() => setReplying(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Flat comments with one level of replies and an add form with a 500
 * character counter. New comments appear in place after the action
 * returns; held ones are not shown to anyone but staff.
 */
export function Comments({ postId, initial, viewerId }: CommentsProps) {
  const [comments, setComments] = useState<PostComment[]>(initial);

  function onPosted(c: PostComment) {
    setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
  }

  const ids = new Set(comments.map((c) => c.id));
  // A reply whose parent is gone (blocked, hidden) shows at the top level.
  const topLevel = comments.filter((c) => c.parentId === null || !ids.has(c.parentId));
  const repliesOf = (id: number) => comments.filter((c) => c.parentId === id);

  return (
    <section id="comments" aria-labelledby="comments-heading" style={{ display: "grid", gap: 16 }}>
      <h2 id="comments-heading" style={{ fontSize: 22, textTransform: "uppercase" }}>
        Comments ({comments.filter((c) => c.status === "live").length})
      </h2>

      {viewerId ? <CommentForm postId={postId} parentId={null} label="Add a comment" onPosted={onPosted} /> : null}

      {topLevel.length === 0 ? (
        <p style={{ color: "var(--cl-text-muted)", fontSize: 14 }}>No comments yet. Be the first.</p>
      ) : (
        <ul style={{ listStyle: "none", display: "grid", gap: 16 }}>
          {topLevel.map((c) => (
            <li
              key={c.id}
              style={{
                background: "var(--cl-bg-card)",
                border: "1px solid var(--cl-border)",
                borderRadius: "var(--cl-radius)",
                padding: 14,
                display: "grid",
                gap: 12,
              }}
            >
              <CommentItem comment={c} postId={postId} viewerId={viewerId} canReply={viewerId !== null && c.parentId === null} onPosted={onPosted} />
              {repliesOf(c.id).length > 0 ? (
                <ul
                  aria-label={`Replies to ${c.username ?? "comment"}`}
                  style={{ listStyle: "none", display: "grid", gap: 12, paddingLeft: 14, borderLeft: "2px solid var(--cl-border-strong)" }}
                >
                  {repliesOf(c.id).map((r) => (
                    <li key={r.id}>
                      <CommentItem comment={r} postId={postId} viewerId={viewerId} canReply={false} onPosted={onPosted} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
