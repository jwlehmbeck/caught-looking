/**
 * Recovery codes: the only way back into an account, since we collect no
 * email. 20 characters from a 32-letter alphabet (no 0/O/1/I) give 100 bits
 * of entropy, shown as XXXX-XXXX-XXXX-XXXX-XXXX. Only a bcrypt hash is stored.
 */
import bcrypt from "bcryptjs";

export const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_LENGTH = 20;
export const RECOVERY_GROUP = 4;
const BCRYPT_ROUNDS = 10;

/** Bits of entropy a code of this shape carries. */
export const RECOVERY_CODE_BITS = Math.log2(RECOVERY_ALPHABET.length) * RECOVERY_CODE_LENGTH;

export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(RECOVERY_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i += 1) {
    // 32 symbols divide 256 evenly, so the modulo is unbiased.
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    if ((i + 1) % RECOVERY_GROUP === 0 && i + 1 < RECOVERY_CODE_LENGTH) out += "-";
  }
  return out;
}

/** Upper-cases and strips spaces and dashes: what people type is forgiven. */
export function normalizeRecoveryCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

export const RECOVERY_CODE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

export function isWellFormedRecoveryCode(code: string): boolean {
  return RECOVERY_CODE_RE.test(code) && [...code.replace(/-/g, "")].every((c) => RECOVERY_ALPHABET.includes(c));
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(normalizeRecoveryCode(code), BCRYPT_ROUNDS);
}

export async function compareRecoveryCode(typed: string, hash: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(typed);
  if (normalized.length !== RECOVERY_CODE_LENGTH) {
    // Still do the work so a short guess takes as long as a long one.
    await bcrypt.compare("x".repeat(RECOVERY_CODE_LENGTH), hash);
    return false;
  }
  return bcrypt.compare(normalized, hash);
}

/** The last four symbols, which the signup screen asks the user to type back. */
export function recoveryCodeTail(code: string): string {
  return normalizeRecoveryCode(code).slice(-4);
}

let dummy: string | null = null;
/**
 * A real hash of nothing in particular, compared against when a username
 * does not exist so response time does not reveal which names are real.
 */
export function dummyRecoveryHash(): string {
  if (dummy === null) dummy = bcrypt.hashSync("not-a-real-code", BCRYPT_ROUNDS);
  return dummy;
}
