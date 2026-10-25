/**
 * Shared, side-effect-free pieces of the auth flow: the step order, the
 * synthetic email, and the action-state shapes the forms render. Safe to
 * import from client components.
 */

export const SIGNUP_STEPS = ["age", "invite", "rules", "username", "team", "password"] as const;
export type SignupStep = (typeof SIGNUP_STEPS)[number];

export function isSignupStep(value: unknown): value is SignupStep {
  return typeof value === "string" && (SIGNUP_STEPS as readonly string[]).includes(value);
}

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72; // bcrypt-safe; GoTrue accepts up to 72 bytes

/** The internal address behind every account. Never shown to anyone. */
export function syntheticEmail(userId: string): string {
  return `${userId}@users.caughtlooking.invalid`;
}

/** The generic "no" from a form step. */
export interface FormState {
  error: string | null;
}

export const EMPTY_FORM_STATE: FormState = { error: null };

/** The final signup step either errors or hands back the one-time code. */
export interface CreateAccountState extends FormState {
  recoveryCode: string | null;
  username: string | null;
}

export const EMPTY_CREATE_STATE: CreateAccountState = {
  error: null,
  recoveryCode: null,
  username: null,
};

/** Recovery either errors or hands back the fresh code. */
export interface RecoverState extends FormState {
  recoveryCode: string | null;
}

export const EMPTY_RECOVER_STATE: RecoverState = { error: null, recoveryCode: null };

/** Settings: regenerating shows the new code once; deleting redirects. */
export interface RegenerateState extends FormState {
  recoveryCode: string | null;
}

export const EMPTY_REGENERATE_STATE: RegenerateState = { error: null, recoveryCode: null };
