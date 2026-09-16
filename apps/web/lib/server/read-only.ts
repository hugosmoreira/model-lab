/**
 * Read-only mode — SERVER-ONLY.
 *
 * `MODEL_LAB_READ_ONLY=1` turns an instance into a results viewer: every page
 * and every GET keeps working, but the routes that create state (new runs,
 * blind votes, annotations) answer 403. This is what a public demo runs with,
 * together with `MODEL_LAB_MOCK_PROVIDERS=1` and no provider keys, because the
 * HTTP API has no authentication of its own (see SECURITY.md).
 */
import { NextResponse } from "next/server";

export const READ_ONLY_ENV = "MODEL_LAB_READ_ONLY";

export function isReadOnly(): boolean {
  return (process.env[READ_ONLY_ENV] ?? "").trim() === "1";
}

export const READ_ONLY_MESSAGE =
  "This instance is read-only: it serves results but does not accept new runs, votes, or annotations. Run Model Lab locally to benchmark.";

/** The 403 every write route returns while read-only. */
export function readOnlyResponse(): NextResponse {
  return NextResponse.json({ error: READ_ONLY_MESSAGE, readOnly: true }, { status: 403 });
}
