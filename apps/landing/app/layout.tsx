import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter_Tight } from "next/font/google";

import "./globals.css";

const displayFont = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-display",
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Oggregator — Options terminal for fragmented markets",
  description:
    "High-performance option aggregation terminal for serious traders. Aggregate live venue data, normalize context, and route with precision from one workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${monoFont.variable}`}>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
