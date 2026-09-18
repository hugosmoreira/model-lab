"use client";

import Link from "next/link";

export default function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main style={{ padding: 32 }}>
      <h1>Unable to load this workspace</h1>
      <p role="alert">
        The requested data could not be loaded. No demo data has been substituted. Check the server
        and storage connection, then retry.
      </p>
      <button
        type="button"
        onClick={reset}
        className="btn-primary"
        style={{
          padding: "8px 14px",
          background: "var(--color-amber)",
          color: "var(--color-on-accent)",
          border: 0,
          borderRadius: 6,
        }}
      >
        Try again
      </button>
      <Link href="/runs" style={{ marginLeft: 16 }}>
        Back to runs
      </Link>
    </main>
  );
}
