import type { Metadata } from "next";
import { preload } from "react-dom";
import { AppShell } from "@/components/shell/AppShell";
import "./fonts.css";
import "./globals.css";

// Fonts are vendored (app/fonts.css): neither the build nor the browser contacts Google (audit M-2).
const LATIN_FONTS = [
  "/fonts/ibm-plex-sans-v23-latin.woff2",
  "/fonts/jetbrains-mono-v24-latin.woff2",
];

export const metadata: Metadata = {
  title: "Model Lab",
  description:
    "Run reproducible LLM comparisons, inspect live artifacts, and export publication-ready results.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The latin subsets render nearly every page; other subsets load on demand.
  for (const href of LATIN_FONTS) {
    preload(href, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  }
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
