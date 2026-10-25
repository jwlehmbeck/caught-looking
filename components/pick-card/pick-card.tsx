"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { getPickSplit, makePick, type PickError, type PickSplit } from "@/lib/picks/actions";
import type { AppState } from "@shared/domain/game-state.ts";

export interface PickCardTeam {
  id: number;
  abbreviation: string;
  name: string;
  /** App-chosen team color (never the only way a team is identified). */
  color: string;
}

export interface PickCardGame {
  id: number;
  appState: AppState;
  lockAt: string;
  gameDate: string;
  home: PickCardTeam;
  away: PickCardTeam;
  homeScore: number | null;
  awayScore: number | null;
  winnerTeamId: number | null;
  countsForPicks: boolean;
}

export interface ViewerPick {
  teamId: number;
  status: "active" | "correct" | "wrong" | "void";
}

export interface PickCardProps {
  game: PickCardGame;
  initialPick: ViewerPick | null;
  /** Fan split, when the viewer is allowed to see it (null otherwise). */
  initialSplit: PickSplit | null;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

type Phase =
  | { kind: "open" }
  | { kind: "saving"; teamId: number }
  | { kind: "lockRejected" }
  | { kind: "saveError"; teamId: number; reason: Exclude<PickError, "locked"> }
  | { kind: "awaiting" }
  | { kind: "void" }
  | { kind: "result" };

export function formatCountdown(msLeft: number): string {
  if (msLeft < 60_000) return "Locks in under a minute";
  const totalMinutes = Math.floor(msLeft / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `Locks in ${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `Locks in ${hours}h ${minutes}m`;
  return `Locks in ${minutes}m`;
}

function teamById(game: PickCardGame, id: number | null | undefined): PickCardTeam | null {
  if (id === game.home.id) return game.home;
  if (id === game.away.id) return game.away;
  return null;
}

function basePhase(game: PickCardGame, nowMs: number): Phase {
  switch (game.appState) {
    case "void":
      return { kind: "void" };
    case "scored":
      return { kind: "result" };
    case "final":
      return game.homeScore !== null && game.awayScore !== null ? { kind: "result" } : { kind: "awaiting" };
    case "locked":
    case "live":
    case "suspended":
      return { kind: "awaiting" };
    case "open":
      return nowMs >= new Date(game.lockAt).getTime() ? { kind: "awaiting" } : { kind: "open" };
  }
}

const cardStyle: React.CSSProperties = {
  background: "var(--cl-bg-raised)",
  border: "1px solid var(--cl-border)",
  borderRadius: "var(--cl-radius)",
  padding: 16,
  display: "grid",
  gap: 14,
};

function teamButtonStyle(selected: boolean, disabled: boolean): React.CSSProperties {
  return {
    minHeight: 60,
    borderRadius: "var(--cl-radius-sm)",
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    background: selected ? "var(--cl-accent)" : "#1f3049",
    color: selected ? "var(--cl-on-accent)" : "var(--cl-text)",
    border: `2px solid ${selected ? "var(--cl-accent)" : "var(--cl-border-strong)"}`,
    opacity: disabled && !selected ? 0.7 : 1,
    cursor: disabled ? "default" : "pointer",
    transition: "background 120ms ease, border-color 120ms ease",
  };
}

function TeamButton({
  team,
  side,
  selected,
  disabled,
  onSelect,
}: {
  team: PickCardTeam;
  side: "away" | "home";
  selected: boolean;
  disabled: boolean;
  onSelect: (teamId: number) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${team.abbreviation} ${team.name}, ${side === "home" ? "home" : "away"}${selected ? ", your pick" : ""}`}
      disabled={disabled}
      onClick={() => onSelect(team.id)}
      style={teamButtonStyle(selected, disabled)}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            background: team.color,
            border: "1px solid rgba(244, 241, 234, 0.6)",
            flexShrink: 0,
          }}
        />
        <span style={{ fontFamily: "var(--cl-font-display)", fontSize: 24, lineHeight: 1, letterSpacing: 0.5 }}>
          {team.abbreviation}
        </span>
      </span>
      <span style={{ fontSize: 12, opacity: 0.9 }}>{team.name}</span>
    </button>
  );
}

function SplitBar({ game, split }: { game: PickCardGame; split: PickSplit }) {
  const total = Math.max(split.total, 1);
  const awayPct = Math.round((split.away / total) * 100);
  const homePct = split.total === 0 ? 0 : 100 - awayPct;
  return (
    <div style={{ display: "grid", gap: 6 }} aria-label="Fan split">
      <div
        role="img"
        aria-label={`${awayPct}% picked ${game.away.abbreviation}, ${homePct}% picked ${game.home.abbreviation}`}
        style={{ height: 10, borderRadius: 5, background: "var(--cl-border-strong)", overflow: "hidden", display: "flex" }}
      >
        <div style={{ width: `${awayPct}%`, background: "var(--cl-accent)" }} />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 12,
          color: "var(--cl-text-muted)",
        }}
      >
        <span>
          {awayPct}% picked {game.away.abbreviation}
        </span>
        <span>
          {split.total.toLocaleString("en-US")} {split.total === 1 ? "fan" : "fans"} picked
        </span>
        <span>
          {homePct}% picked {game.home.abbreviation}
        </span>
      </div>
    </div>
  );
}

function scoreLine(game: PickCardGame): string {
  if (game.homeScore === null || game.awayScore === null) return "";
  return `${game.away.abbreviation} ${game.awayScore}, ${game.home.abbreviation} ${game.homeScore}`;
}

/**
 * The pick card: two team buttons, a lock countdown, the fan split once the
 * viewer has picked, and the result after the final. The database owns the
 * lock; this card only reflects it.
 */
export function PickCard({ game, initialPick, initialSplit, now = Date.now }: PickCardProps) {
  const [pick, setPick] = useState<ViewerPick | null>(initialPick);
  const [split, setSplit] = useState<PickSplit | null>(initialSplit);
  const [changing, setChanging] = useState(initialPick === null);
  const [nowMs, setNowMs] = useState(() => now());
  const [rawPhase, setPhase] = useState<Phase>(() => basePhase(game, now()));
  const [, startTransition] = useTransition();

  // Tick the countdown. Every 30 s is plenty for "2h 14m".
  useEffect(() => {
    if (game.appState !== "open") return;
    const id = setInterval(() => setNowMs(now()), 30_000);
    return () => clearInterval(id);
  }, [game.appState, now]);

  const msLeft = new Date(game.lockAt).getTime() - nowMs;
  // Once the client clock passes lock_at, stop offering buttons even before
  // the next server render (the database would reject the pick anyway).
  const phase: Phase = rawPhase.kind === "open" && msLeft <= 0 ? { kind: "awaiting" } : rawPhase;
  const pickedTeam = teamById(game, pick?.teamId);
  const winner = teamById(game, game.winnerTeamId);

  const select = useCallback(
    (teamId: number) => {
      if (pick?.teamId === teamId && pick.status === "active" && phase.kind === "open") {
        setChanging(false);
        return;
      }
      setPhase({ kind: "saving", teamId });
      startTransition(async () => {
        const result = await makePick(game.id, teamId);
        if (result.ok) {
          setPick({ teamId: result.teamId, status: "active" });
          setChanging(false);
          setPhase({ kind: "open" });
          const s = await getPickSplit(game.id);
          setSplit(s);
          return;
        }
        if (result.error === "locked") {
          setPhase({ kind: "lockRejected" });
          return;
        }
        setPhase({ kind: "saveError", teamId, reason: result.error });
      });
    },
    [game.id, phase.kind, pick],
  );

  const buttonsDisabled = useMemo(() => {
    if (phase.kind === "saving") return true;
    if (phase.kind === "open" || phase.kind === "saveError") return !changing;
    return true;
  }, [phase.kind, changing]);

  const showButtons = phase.kind === "open" || phase.kind === "saving" || phase.kind === "saveError";

  let heading = "Who wins?";
  if (phase.kind === "result") heading = pick && pick.status === "correct" ? "You called it" : pick && pick.status === "wrong" ? "Caught looking" : "Final";
  if (phase.kind === "void") heading = "No result";
  if (phase.kind === "awaiting") heading = "Picks are locked";

  return (
    <section style={cardStyle} aria-label={`Pick: ${game.away.abbreviation} at ${game.home.abbreviation}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ fontSize: 22, textTransform: "uppercase" }}>{heading}</h2>
        {phase.kind === "open" || phase.kind === "saving" || phase.kind === "saveError" ? (
          <span suppressHydrationWarning style={{ fontSize: 12, color: "var(--cl-text-muted)", whiteSpace: "nowrap" }}>
            {formatCountdown(msLeft)}
          </span>
        ) : null}
      </div>

      {showButtons ? (
        <div
          role="group"
          aria-label={`Pick a winner: ${game.away.name} at ${game.home.name}`}
          style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}
        >
          <TeamButton
            team={game.away}
            side="away"
            selected={(phase.kind === "saving" ? phase.teamId : pick?.teamId) === game.away.id}
            disabled={buttonsDisabled}
            onSelect={select}
          />
          <TeamButton
            team={game.home}
            side="home"
            selected={(phase.kind === "saving" ? phase.teamId : pick?.teamId) === game.home.id}
            disabled={buttonsDisabled}
            onSelect={select}
          />
        </div>
      ) : null}

      <div role="status" aria-live="polite" style={{ fontSize: 14, display: "grid", gap: 8 }}>
        {phase.kind === "open" && !pick ? (
          <p style={{ color: "var(--cl-text-muted)" }}>Tap a team to make your pick. Locks at first pitch.</p>
        ) : null}

        {phase.kind === "open" && pick && pickedTeam ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <p>
              You picked <strong>{pickedTeam.abbreviation}</strong>.
            </p>
            {changing ? (
              <span style={{ color: "var(--cl-text-muted)" }}>Tap the other team to switch.</span>
            ) : (
              <button
                type="button"
                onClick={() => setChanging(true)}
                style={{
                  minHeight: "var(--cl-tap)",
                  padding: "0 14px",
                  borderRadius: "var(--cl-radius-pill)",
                  border: "1px solid var(--cl-border-strong)",
                  background: "transparent",
                  color: "var(--cl-text)",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                Change
              </button>
            )}
          </div>
        ) : null}

        {phase.kind === "saving" ? <p style={{ color: "var(--cl-text-muted)" }}>Saving your pick…</p> : null}

        {phase.kind === "lockRejected" ? (
          <p>
            <strong>This game just started.</strong> Picks locked at first pitch
            {pickedTeam ? `, so your pick stays ${pickedTeam.abbreviation}.` : "."}
          </p>
        ) : null}

        {phase.kind === "saveError" ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <p>
              {phase.reason === "suspended"
                ? "Your account is suspended, so picks are paused."
                : "Couldn't save your pick."}
            </p>
            {phase.reason !== "suspended" ? (
              <button
                type="button"
                onClick={() => select(phase.teamId)}
                style={{
                  minHeight: "var(--cl-tap)",
                  padding: "0 16px",
                  borderRadius: "var(--cl-radius-pill)",
                  border: "none",
                  background: "var(--cl-accent)",
                  color: "var(--cl-on-accent)",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        {phase.kind === "awaiting" ? (
          <p style={{ color: "var(--cl-text-muted)" }}>
            {pickedTeam ? (
              <>
                You picked <strong style={{ color: "var(--cl-text)" }}>{pickedTeam.abbreviation}</strong>. Result comes
                after the final.
              </>
            ) : (
              "You didn't pick this one. Result comes after the final."
            )}
          </p>
        ) : null}

        {phase.kind === "void" ? (
          <p style={{ color: "var(--cl-text-muted)" }}>
            This game didn&apos;t count{pickedTeam ? `, so your ${pickedTeam.abbreviation} pick was cleared` : ""}.
            {" "}If it&apos;s rescheduled, picks open again.
          </p>
        ) : null}

        {phase.kind === "result" ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: "var(--cl-radius-sm)",
              background: pick?.status === "correct" ? "var(--cl-accent)" : "var(--cl-bg-card)",
              color: pick?.status === "correct" ? "var(--cl-on-accent)" : "var(--cl-text)",
            }}
          >
            <div style={{ display: "grid", gap: 2 }}>
              <span style={{ fontFamily: "var(--cl-font-display)", fontSize: 20, letterSpacing: 0.5 }}>
                {scoreLine(game)} · Final
              </span>
              <span style={{ fontSize: 13 }}>
                {pick && pickedTeam && pick.status === "correct"
                  ? `You picked ${pickedTeam.abbreviation}. Nice call.`
                  : pick && pickedTeam && pick.status === "wrong"
                    ? `You picked ${pickedTeam.abbreviation}; ${winner?.abbreviation ?? "the other side"} took it.`
                    : pick && pickedTeam && pick.status === "void"
                      ? "This one didn't count toward your picks."
                      : pick && pickedTeam
                        ? `You picked ${pickedTeam.abbreviation}. Scoring soon.`
                        : winner
                          ? `${winner.abbreviation} won. You didn't pick this one.`
                          : "You didn't pick this one."}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {split && (pick || phase.kind !== "open") ? <SplitBar game={game} split={split} /> : null}
    </section>
  );
}
