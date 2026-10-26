"use client";

import { useState } from "react";

import { getQueuePreviewUrl } from "@/lib/uploads/actions";

interface QueuePreviewProps {
  postId: number;
  thumbnailUrl: string | null;
  title: string;
}

/** Tap-to-play preview of a queued upload from a 60-second signed URL. No autoplay. */
export function QueuePreview({ postId, thumbnailUrl, title }: QueuePreviewProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const frame: React.CSSProperties = {
    aspectRatio: "16 / 9",
    width: "100%",
    maxWidth: 480,
    borderRadius: "var(--cl-radius-sm)",
    background: "var(--cl-bg-raised)",
    border: "1px solid var(--cl-border)",
    overflow: "hidden",
    display: "block",
  };

  async function play() {
    setLoading(true);
    const result = await getQueuePreviewUrl(postId);
    setLoading(false);
    if (result.ok) setSrc(result.url);
    else setError(result.message);
  }

  if (src) return <video src={src} controls playsInline preload="none" poster={thumbnailUrl ?? undefined} style={frame} aria-label={title} />;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button type="button" onClick={play} disabled={loading} aria-label={`Play upload: ${title}`} style={{ ...frame, position: "relative", padding: 0, cursor: "pointer", color: "var(--cl-text)" }}>
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : null}
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, background: thumbnailUrl ? "rgba(0,0,0,0.35)" : "transparent" }}>
          {loading ? "Loading…" : "▶ Play"}
        </span>
      </button>
      {error ? (
        <p role="alert" style={{ fontSize: 13, color: "#ffb4b4" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
