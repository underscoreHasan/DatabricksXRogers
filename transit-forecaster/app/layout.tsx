import type { Metadata } from "next";
import "./globals.css";
import { Noto_Sans, Playfair_Display, Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const playfairDisplayHeading = Playfair_Display({subsets:['latin'],variable:'--font-heading'});

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "TransitPulse — Predictive Transit Intelligence",
  description: "Explore modeled traffic forecasts across the Vancouver network.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("font-sans", inter.variable, playfairDisplayHeading.variable)}>
      <body>{children}</body>
    </html>
  );
}
