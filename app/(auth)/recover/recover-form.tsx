"use client";

import { useActionState } from "react";

import { Field, FormError, SubmitButton, TurnstileField, fieldStyle } from "@/components/auth-ui";
import { RecoveryCodeScreen } from "@/components/recovery-code-screen";
import { EMPTY_RECOVER_STATE, MIN_PASSWORD_LENGTH } from "@/lib/auth/flow";
import { recoverAccount } from "@/lib/auth/recover-action";

export function RecoverForm() {
  const [state, action] = useActionState(recoverAccount, EMPTY_RECOVER_STATE);

  if (state.recoveryCode) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <p style={{ color: "var(--cl-text-muted)" }}>
          Your password is changed and every other device has been signed out. Here&apos;s your
          new recovery code; the old one no longer works.
        </p>
        <RecoveryCodeScreen code={state.recoveryCode} continueHref="/" continueLabel="Continue to home" />
      </div>
    );
  }

  return (
    <form action={action} style={{ display: "grid", gap: 16 }}>
      <Field label="Username">
        <input
          name="username"
          required
          minLength={3}
          maxLength={20}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          style={fieldStyle}
        />
      </Field>
      <Field label="Recovery code" hint="20 characters in groups of four. Dashes and case don't matter.">
        <input
          name="code"
          required
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={29}
          style={{ ...fieldStyle, fontFamily: "ui-monospace, monospace", letterSpacing: 1 }}
        />
      </Field>
      <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        <input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" style={fieldStyle} />
      </Field>
      <Field label="Type it again">
        <input name="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" style={fieldStyle} />
      </Field>
      <TurnstileField />
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Checking…">Reset password</SubmitButton>
    </form>
  );
}
