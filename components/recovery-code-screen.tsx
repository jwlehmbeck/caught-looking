"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { normalizeRecoveryCode, recoveryCodeTail } from "@/lib/auth/recovery-code";

import { fieldStyle, labelStyle, primaryButton } from "./auth-ui";

interface RecoveryCodeScreenProps {
  code: string;
  /** Where "Continue" goes once the last four characters match. */
  continueHref: string;
  continueLabel?: string;
  /** Skip the type-back check (settings, where the user is already in). */
  requireConfirm?: boolean;
}

/**
 * Shows a recovery code exactly once. The user has to type its last four
 * characters before moving on, which is the cheapest way we know to make
 * sure they actually looked at it.
 */
export function RecoveryCodeScreen({
  code,
  continueHref,
  continueLabel = "Continue",
  requireConfirm = true,
}: RecoveryCodeScreenProps) {
  const router = useRouter();
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);
  const matches = normalizeRecoveryCode(typed) === recoveryCodeTail(code);
  const canContinue = !requireConfirm || matches;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p>
        This is your <strong>recovery code</strong>. It&apos;s the only way back into your account if
        you forget your password, because we don&apos;t have your email.
      </p>
      <output
        aria-label="Your recovery code"
        style={{
          display: "block",
          background: "var(--cl-bg)",
          border: "1px dashed var(--cl-accent)",
          borderRadius: "var(--cl-radius-sm)",
          padding: "16px 12px",
          textAlign: "center",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 18,
          letterSpacing: 1,
          wordBreak: "break-all",
          userSelect: "all",
        }}
      >
        {code}
      </output>
      <p style={{ color: "var(--cl-text-muted)", fontSize: 15 }}>
        Take a screenshot or write it down somewhere safe. You won&apos;t see it again, but you can
        make a new one in settings any time.
      </p>
      <button
        type="button"
        onClick={copy}
        style={{
          minHeight: "var(--cl-tap)",
          borderRadius: "var(--cl-radius-pill)",
          border: "1px solid var(--cl-border-strong)",
          background: "transparent",
          color: "var(--cl-text)",
          fontSize: 15,
          fontWeight: 500,
        }}
      >
        {copied ? "Copied" : "Copy code"}
      </button>

      {requireConfirm ? (
        <label htmlFor={inputId} style={labelStyle}>
          <span>Type the last 4 characters to continue</span>
          <input
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value.toUpperCase().slice(0, 4))}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={4}
            aria-invalid={typed.length === 4 && !matches}
            style={{ ...fieldStyle, letterSpacing: 4, textAlign: "center", fontFamily: "ui-monospace, monospace" }}
          />
          <span style={{ fontSize: 13, fontWeight: 400, minHeight: 18 }} aria-live="polite">
            {typed.length === 4 && !matches ? "That doesn't match. Check the code above." : ""}
          </span>
        </label>
      ) : null}

      <button
        type="button"
        disabled={!canContinue}
        onClick={() => router.push(continueHref)}
        style={{ ...primaryButton, opacity: canContinue ? 1 : 0.5 }}
      >
        {continueLabel}
      </button>
    </div>
  );
}
