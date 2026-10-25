import type { Metadata, Viewport } from "next";
import { Anton, DM_Sans } from "next/font/google";

import "./globals.css";

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
  display: "swap",
});

const dmSans = DM_Sans({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Caught Looking",
    template: "%s · Caught Looking",
  },
  description:
    "A hangout for teen baseball fans: pick winners, earn badges, watch clips, talk ball.",
};

export const viewport: Viewport = {
  themeColor: "#0e1a2b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${anton.variable} ${dmSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
