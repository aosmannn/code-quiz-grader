import type { Metadata } from "next";
import { Source_Sans_3, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Preflight · before you submit",
  description:
    "Upload your lab code, answer a few questions about it, and get cleared to submit.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[var(--paper)] font-sans text-[var(--ink)]">
        {children}
      </body>
    </html>
  );
}
