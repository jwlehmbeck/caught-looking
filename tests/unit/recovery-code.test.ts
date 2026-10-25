import { describe, expect, it } from "vitest";

import {
  RECOVERY_ALPHABET,
  RECOVERY_CODE_BITS,
  RECOVERY_CODE_RE,
  compareRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  isWellFormedRecoveryCode,
  normalizeRecoveryCode,
  recoveryCodeTail,
} from "@/lib/auth/recovery-code";

describe("recovery codes", () => {
  it("are 20 symbols in five groups of four", () => {
    for (let i = 0; i < 20; i += 1) {
      const code = generateRecoveryCode();
      expect(code).toMatch(RECOVERY_CODE_RE);
      expect(isWellFormedRecoveryCode(code)).toBe(true);
      expect(code).toHaveLength(24);
    }
  });

  it("never use the confusable characters 0, O, 1 or I", () => {
    expect(RECOVERY_ALPHABET).not.toMatch(/[01OI]/);
    expect(RECOVERY_ALPHABET).toHaveLength(32);
    const code = generateRecoveryCode();
    expect(code.replace(/-/g, "")).not.toMatch(/[01OI]/);
  });

  it("carry at least 80 bits of entropy", () => {
    expect(RECOVERY_CODE_BITS).toBeGreaterThanOrEqual(80);
    expect(RECOVERY_CODE_BITS).toBe(100);
  });

  it("are different every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateRecoveryCode()));
    expect(seen.size).toBe(50);
  });

  it("forgive dashes, spaces and case when typed back", () => {
    expect(normalizeRecoveryCode("abcd-efgh jklm_npqr stuv")).toBe("ABCDEFGHJKLMNPQRSTUV");
    expect(recoveryCodeTail("ABCD-EFGH-JKLM-NPQR-STUV")).toBe("STUV");
  });

  it("round-trip through bcrypt and reject a wrong code", async () => {
    const code = generateRecoveryCode();
    const hash = await hashRecoveryCode(code);
    expect(hash.startsWith("$2")).toBe(true);
    expect(hash).not.toContain(code.replace(/-/g, ""));
    await expect(compareRecoveryCode(code, hash)).resolves.toBe(true);
    await expect(compareRecoveryCode(code.toLowerCase().replace(/-/g, " "), hash)).resolves.toBe(true);

    const wrong = code.slice(0, -1) + (code.endsWith("A") ? "B" : "A");
    await expect(compareRecoveryCode(wrong, hash)).resolves.toBe(false);
    await expect(compareRecoveryCode("ABCD", hash)).resolves.toBe(false);
    await expect(compareRecoveryCode("", hash)).resolves.toBe(false);
  });
});
