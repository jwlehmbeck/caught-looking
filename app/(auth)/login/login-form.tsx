"use client";

import { useActionState } from "react";

import { Field, FormError, SubmitButton, TurnstileField, fieldStyle } from "@/components/auth-ui";
import { EMPTY_FORM_STATE } from "@/lib/auth/flow";
import { login } from "@/lib/auth/login-action";

export function LoginForm() {
  const [state, action] = useActionState(login, EMPTY_FORM_STATE);
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
      <Field label="Password">
        <input name="password" type="password" required autoComplete="current-password" style={fieldStyle} />
      </Field>
      <TurnstileField />
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Logging in…">Log in</SubmitButton>
    </form>
  );
}
