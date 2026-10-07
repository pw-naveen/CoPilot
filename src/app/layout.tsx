import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Persona — Pulseworks",
  description: "Posts written in your own voice, approved on WhatsApp.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
