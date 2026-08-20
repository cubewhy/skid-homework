import "../index.css";
import type {Metadata, Viewport} from "next";
import Providers from "./providers";
import {PlatformRootShell} from "@/platform";

import "@/css/jsxgraph.css";

export const metadata: Metadata = {
  title: "Skid Homework",
  description:
    "The open source workaround for self-learners. Time-saving, no telemetry, free.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/skid-homework.svg", type: "image/svg+xml" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico" }],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Skid Homework",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <PlatformRootShell>
          <Providers>{children}</Providers>
        </PlatformRootShell>
      </body>
    </html>
  );
}
