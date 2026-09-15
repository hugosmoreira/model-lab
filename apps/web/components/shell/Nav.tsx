"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { fixtures } from "@/lib/data";

interface NavItem {
  id: string;
  name: string;
  href: string;
  live?: boolean;
  soon?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { id: "mission", name: "Mission Control", href: "/" },
      { id: "newrun", name: "New Run", href: "/runs/new" },
      { id: "live", name: "Live Run", href: "/runs/run_8f3ac21e/live", live: true },
      { id: "runs", name: "Runs", href: "/runs" },
    ],
  },
  {
    label: "Compare",
    items: [
      { id: "arena", name: "Build Arena", href: "/arena" },
      { id: "leaderboard", name: "Leaderboard", href: "#", soon: true },
      { id: "h2h", name: "Head-to-Head", href: "/compare" },
      { id: "artifacts", name: "Artifacts", href: "/runs/run_8f3ac21e/artifacts" },
    ],
  },
  {
    label: "Lab",
    items: [
      { id: "packs", name: "Benchmark Packs", href: "/benchmarks" },
      { id: "models", name: "Models", href: "/models" },
      { id: "judge", name: "Judge Lab", href: "#", soon: true },
    ],
  },
  {
    label: "Publish",
    items: [{ id: "share", name: "Share Studio", href: "/share/run_8f3ac21e" }],
  },
  {
    label: "System",
    items: [
      { id: "providers", name: "Providers", href: "/settings/providers" },
      { id: "settings", name: "Settings", href: "/settings" },
    ],
  },
];

function activeIdFromPath(path: string): string {
  if (path === "/") return "mission";
  if (path.startsWith("/runs/new")) return "newrun";
  if (/^\/runs\/[^/]+\/live/.test(path)) return "live";
  if (/^\/runs\/[^/]+\/artifacts/.test(path)) return "artifacts";
  if (path.startsWith("/runs")) return "runs";
  if (path.startsWith("/arena")) return "arena";
  if (path.startsWith("/compare")) return "h2h";
  if (path.startsWith("/benchmarks")) return "packs";
  if (path.startsWith("/models")) return "models";
  if (path.startsWith("/share")) return "share";
  if (path.startsWith("/settings/providers")) return "providers";
  if (path.startsWith("/settings")) return "settings";
  return "";
}

export function Nav() {
  const pathname = usePathname();
  const active = activeIdFromPath(pathname);
  const { workspaceSettings } = fixtures;

  return (
    <aside
      style={{
        flex: "0 0 224px",
        width: 224,
        minHeight: "100vh",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-rail)",
        borderRight: "1px solid var(--color-border)",
        position: "sticky",
        top: 0,
        maxHeight: "100vh",
      }}
    >
      <Link
        href="/"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: "linear-gradient(135deg,#e8a33d,#d16ba0)",
            color: "var(--color-on-accent)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ML
        </span>
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ fontWeight: 600, color: "var(--color-text)", fontSize: 14 }}>
            Model Lab
          </span>
          <span
            style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-faint)" }}
          >
            v0.1.0 · local
          </span>
        </span>
      </Link>

      <nav
        aria-label="Primary"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {SECTIONS.map((section) => (
          <div key={section.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontWeight: 600,
                color: "var(--color-faint)",
                padding: "0 10px 6px",
              }}
            >
              {section.label}
            </span>
            {section.items.map((item) => {
              const isActive = item.id === active;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  aria-disabled={item.soon || undefined}
                  className={isActive ? "nav-item nav-item-active" : "nav-item"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "7px 10px",
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: isActive ? 600 : 500,
                    cursor: item.soon ? "default" : "pointer",
                  }}
                >
                  <span>{item.name}</span>
                  {item.live && (
                    <span
                      aria-label="Run in progress"
                      className="ml-pulse"
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--color-teal)",
                        boxShadow: "0 0 6px var(--color-teal)",
                      }}
                    />
                  )}
                  {item.soon && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--color-faint)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 3,
                        padding: "1px 5px",
                      }}
                    >
                      soon
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--color-border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-faint)",
        }}
      >
        <span>{workspaceSettings.workspacePath}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-teal)" }}
          />
          runner online
        </span>
      </div>
    </aside>
  );
}
