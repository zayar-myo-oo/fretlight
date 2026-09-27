import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fretlight — Guitar & Bass Practice",
  description:
    "An intelligent practice companion for guitar and bass: real-time pitch detection, interactive fretboard, scales, chords and rhythm — all computed locally.",
  applicationName: "Fretlight",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    // Installing from Safari's share sheet only reads these apple-specific
    // tags, not the web manifest, so title/status bar style need setting here
    // too even though the manifest already covers every other browser.
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Fretlight",
  },
};

export const viewport: Viewport = {
  themeColor: "#04060b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        <ServiceWorkerRegistration />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
