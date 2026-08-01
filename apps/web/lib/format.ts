/** Number/display formatting rules inferred from the prototypes. */

export function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function tokensK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ttft(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

/** "04:12" from seconds (mm:ss). */
export function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** HH:MM from ISO timestamp (UTC — fixture timezone). */
export function hhmm(iso: string): string {
  return iso.slice(11, 16);
}

/** HH:MM:SS from ISO timestamp. */
export function hhmmss(iso: string): string {
  return iso.slice(11, 19);
}
