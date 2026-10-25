/**
 * Allow-list check for links (plan U12, reused by the feed in U10).
 *
 * A link passes only when it is https, has no userinfo or non-standard port,
 * its hostname is exactly an allowed host or a subdomain of one, and its path
 * is not a known redirector. Everything else fails, including anything the
 * URL API cannot parse.
 */

export type UrlRejection =
  | "invalid"
  | "scheme"
  | "userinfo"
  | "port"
  | "host"
  | "redirect";

export type UrlCheck =
  | { ok: true; url: URL; host: string }
  | { ok: false; reason: UrlRejection };

/** Paths that bounce the visitor somewhere else on otherwise-trusted hosts. */
const REDIRECT_PATHS = [
  "/redirect",
  "/url",
  "/away",
  "/out",
  "/exit",
  "/link",
  "/go",
  "/r/",
  "/l.php",
];

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((a) => {
    const base = a.toLowerCase().replace(/\.$/, "");
    return host === base || host.endsWith(`.${base}`);
  });
}

export function checkUrl(raw: string, allowedHosts: readonly string[]): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "userinfo" };
  if (url.port !== "") return { ok: false, reason: "port" };

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || !hostAllowed(host, allowedHosts)) return { ok: false, reason: "host" };

  const path = url.pathname.toLowerCase();
  const isRedirectPath = REDIRECT_PATHS.some(
    (p) => path === p || path === p.replace(/\/$/, "") || path.startsWith(p.endsWith("/") ? p : `${p}/`),
  );
  const carriesUrl = /https?(?::|%3a)/i.test(url.search) || /https?(?::|%3a)/i.test(url.hash);
  if (isRedirectPath || carriesUrl) return { ok: false, reason: "redirect" };

  return { ok: true, url, host };
}
