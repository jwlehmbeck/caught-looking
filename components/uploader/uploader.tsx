"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";

import { MAX_DURATION_SECONDS, PENDING_COPY, THUMBNAIL_MAX_BYTES, TUS_CHUNK_BYTES, UPLOADS_PER_DAY, validateUploadMeta } from "@shared/scan/upload-rules.ts";

import { createClient } from "@/lib/supabase/client";
import { beginUpload, finishUpload } from "@/lib/uploads/actions";

export interface UploaderTeam {
  id: number;
  abbreviation: string;
  name: string;
  city: string;
}

export interface UploaderGame {
  id: number;
  label: string;
}

interface UploaderProps {
  teams: UploaderTeam[];
  games: UploaderGame[];
  defaultTeamId: number | null;
}

type Phase =
  | { kind: "picking" }
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "uploading"; percent: number; paused: boolean; error: string | null }
  | { kind: "finishing" }
  | { kind: "done"; postId: number }
  | { kind: "error"; message: string };

interface Picked {
  file: File;
  durationSeconds: number;
  thumbnail: string | null;
  previewUrl: string;
}

const input: React.CSSProperties = {
  font: "inherit",
  color: "var(--cl-text)",
  background: "var(--cl-bg)",
  border: "1px solid var(--cl-border-strong)",
  borderRadius: "var(--cl-radius-sm)",
  padding: "0 12px",
  minHeight: "var(--cl-tap)",
  width: "100%",
};
const label: React.CSSProperties = { display: "grid", gap: 6, fontSize: 14, fontWeight: 600 };
const btn: React.CSSProperties = {
  minHeight: "var(--cl-tap)",
  padding: "0 16px",
  borderRadius: "var(--cl-radius-pill)",
  border: "1px solid var(--cl-border-strong)",
  background: "transparent",
  color: "var(--cl-text)",
  font: "inherit",
  fontSize: 15,
  fontWeight: 600,
};
const btnPrimary: React.CSSProperties = { ...btn, border: 0, background: "var(--cl-accent)", color: "var(--cl-on-accent)", fontWeight: 700 };

function formatSeconds(s: number): string {
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Reads the clip's length and grabs a frame at about one second in. Never throws. */
function inspectVideo(file: File): Promise<{ durationSeconds: number; thumbnail: string | null; previewUrl: string }> {
  const previewUrl = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const finish = (durationSeconds: number, thumbnail: string | null) => {
      if (settled) return;
      settled = true;
      video.removeAttribute("src");
      video.load();
      resolve({ durationSeconds, thumbnail, previewUrl });
    };
    const timer = window.setTimeout(() => finish(Number.NaN, null), 15_000);
    video.onerror = () => {
      window.clearTimeout(timer);
      finish(Number.NaN, null);
    };
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : Number.NaN;
      if (!Number.isFinite(duration) || duration > MAX_DURATION_SECONDS + 1) {
        window.clearTimeout(timer);
        finish(duration, null);
        return;
      }
      video.currentTime = Math.min(1, Math.max(0, duration / 2));
      video.onseeked = () => {
        window.clearTimeout(timer);
        try {
          const scale = Math.min(1, 480 / Math.max(1, video.videoWidth));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) return finish(duration, null);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          let quality = 0.72;
          let dataUrl = canvas.toDataURL("image/jpeg", quality);
          while (dataUrl.length * 0.75 > THUMBNAIL_MAX_BYTES && quality > 0.3) {
            quality -= 0.12;
            dataUrl = canvas.toDataURL("image/jpeg", quality);
          }
          finish(duration, dataUrl.length * 0.75 <= THUMBNAIL_MAX_BYTES ? dataUrl : null);
        } catch {
          finish(duration, null);
        }
      };
    };
    video.src = previewUrl;
  });
}

/**
 * The fan edit uploader. Checks length, size and type on the phone, grabs a
 * thumbnail, uploads straight to storage with TUS (6 MB chunks, resumable),
 * then registers the post. Nothing autoplays; the preview is a poster.
 */
export function Uploader({ teams, games, defaultTeamId }: UploaderProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "picking" });
  const [picked, setPicked] = useState<Picked | null>(null);
  const [title, setTitle] = useState("");
  const [teamId, setTeamId] = useState<string>(defaultTeamId !== null ? String(defaultTeamId) : "");
  const [gameId, setGameId] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const uploadRef = useRef<tus.Upload | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (picked) URL.revokeObjectURL(picked.previewUrl);
    };
  }, [picked]);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage(null);
    setPhase({ kind: "checking" });
    const info = await inspectVideo(file);
    const check = validateUploadMeta({ durationSeconds: info.durationSeconds, sizeBytes: file.size, mime: file.type });
    if (!check.ok) {
      URL.revokeObjectURL(info.previewUrl);
      setPicked(null);
      setPhase({ kind: "picking" });
      setMessage(check.message);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setPicked({ file, durationSeconds: info.durationSeconds, thumbnail: info.thumbnail, previewUrl: info.previewUrl });
    setPhase({ kind: "ready" });
  }

  function reset() {
    uploadRef.current?.abort(true).catch(() => null);
    uploadRef.current = null;
    if (picked) URL.revokeObjectURL(picked.previewUrl);
    setPicked(null);
    setPhase({ kind: "picking" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!picked) return;
    setMessage(null);
    const team = teamId === "" ? null : Number.parseInt(teamId, 10);
    const game = gameId === "" ? null : Number.parseInt(gameId, 10);

    const begun = await beginUpload({
      title,
      teamId: team,
      gameId: game,
      durationSeconds: picked.durationSeconds,
      sizeBytes: picked.file.size,
      mime: picked.file.type,
    });
    if (!begun.ok) {
      setMessage(begun.message);
      return;
    }

    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setMessage("Sign in again to upload.");
      return;
    }

    setPhase({ kind: "uploading", percent: 0, paused: false, error: null });
    const upload = new tus.Upload(picked.file, {
      endpoint: begun.endpoint,
      retryDelays: [0, 2000, 5000, 10000],
      chunkSize: TUS_CHUNK_BYTES,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${token}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
        "x-upsert": "false",
      },
      metadata: {
        bucketName: "uploads",
        objectName: begun.objectName,
        contentType: begun.contentType,
        cacheControl: "3600",
      },
      onError: (err) => {
        const status = (err as { originalResponse?: { getStatus(): number } }).originalResponse?.getStatus?.();
        const text =
          status === 403
            ? `That upload wasn't allowed. You may have hit ${UPLOADS_PER_DAY} uploads for today.`
            : "The connection dropped. Resume when you're back online.";
        setPhase((p) => (p.kind === "uploading" ? { ...p, paused: true, error: text } : p));
      },
      onProgress: (sent, total) => {
        const percent = total > 0 ? Math.min(99, Math.floor((sent / total) * 100)) : 0;
        setPhase((p) => (p.kind === "uploading" ? { ...p, percent, error: null } : p));
      },
      onSuccess: async () => {
        setPhase({ kind: "finishing" });
        const done = await finishUpload({
          objectName: begun.objectName,
          title,
          teamId: team,
          gameId: game,
          durationSeconds: picked.durationSeconds,
          thumbnailDataUrl: picked.thumbnail,
        });
        if (done.ok) setPhase({ kind: "done", postId: done.postId });
        else setPhase({ kind: "error", message: done.message });
      },
    });
    uploadRef.current = upload;
    upload.start();
  }

  function pause() {
    uploadRef.current?.abort().catch(() => null);
    setPhase((p) => (p.kind === "uploading" ? { ...p, paused: true } : p));
  }

  function resume() {
    uploadRef.current?.start();
    setPhase((p) => (p.kind === "uploading" ? { ...p, paused: false, error: null } : p));
  }

  if (phase.kind === "done") {
    return (
      <section aria-live="polite" style={{ display: "grid", gap: 12, padding: 20, background: "var(--cl-bg-card)", border: "1px solid var(--cl-border)", borderRadius: "var(--cl-radius)" }}>
        <h2 style={{ fontSize: 24 }}>Got it.</h2>
        <p data-testid="upload-pending">{PENDING_COPY}</p>
        <p style={{ color: "var(--cl-text-muted)", fontSize: 14 }}>
          An adult on the team checks every fan edit before it shows up. You&apos;ll see it under My uploads either way, with a reason if it doesn&apos;t make it.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/profile/uploads" style={{ ...btnPrimary, display: "inline-flex", alignItems: "center" }}>
            My uploads
          </Link>
          <button type="button" onClick={reset} style={btn}>
            Upload another
          </button>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={start} style={{ display: "grid", gap: 16 }} aria-busy={phase.kind === "checking" || phase.kind === "finishing"}>
      <label style={label}>
        Your clip
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,.mp4,.mov"
          onChange={onPick}
          disabled={phase.kind !== "picking" && phase.kind !== "ready" && phase.kind !== "error"}
          style={{ ...input, padding: 10 }}
          data-testid="upload-file"
        />
        <span style={{ fontSize: 13, fontWeight: 400, color: "var(--cl-text-muted)" }}>
          MP4 or MOV, {MAX_DURATION_SECONDS} seconds or less, up to 150 MB. {UPLOADS_PER_DAY} a day.
        </span>
      </label>

      {phase.kind === "checking" ? <p style={{ color: "var(--cl-text-muted)" }}>Checking the clip…</p> : null}

      {picked ? (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {picked.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picked.thumbnail} alt="" width={96} height={54} style={{ borderRadius: 8, objectFit: "cover", background: "var(--cl-bg-raised)" }} />
          ) : (
            <span aria-hidden="true" style={{ width: 96, height: 54, borderRadius: 8, background: "var(--cl-bg-raised)", display: "block" }} />
          )}
          <span style={{ fontSize: 14 }}>
            <strong>{picked.file.name}</strong>
            <br />
            <span style={{ color: "var(--cl-text-muted)" }} data-testid="upload-duration">
              {formatSeconds(picked.durationSeconds)} · {(picked.file.size / (1024 * 1024)).toFixed(1)} MB
            </span>
          </span>
        </div>
      ) : null}

      <label style={label}>
        Title
        <input name="title" type="text" required maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's in the edit?" autoComplete="off" style={input} disabled={phase.kind === "uploading" || phase.kind === "finishing"} />
      </label>

      <label style={label}>
        Team tag (optional)
        <select name="team_id" value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ ...input, appearance: "auto" }} disabled={phase.kind === "uploading" || phase.kind === "finishing"}>
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.city} {t.name} ({t.abbreviation})
            </option>
          ))}
        </select>
      </label>

      {games.length > 0 ? (
        <label style={label}>
          Game (optional)
          <select name="game_id" value={gameId} onChange={(e) => setGameId(e.target.value)} style={{ ...input, appearance: "auto" }} disabled={phase.kind === "uploading" || phase.kind === "finishing"}>
            <option value="">No game</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {phase.kind === "uploading" ? (
        <div style={{ display: "grid", gap: 8 }} aria-live="polite">
          <progress value={phase.percent} max={100} style={{ width: "100%", height: 12 }} aria-label="Upload progress" />
          <p style={{ fontSize: 14 }} data-testid="upload-progress">
            {phase.paused ? "Paused" : "Uploading"} {phase.percent}%
          </p>
          {phase.error ? (
            <p role="alert" style={{ fontSize: 14, color: "#ffb4b4" }}>
              {phase.error}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {phase.paused ? (
              <button type="button" onClick={resume} style={btnPrimary}>
                Resume
              </button>
            ) : (
              <button type="button" onClick={pause} style={btn}>
                Pause
              </button>
            )}
            <button type="button" onClick={reset} style={btn}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {phase.kind === "finishing" ? <p style={{ color: "var(--cl-text-muted)" }}>Finishing up…</p> : null}

      {message ? (
        <p role="alert" style={{ fontSize: 14, color: "#ffb4b4" }} data-testid="upload-message">
          {message}
        </p>
      ) : null}
      {phase.kind === "error" ? (
        <p role="alert" style={{ fontSize: 14, color: "#ffb4b4" }}>
          {phase.message}
        </p>
      ) : null}

      {phase.kind === "ready" || phase.kind === "error" ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="submit" style={btnPrimary} disabled={!picked || title.trim().length === 0}>
            Upload for review
          </button>
          <button type="button" onClick={reset} style={btn}>
            Pick another
          </button>
        </div>
      ) : null}
    </form>
  );
}
