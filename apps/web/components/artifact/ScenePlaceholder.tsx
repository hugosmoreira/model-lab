import type { ConsoleLine } from "@model-lab/schemas";

/**
 * Stylized CSS stand-in for an artifact's rendered raycaster scene.
 *
 * Phase 2 replaces this with the STORED SCREENSHOT (artifact.screenshotRef) —
 * the gradient and wall hues here are derived purely from the model identity
 * color so the placeholder never invents data.
 */

type Wall = { l: number; t: number; b: number; w: number; mix: number };

/** Three deterministic wall arrangements; picked by a stable hash of the endpoint id. */
const WALL_LAYOUTS: ReadonlyArray<ReadonlyArray<Wall>> = [
  [
    { l: 6, t: 12, b: 22, w: 22, mix: 34 },
    { l: 30, t: 24, b: 32, w: 18, mix: 46 },
    { l: 64, t: 16, b: 26, w: 26, mix: 28 },
  ],
  [
    { l: 12, t: 20, b: 28, w: 26, mix: 30 },
    { l: 44, t: 28, b: 35, w: 14, mix: 40 },
    { l: 66, t: 12, b: 22, w: 20, mix: 44 },
  ],
  [
    { l: 4, t: 22, b: 26, w: 30, mix: 36 },
    { l: 40, t: 30, b: 34, w: 16, mix: 44 },
    { l: 70, t: 26, b: 30, w: 22, mix: 50 },
  ],
];

function hashKey(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function ScenePlaceholder({
  color,
  seedKey,
  variant,
}: {
  /** model identity color — drives gradient + wall hues */
  color: string;
  /** stable key (endpoint id) selecting the wall arrangement */
  seedKey: string;
  /** "card" = 230px grid preview; "stage" = viewer screenshot pane */
  variant: "card" | "stage";
}) {
  const layout: ReadonlyArray<Wall> =
    WALL_LAYOUTS[hashKey(seedKey) % WALL_LAYOUTS.length] ?? WALL_LAYOUTS[0] ?? [];
  const mm =
    variant === "stage"
      ? { size: 84, off: 14, dot: 6, dotRight: 44, dotTop: 46, glow: true }
      : { size: 52, off: 10, dot: 5, dotRight: 22, dotTop: 28, glow: false };

  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        display: "block",
        background: `linear-gradient(color-mix(in srgb, ${color} 22%, #182034) 0 52%, color-mix(in srgb, ${color} 15%, #171223) 52% 100%)`,
      }}
    >
      {layout.map((w, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${w.l}%`,
            top: `${w.t}%`,
            bottom: `${w.b}%`,
            width: `${w.w}%`,
            background: `color-mix(in srgb, ${color} ${w.mix}%, #2e3a58)`,
            boxShadow: "inset 0 0 40px rgba(0,0,0,0.35)",
          }}
        />
      ))}
      {/* minimap square + amber player dot */}
      <span
        style={{
          position: "absolute",
          right: mm.off,
          top: mm.off,
          width: mm.size,
          height: mm.size,
          background: "rgba(10,8,14,0.75)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 4,
        }}
      />
      <span
        style={{
          position: "absolute",
          right: mm.dotRight,
          top: mm.dotTop,
          width: mm.dot,
          height: mm.dot,
          borderRadius: "50%",
          background: "var(--color-amber)",
          boxShadow: mm.glow ? "0 0 6px var(--color-amber)" : undefined,
        }}
      />
    </span>
  );
}

/**
 * Red mono stack trace for a failed render, built from the artifact's
 * console lines, with a faint explanatory tail line.
 */
export function FailureTrace({
  lines,
  tail,
  fontSize = 12,
  inset = 14,
}: {
  lines: ConsoleLine[];
  tail: string;
  fontSize?: number;
  inset?: number;
}) {
  return (
    <span
      style={{
        position: "absolute",
        left: inset,
        top: inset,
        right: inset,
        display: "block",
        fontFamily: "var(--font-mono)",
        fontSize,
        color: "var(--color-red)",
        lineHeight: 1.7,
        whiteSpace: "pre-wrap",
      }}
    >
      {lines.map((l, i) => (
        <span key={i} style={{ display: "block" }}>
          {l.msg}
        </span>
      ))}
      <span style={{ display: "block", marginTop: "1em", color: "var(--color-faint)" }}>{tail}</span>
    </span>
  );
}
