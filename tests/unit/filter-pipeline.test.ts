import { describe, expect, it } from "vitest";

import { findContactInfo } from "@shared/filters/contact.ts";
import { type ModerationResult } from "@shared/filters/moderation.ts";
import { normalizeText } from "@shared/filters/normalize.ts";
import { filterText, findBadWord } from "@shared/filters/pipeline.ts";
import { checkUrl } from "@shared/filters/url.ts";
import { validateUsername } from "@shared/filters/username.ts";

const ok = (): Promise<ModerationResult> => Promise.resolve({ flagged: false, categories: [] });
const timeout = (): Promise<ModerationResult> => Promise.resolve({ error: "timeout" });
const flagged = (): Promise<ModerationResult> =>
  Promise.resolve({ flagged: true, categories: ["harassment"] });

describe("normalizeText", () => {
  it("folds case, leetspeak and lookalikes", () => {
    expect(normalizeText("Sh!7").compact).toBe("shit");
    expect(normalizeText("аdm1n").compact).toBe("admin"); // Cyrillic а
    expect(normalizeText("fuuuuuck").compact).toBe("fuuck");
    expect(normalizeText("fuuuuuck").squeezed).toBe("fuck");
  });

  it("tokenizes on punctuation and keeps a compact form", () => {
    const n = normalizeText("s n a p: jake_22");
    expect(n.tokens).toEqual(["s", "n", "a", "p", "jake", "22"]);
    expect(n.compact).toBe("snapjake22");
  });
});

describe("bad words", () => {
  it("allows ordinary baseball talk", async () => {
    const r = await filterText("that changeup was filthy", { context: "chat", moderate: ok });
    expect(r.verdict).toBe("allow");
  });

  it("rejects a slur spelled with lookalike characters", async () => {
    // Cyrillic е, т and а in place of Latin e, t and a
    const r = await filterText("you r\u0435\u0442\u0430rd", { context: "chat", moderate: ok });
    expect(r.verdict).toBe("reject");
    expect(r.reason).toBe("profanity");
    expect(r.userMessage).toBe("That message can't be posted.");
    expect(findBadWord("f\u0430gg\u043et")).toBe("faggot");
    expect(findBadWord("n1gg3r")).toBe("nigger");
  });

  it("catches spaced-out and stretched spellings", () => {
    expect(findBadWord("s h i t")).toBe("shit");
    expect(findBadWord("shiiiiit")).toBe("shit");
    expect(findBadWord("bullshit")).toBe("shit");
  });

  it("leaves allow-listed words alone", async () => {
    for (const text of [
      "great assist from the cutoff man",
      "that class of pitcher is rare",
      "bass fishing after the game",
      "shiitake on the ballpark pizza",
      "scunthorpe united",
      "he is hitting well this hit was huge",
      "a classic peacock strut around the bases",
    ]) {
      const r = await filterText(text, { context: "comment", moderate: ok });
      expect(r.verdict, text).toBe("allow");
    }
  });
});

describe("contact info", () => {
  it("catches a spaced-out snapchat handle", () => {
    const kinds = findContactInfo("s n a p: jake_22").map((m) => m.kind);
    expect(kinds).toContain("social");
  });

  it("catches a spelled-out phone number", () => {
    const m = findContactInfo("three one zero five five five one two one two");
    expect(m.some((x) => x.kind === "phone")).toBe(true);
  });

  it("catches digit phone numbers, handles, emails and social words", () => {
    expect(findContactInfo("call me at 310-555-1212").some((m) => m.kind === "phone")).toBe(true);
    expect(findContactInfo("(310) 555 1212").some((m) => m.kind === "phone")).toBe(true);
    expect(findContactInfo("hit me up @jake_22").some((m) => m.kind === "handle")).toBe(true);
    expect(findContactInfo("jake@example.com").some((m) => m.kind === "email")).toBe(true);
    expect(findContactInfo("add me on discord").some((m) => m.kind === "social")).toBe(true);
    expect(findContactInfo("my ig is jake").some((m) => m.kind === "social")).toBe(true);
    expect(findContactInfo("dm me").some((m) => m.kind === "social")).toBe(true);
  });

  it("does not treat scores or years as phone numbers", () => {
    expect(findContactInfo("he went 3 for 4 with 2 rbi, 7-3 final")).toEqual([]);
    expect(findContactInfo("2021 2022 2023 champs")).toEqual([]);
  });

  it("rejects contact info in chat with a neutral message", async () => {
    const r = await filterText("s n a p: jake_22", { context: "chat", moderate: ok });
    expect(r.verdict).toBe("reject");
    expect(r.reason).toBe("contact_info");
    expect(r.userMessage).toBe("That message can't be posted.");
  });
});

describe("URL allow-list", () => {
  const allowed = ["mlb.com"];

  it("fails lookalike and userinfo hosts", () => {
    expect(checkUrl("https://mlb.com.evil.example/", allowed).ok).toBe(false);
    expect(checkUrl("https://user@mlb.com.evil.example/", allowed).ok).toBe(false);
    expect(checkUrl("https://user@mlb.com/", allowed).ok).toBe(false);
    expect(checkUrl("http://www.mlb.com/video/x", allowed).ok).toBe(false);
    expect(checkUrl("https://www.mlb.com:8443/video/x", allowed).ok).toBe(false);
    expect(checkUrl("https://evilmlb.com/", allowed).ok).toBe(false);
    expect(checkUrl("not a url", allowed).ok).toBe(false);
  });

  it("passes an exact or subdomain match over https", () => {
    expect(checkUrl("https://www.mlb.com/video/x", allowed).ok).toBe(true);
    expect(checkUrl("https://mlb.com/", allowed).ok).toBe(true);
    expect(checkUrl("https://MLB.com/video", allowed).ok).toBe(true);
  });

  it("rejects known redirect paths", () => {
    expect(checkUrl("https://www.youtube.com/redirect?q=https://evil.example", ["youtube.com"]).ok).toBe(false);
    expect(checkUrl("https://www.google.com/url?q=https://evil.example", ["google.com"]).ok).toBe(false);
  });

  it("applies the rule inside the pipeline", async () => {
    const bad = await filterText("look https://mlb.com.evil.example/x", {
      context: "title",
      allowUrls: allowed,
      moderate: ok,
    });
    expect(bad.verdict).toBe("reject");
    expect(bad.reason).toBe("url");

    const good = await filterText("Catch of the year https://www.mlb.com/video/x", {
      context: "title",
      allowUrls: allowed,
      moderate: ok,
    });
    expect(good.verdict).toBe("allow");
    expect(good.urls).toEqual(["https://www.mlb.com/video/x"]);

    const noLinks = await filterText("see www.mlb.com/video/x", { context: "chat", moderate: ok });
    expect(noLinks.verdict).toBe("reject");
    expect(noLinks.reason).toBe("url");
  });
});

describe("moderation and fail-closed", () => {
  it("flags chat when the moderation call times out", async () => {
    const r = await filterText("nice play", { context: "chat", moderate: timeout });
    expect(r.verdict).toBe("flag");
    expect(r.reason).toBe("moderation");
  });

  it("rejects a username when the moderation call times out", async () => {
    const r = await filterText("slidestep", { context: "username", moderate: timeout });
    expect(r.verdict).toBe("reject");
    expect(r.userMessage).toBe("That username isn't available.");
  });

  it("rejects text the API flags and reports the categories", async () => {
    const r = await filterText("nice play", { context: "comment", moderate: flagged });
    expect(r.verdict).toBe("reject");
    expect(r.categories).toEqual(["harassment"]);
  });

  it("rejects over-long text before anything else", async () => {
    const r = await filterText("x".repeat(201), { context: "chat", moderate: ok });
    expect(r.verdict).toBe("reject");
    expect(r.reason).toBe("too_long");
  });
});

describe("usernames", () => {
  const opts = {
    reserved: new Set(["mlb", "dodgers", "ohtani", "admin", "mod", "staff"]),
    held: new Set(["oldtimer"]),
  };

  it("rejects staff, reserved, contact and real-name shapes", () => {
    expect(validateUsername("MLB_Official", opts).reason).toBe("reserved");
    expect(validateUsername("Adm1n", opts).reason).toBe("reserved");
    expect(validateUsername("snap_jake22", opts).reason).toBe("contact");
    expect(validateUsername("EmmaJ2011", opts).reason).toBe("real_name");
    expect(validateUsername("sh1thead", opts).reason).toBe("profanity");
    expect(validateUsername("OldTimer", opts).reason).toBe("held");
    expect(validateUsername("ab", opts).reason).toBe("format");
    expect(validateUsername("has space", opts).reason).toBe("format");
  });

  it("accepts a plain handle and normalizes it", () => {
    expect(validateUsername("slidestep", opts)).toEqual({ ok: true, normalized: "slidestep" });
    expect(validateUsername("Rally_Cap_88", opts).ok).toBe(true);
    expect(validateUsername("Adm1n", opts).normalized).toBe("admin");
  });
});
