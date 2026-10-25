"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Field, FormError, SubmitButton, TurnstileField, fieldStyle } from "@/components/auth-ui";
import { RecoveryCodeScreen } from "@/components/recovery-code-screen";
import { MONTHS, birthYearOptions } from "@/lib/auth/age";
import {
  EMPTY_CREATE_STATE,
  EMPTY_FORM_STATE,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth/flow";
import {
  createAccount,
  submitAge,
  submitInvite,
  submitRules,
  submitTeam,
  submitUsername,
} from "@/lib/auth/signup-action";

const formStyle: React.CSSProperties = { display: "grid", gap: 16 };

export function AgeForm({ years }: { years?: number[] }) {
  const [state, action] = useActionState(submitAge, EMPTY_FORM_STATE);
  const options = years ?? birthYearOptions();
  return (
    <form action={action} style={formStyle}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Birth month">
          <select name="month" required defaultValue="" style={fieldStyle}>
            <option value="" disabled>
              Month
            </option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Birth year">
          <select name="year" required defaultValue="" style={fieldStyle}>
            <option value="" disabled>
              Year
            </option>
            {options.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <FormError message={state.error} />
      <SubmitButton>Continue</SubmitButton>
    </form>
  );
}

export function InviteForm({ retry }: { retry?: boolean }) {
  const [state, action] = useActionState(submitInvite, EMPTY_FORM_STATE);
  return (
    <form action={action} style={formStyle}>
      <Field label="Invite code" hint="Eight characters, like ABCD-EFGH. Dashes and case don't matter.">
        <input
          name="invite"
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
          style={{ ...fieldStyle, letterSpacing: 1, textTransform: "uppercase" }}
        />
      </Field>
      <FormError message={state.error ?? (retry ? "That invite code can't be used any more. Try another." : null)} />
      <SubmitButton>Continue</SubmitButton>
    </form>
  );
}

export function RulesForm() {
  const [state, action] = useActionState(submitRules, EMPTY_FORM_STATE);
  return (
    <form action={action} style={formStyle}>
      <ul style={{ paddingLeft: 20, display: "grid", gap: 8, color: "var(--cl-text)" }}>
        <li>Be decent. Trash talk about baseball, not about people.</li>
        <li>No real names, photos of people, phone numbers, handles or locations.</li>
        <li>Picks are for bragging rights. There&apos;s no money and never will be.</li>
        <li>Fan edits are checked by a person before they go up.</li>
        <li>Report anything that feels off. Mods and admins read every report.</li>
      </ul>
      <label
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          minHeight: "var(--cl-tap)",
          fontSize: 15,
        }}
      >
        <input name="accept" type="checkbox" required style={{ width: 22, height: 22, marginTop: 2, accentColor: "var(--cl-accent)" }} />
        <span>
          I&apos;ve read the <Link href="/rules">house rules</Link> and agree to the{" "}
          <Link href="/terms">terms</Link>.
        </span>
      </label>
      <FormError message={state.error} />
      <SubmitButton>I agree</SubmitButton>
    </form>
  );
}

export function UsernameForm({ retry }: { retry?: boolean }) {
  const [state, action] = useActionState(submitUsername, EMPTY_FORM_STATE);
  return (
    <form action={action} style={formStyle}>
      <Field
        label="Username"
        hint="3 to 20 letters, numbers or underscores. Not your real name, please. Everyone will see this."
      >
        <input
          name="username"
          required
          minLength={3}
          maxLength={20}
          pattern="[A-Za-z0-9_]{3,20}"
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          style={fieldStyle}
        />
      </Field>
      <FormError message={state.error ?? (retry ? "That username isn't available any more. Pick another." : null)} />
      <SubmitButton>Continue</SubmitButton>
    </form>
  );
}

export interface TeamOption {
  id: number;
  abbreviation: string;
  name: string;
  city: string;
  color_primary: string;
  color_secondary: string;
}

export function TeamForm({ teams }: { teams: TeamOption[] }) {
  const [state, action] = useActionState(submitTeam, EMPTY_FORM_STATE);
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <form action={action} style={formStyle}>
      <fieldset style={{ border: 0, display: "grid", gap: 10 }}>
        <legend style={{ fontSize: 14, color: "var(--cl-text-muted)", marginBottom: 10 }}>
          Pick one. You can change it once a season.
        </legend>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {teams.map((t) => {
            const active = selected === t.id;
            return (
              <label
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  minHeight: 52,
                  padding: "8px 10px",
                  borderRadius: "var(--cl-radius-sm)",
                  border: `2px solid ${active ? "var(--cl-accent)" : "var(--cl-border)"}`,
                  background: active ? "var(--cl-bg-raised)" : "var(--cl-bg)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="team"
                  value={t.id}
                  required
                  checked={active}
                  onChange={() => setSelected(t.id)}
                  style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
                />
                <span
                  aria-hidden="true"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    flex: "0 0 auto",
                    background: `linear-gradient(135deg, ${t.color_primary} 50%, ${t.color_secondary} 50%)`,
                    border: "1px solid var(--cl-border-strong)",
                  }}
                />
                <span style={{ display: "grid", lineHeight: 1.15 }}>
                  <span style={{ fontFamily: "var(--cl-font-display)", fontSize: 17, letterSpacing: 0.5 }}>
                    {t.abbreviation}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--cl-text-muted)" }}>{t.name}</span>
                </span>
                {active ? <span style={{ marginLeft: "auto", color: "var(--cl-accent)", fontWeight: 700 }} aria-hidden="true">✓</span> : null}
              </label>
            );
          })}
        </div>
      </fieldset>
      <FormError message={state.error} />
      <SubmitButton disabled={selected === null}>Continue</SubmitButton>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(createAccount, EMPTY_CREATE_STATE);

  if (state.recoveryCode) {
    return <RecoveryCodeScreen code={state.recoveryCode} continueHref="/" continueLabel="Let's go" />;
  }

  return (
    <form action={action} style={formStyle}>
      <Field label="Password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        <input
          name="password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          style={fieldStyle}
        />
      </Field>
      <Field label="Type it again">
        <input name="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" style={fieldStyle} />
      </Field>
      <TurnstileField />
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Making your account…">Create account</SubmitButton>
    </form>
  );
}
