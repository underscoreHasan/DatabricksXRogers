import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TransitPulse — Predictive Transit Intelligence",
  description: "Explore modeled traffic forecasts across the Vancouver network.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
