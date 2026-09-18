import { Nav } from "./Nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="app-shell"
      style={{ display: "flex", minHeight: "100vh", background: "var(--color-page)" }}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Nav />
      <div
        id="main-content"
        tabIndex={-1}
        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}
      >
        {children}
      </div>
    </div>
  );
}
