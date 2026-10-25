"use client";

import Script from "next/script";
import { useFormStatus } from "react-dom";

/** Shared form styles for the auth screens. Inline so each page stays self-contained. */
export const fieldStyle: React.CSSProperties = {
  font: "inherit",
  fontSize: 16,
  color: "var(--cl-text)",
  background: "var(--cl-bg)",
  border: "1px solid var(--cl-border-strong)",
  borderRadius: "var(--cl-radius-sm)",
  padding: "0 14px",
  minHeight: 48,
  width: "100%",
};

export const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 14,
  fontWeight: 500,
  color: "var(--cl-text-muted)",
};

export const primaryButton: React.CSSProperties = {
  minHeight: 48,
  width: "100%",
  border: 0,
  borderRadius: "var(--cl-radius-pill)",
  background: "var(--cl-accent)",
  color: "var(--cl-on-accent)",
  fontSize: 16,
  fontWeight: 700,
};

export const secondaryButton: React.CSSProperties = {
  ...primaryButton,
  background: "transparent",
  border: "1px solid var(--cl-border-strong)",
  color: "var(--cl-text)",
  fontWeight: 500,
};

export const dangerButton: React.CSSProperties = {
  ...secondaryButton,
  borderColor: "#e06c6c",
  color: "#ffb4b4",
};

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      {children}
      {hint ? <span style={{ fontSize: 13, fontWeight: 400 }}>{hint}</span> : null}
    </label>
  );
}

/** Red-tinted, announced to assistive tech. Renders nothing when empty. */
export function FormError({ message }: { message: string | null | undefined }) {
  return (
    <p
      role="alert"
      aria-live="polite"
      style={{
        minHeight: message ? undefined : 0,
        color: "#ffb4b4",
        fontSize: 15,
        display: message ? "block" : "none",
      }}
    >
      {message}
    </p>
  );
}

/** Notice in the accent colour, for "Your account was deleted" and the like. */
export function FormNotice({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p
      role="status"
      style={{
        background: "var(--cl-bg-raised)",
        border: "1px solid var(--cl-border)",
        borderRadius: "var(--cl-radius-sm)",
        padding: "12px 14px",
        fontSize: 15,
      }}
    >
      {message}
    </p>
  );
}

export function SubmitButton({
  children,
  pendingLabel = "One sec…",
  style,
  disabled,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} style={{ ...primaryButton, ...style, opacity: pending || disabled ? 0.7 : 1 }}>
      {pending ? pendingLabel : children}
    </button>
  );
}

/**
 * Cloudflare Turnstile. Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is
 * set; the widget adds a hidden `cf-turnstile-response` input the server
 * verifies. Without a key the server skips the check (local dev).
 */
export function TurnstileField() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="dark" data-size="flexible" />
    </>
  );
}
