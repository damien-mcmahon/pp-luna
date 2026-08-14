import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dealer's Choice | Planning Poker",
  description: "A live, Vegas-inspired planning poker table for teams that estimate together.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
