import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { BRAND_NAME } from "@/lib/brand";
import "./globals.css";

// next/font self-hosts at build time — no runtime request to Google (audit M-2)
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
});

const jbMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jbmono",
});

export const metadata: Metadata = {
  title: BRAND_NAME,
  description:
    "Run reproducible LLM comparisons, inspect live artifacts, and export publication-ready results.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plex.variable} ${jbMono.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
