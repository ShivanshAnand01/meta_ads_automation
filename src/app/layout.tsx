import type { Metadata } from "next";
import { Inter, Sora, Noto_Sans_Devanagari, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const notoDevanagari = Noto_Sans_Devanagari({
  variable: "--font-noto-devanagari",
  subsets: ["devanagari"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AdManager — AI-Powered Meta Ads Platform",
  description: "Automate your Meta Ads with AI. Built for the Maharashtrian market.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const pathname = headerStore.get("x-pathname") ?? "";
  const showSidebar = pathname !== "/login" && !pathname.startsWith("/auth/");

  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${sora.variable} ${notoDevanagari.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {showSidebar ? (
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 md:ml-64">
              <div className="container mx-auto p-4 md:p-8">
                {children}
              </div>
            </main>
          </div>
        ) : (
          <div className="min-h-screen">{children}</div>
        )}
        <Toaster />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
