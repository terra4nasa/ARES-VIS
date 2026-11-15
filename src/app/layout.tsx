import type { Metadata, Viewport } from "next";
import "@fontsource/orbitron/500.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/share-tech-mono/400.css";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "RedDot Marswalk — Elysium Traverse Planner",
  description:
    "RedDot Marswalk — Singapore's Little Red Dot on the Red Planet. A layered, integrated Mars surface map for planning astronaut traverses — built from NASA MOLA, HRSC, CTX, Viking, THEMIS, InSight and live space-weather data. NASA Space Apps 2026 'Interplanetary Survival Guide: Martian Map'.",
  icons: { icon: "assets/img/pov_final_location.jpg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" style={{ background: "var(--hud-bg)", color: "var(--hud-text)" }}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
