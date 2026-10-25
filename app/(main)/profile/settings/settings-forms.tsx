"use client";

import { useActionState, useState } from "react";

import { Field, FormError, SubmitButton, dangerButton, fieldStyle, secondaryButton } from "@/components/auth-ui";
import { RecoveryCodeScreen } from "@/components/recovery-code-screen";
import { EMPTY_FORM_STATE, EMPTY_REGENERATE_STATE } from "@/lib/auth/flow";
import { logout } from "@/lib/auth/login-action";
import { deleteAccount, regenerateRecoveryCode } from "@/lib/auth/settings-actions";

const card: React.CSSProperties = {
  background: "var(--cl-bg-card)",
  border: "1px solid var(--cl-border)",
  borderRadius: "var(--cl-radius)",
  padding: "20px",
  display: "grid",
  gap: 14,
};

export function RecoveryCodeSection() {
  const [state, action] = useActionState(regenerateRecoveryCode, EMPTY_REGENERATE_STATE);
  const [armed, setArmed] = useState(false);

  return (
    <section aria-labelledby="recovery-heading" style={card}>
      <h2 id="recovery-heading" style={{ fontSize: 22 }}>
        Recovery code
      </h2>
      {state.recoveryCode ? (
        <RecoveryCodeScreen
          code={state.recoveryCode}
          continueHref="/profile/settings"
          continueLabel="Done"
          requireConfirm={false}
        />
      ) : (
        <>
          <p style={{ color: "var(--cl-text-muted)", fontSize: 15 }}>
            Your recovery code is the only way back in if you forget your password. We can&apos;t show
            the current one (we only keep a scrambled copy), but you can make a new one. The old one
            stops working the moment you do.
          </p>
          {armed ? (
            <form action={action} style={{ display: "grid", gap: 12 }}>
              <FormError message={state.error} />
              <SubmitButton pendingLabel="Making a new code…">Yes, make a new code</SubmitButton>
              <button type="button" onClick={() => setArmed(false)} style={secondaryButton}>
                Never mind
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setArmed(true)} style={secondaryButton}>
              Make a new recovery code
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function LogoutSection() {
  return (
    <form action={logout}>
      <SubmitButton style={secondaryButton} pendingLabel="Logging out…">
        Log out
      </SubmitButton>
    </form>
  );
}

export function DeleteAccountSection() {
  const [state, action] = useActionState(deleteAccount, EMPTY_FORM_STATE);
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="delete-heading" style={{ ...card, borderColor: "#5a2a2a" }}>
      <h2 id="delete-heading" style={{ fontSize: 22 }}>
        Delete account
      </h2>
      {open ? (
        <form action={action} style={{ display: "grid", gap: 12 }}>
          <p style={{ fontSize: 15 }}>
            <strong>This can&apos;t be undone.</strong> Your username is freed up after 90 days. Your
            comments and chat messages will show as &ldquo;[deleted]&rdquo;, your fan edits are removed,
            and your picks stay in the game history without your name.
          </p>
          <p style={{ fontSize: 15, color: "var(--cl-text-muted)" }}>
            If there&apos;s an open safety report about you or an active suspension or ban, your content
            is kept in an admin-only hold instead of being erased, and the ban still applies.
          </p>
          <Field label="Type DELETE to confirm">
            <input name="confirm_word" required autoComplete="off" autoCapitalize="characters" style={fieldStyle} />
          </Field>
          <FormError message={state.error} />
          <SubmitButton style={dangerButton} pendingLabel="Deleting…">
            Delete my account for good
          </SubmitButton>
          <button type="button" onClick={() => setOpen(false)} style={secondaryButton}>
            Keep my account
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} style={dangerButton}>
          Delete my account…
        </button>
      )}
    </section>
  );
}
