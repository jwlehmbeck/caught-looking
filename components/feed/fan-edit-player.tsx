"use client";

import { useEffect, useState } from "react";

import { getPlaybackUrl, getThumbnailUrl } from "@/lib/uploads/actions";

interface FanEditPlayerProps {
  postId: number;
  thumbnailPath: string | null;
  durationLabel: string | null;
  title: string;
}

/**
 * Tap-to-play fan edit (plan U11). Shows the poster; on tap it asks the
 * server for a 60-second signed URL and renders a plain <video> with
 * controls. Never autoplays, never preloads.
 */
export function FanEditPlayer({ postId, thumbnailPath, durationLabel, title }: FanEditPlayerProps) {
  const [poster, setPoster] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!thumbnailPath) return;
    getThumbnailUrl(thumbnailPath).then((url) => {
      if (!cancelled) setPoster(url);
    });
    return () => {
      cancelled = true;
    };
  }, [thumbnailPath]);

  async function play() {
    setLoading(true);
    setError(null);
    const result = await getPlaybackUrl(postId);
    setLoading(false);
    if (result.ok) setSrc(result.url);
    else setError(result.message);
  }

  const frame: React.CSSProperties = {
    aspectRatio: "16 / 9",
    width: "100%",
    borderRadius: "var(--cl-radius-sm)",
    background: "var(--cl-bg-raised)",
    border: "1px solid var(--cl-border)",
    overflow: "hidden",
    display: "block",
  };

  if (src) {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <video src={src} controls playsInline preload="none" poster={poster ?? undefined} style={frame} aria-label={title} />
        <p style={{ fontSize: 12, color: "var(--cl-text-muted)" }}>Fan edit · link expires after a minute; tap play again if it stops.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button
        type="button"
        onClick={play}
        disabled={loading}
        aria-label={`Play fan edit: ${title}`}
        style={{ ...frame, position: "relative", padding: 0, cursor: "pointer", color: "var(--cl-text)" }}
      >
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : null}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontSize: 14,
            fontWeight: 700,
            background: poster ? "rgba(0,0,0,0.35)" : "transparent",
          }}
        >
          <span
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "var(--cl-accent)",
              color: "var(--cl-on-accent)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <span>{loading ? "Loading…" : `Tap to play${durationLabel ? ` · ${durationLabel}` : ""}`}</span>
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
