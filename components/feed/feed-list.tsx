"use client";

import { useState, useTransition } from "react";

import { PostCard } from "@/components/feed/post-card";
import { loadFeed } from "@/lib/feed/actions";
import type { FeedPage, FeedPost } from "@/lib/feed/types";
import type { FeedTab } from "@shared/domain/hot-score.ts";

interface FeedListProps {
  tab: FeedTab;
  /** The server-rendered first page. */
  initial: FeedPage;
  /** Shown when the first page is empty. */
  emptyMessage?: string;
}

/**
 * The paginated feed: the first page comes from the server, further pages
 * through the `loadFeed` action behind a "Load more" button. No infinite
 * scroll, nothing autoplays.
 */
export function FeedList({ tab, initial, emptyMessage = "Nothing here yet." }: FeedListProps) {
  const [posts, setPosts] = useState<FeedPost[]>(initial.posts);
  const [nextOffset, setNextOffset] = useState<number | null>(initial.nextOffset);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    if (nextOffset === null) return;
    startTransition(async () => {
      const page = await loadFeed(tab, nextOffset);
      if (page.posts.length === 0 && page.nextOffset === null && nextOffset !== null) {
        setNextOffset(null);
        return;
      }
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.posts.filter((p) => !seen.has(p.id))];
      });
      setNextOffset(page.nextOffset);
    });
  }

  if (posts.length === 0) {
    return (
      <p
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--cl-text-muted)",
          background: "var(--cl-bg-raised)",
          border: "1px solid var(--cl-border)",
          borderRadius: "var(--cl-radius)",
        }}
      >
        {emptyMessage}
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <ul style={{ listStyle: "none", display: "grid", gap: 12 }} aria-label="Posts">
        {posts.map((p) => (
          <li key={p.id}>
            <PostCard post={p} />
          </li>
        ))}
      </ul>
      {nextOffset !== null ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          style={{
            minHeight: "var(--cl-tap)",
            borderRadius: "var(--cl-radius-pill)",
            border: "1px solid var(--cl-border-strong)",
            background: "transparent",
            color: "var(--cl-text)",
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          {pending ? "Loading…" : "Load more"}
        </button>
      ) : (
        <p style={{ textAlign: "center", fontSize: 13, color: "var(--cl-text-muted)" }}>You&apos;re caught up.</p>
      )}
    </div>
  );
}
