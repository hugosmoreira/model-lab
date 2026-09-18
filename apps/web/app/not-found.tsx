import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Run or page not found</h1>
      <p>This address has no recorded result in the selected workspace.</p>
      <Link href="/runs" style={{ color: "var(--color-amber)" }}>
        Browse recorded runs →
      </Link>
    </main>
  );
}
