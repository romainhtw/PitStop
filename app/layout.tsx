import type { Metadata } from "next";
import { Bebas_Neue } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bebas",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PitStop by Elite Racing",
  description: "Inventory management for Elite Racing Cycles, Perth",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${bebas.variable} antialiased bg-brand-light text-gray-900`}>
        <AppShell />
        <main className="lg:ml-56 min-h-screen">{children}</main>
      </body>
    </html>
  );
}
