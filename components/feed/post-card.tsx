import Link from "next/link";

import { ReportButton } from "@/components/report-button";
import { FanEditPlayer } from "@/components/feed/fan-edit-player";
import { TimeAgo } from "@/components/feed/time-ago";
import { VoteButton } from "@/components/feed/vote-button";
import type { FeedPost } from "@/lib/feed/types";
import { linkDestination } from "@shared/domain/links.ts";

const KIND_LABEL: Record<FeedPost["kind"], string> = {
  mlb_clip: "MLB CLIP",
  fan_edit: "FAN EDIT",
  news: "NEWS",
};

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const card: React.CSSProperties = {
  background: "var(--cl-bg-card)",
  border: "1px solid var(--cl-border)",
  borderRadius: "var(--cl-radius)",
  padding: 16,
  display: "grid",
  gap: 12,
};

interface PostCardProps {
  post: FeedPost;
  /** On the detail page the title is not a link to itself. */
  detail?: boolean;
}

/**
 * One feed post: kind badge, title, byline, the outbound link (MLB.com or
 * YouTube, opens in a new tab, nothing plays here), vote button, comment
 * count and the report flag. Fan edits render the tap-to-play player
 * (U11): a poster, a signed URL on tap, never autoplay.
 */
export function PostCard({ post, detail = false }: PostCardProps) {
  const destination = linkDestination(post.url);
  const duration = formatDuration(post.durationSeconds);
  const byline = [post.authorUsername ?? (post.kind === "news" ? "News" : "MLB"), post.teamAbbreviation].filter(Boolean).join(" · ");
  const titleId = `post-${post.id}-title`;

  return (
    <article aria-labelledby={titleId} style={card}>
      <header style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "var(--cl-font-display)",
              fontSize: 12,
              letterSpacing: 1,
              padding: "3px 8px",
              borderRadius: 6,
              background: "var(--cl-bg-raised)",
              border: "1px solid var(--cl-border-strong)",
              color: "var(--cl-accent)",
            }}
          >
            {KIND_LABEL[post.kind]}
          </span>
          {post.teamName ? (
            <span style={{ fontSize: 12, color: "var(--cl-text-muted)" }} aria-label={`Team: ${post.teamName}`}>
              {post.teamName}
            </span>
          ) : null}
        </div>
        <h2 id={titleId} style={{ fontSize: 22, fontFamily: "var(--cl-font-body)", fontWeight: 700, lineHeight: 1.25 }}>
          {detail ? (
            post.title
          ) : (
            <Link href={`/post/${post.id}`} style={{ color: "var(--cl-text)" }}>
              {post.title}
            </Link>
          )}
        </h2>
        <p style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>
          {byline} · <TimeAgo iso={post.publishedAt} />
        </p>
      </header>

      {post.url && destination ? (
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--cl-text)",
            background: "var(--cl-bg-raised)",
            border: "1px solid var(--cl-border)",
            borderRadius: "var(--cl-radius-sm)",
            padding: 12,
            display: "flex",
            alignItems: "center",
            gap: 12,
            minHeight: "var(--cl-tap)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 64,
              height: 40,
              borderRadius: 8,
              background: "var(--cl-border-strong)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--cl-accent)",
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <span style={{ display: "grid", gap: 2, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{post.kind === "news" ? "Read the story" : "Watch the clip"}</span>
            <span style={{ fontSize: 12, color: "var(--cl-text-muted)" }}>
              Opens on {destination}
              {duration ? ` · ${duration}` : ""}
            </span>
          </span>
        </a>
      ) : post.kind === "fan_edit" ? (
        <FanEditPlayer postId={post.id} thumbnailPath={post.thumbnailPath} durationLabel={duration} title={post.title} />
      ) : null}

      <footer style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <VoteButton postId={post.id} voteScore={post.voteScore} voted={post.viewerVoted} />
        <Link
          href={`/post/${post.id}#comments`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            minHeight: "var(--cl-tap)",
            padding: "0 12px",
            borderRadius: "var(--cl-radius-pill)",
            border: "1px solid var(--cl-border-strong)",
            color: "var(--cl-text)",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <span aria-hidden="true">💬</span>
          <span>
            {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
          </span>
        </Link>
        <span style={{ marginLeft: "auto" }}>
          <ReportButton targetType="post" targetId={post.id} label="Report" />
        </span>
      </footer>
    </article>
  );
}
