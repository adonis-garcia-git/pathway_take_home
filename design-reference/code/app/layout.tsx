// app/layout.tsx — fonts (Geist · Geist Mono · Newsreader) wired to theme vars.
import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-geist-mono" });
const newsreader = Newsreader({ subsets: ["latin"], weight: ["300", "400", "500", "600"], style: ["normal", "italic"], variable: "--font-newsreader" });

export const metadata: Metadata = { title: "Pathway · RFP Pipeline", description: "World-class procurement that runs itself." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${newsreader.variable}`}>
      <body>{children}</body>
    </html>
  );
}
