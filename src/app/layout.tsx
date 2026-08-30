import type { Metadata, Viewport } from "next";
import { Inter, Sora, Noto_Sans_Devanagari, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
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
  // This is a private client tool, not a page that should be indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Tell the browser the app genuinely supports both schemes, so it renders
  // native controls correctly instead of guessing.
  colorScheme: "light dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const pathname = headerStore.get("x-pathname") ?? "";
  const publicPages = new Set(["/login", "/reset-password", "/auth/callback"]);
  const showSidebar = pathname ? !publicPages.has(pathname) && !pathname.startsWith("/auth/") : true;

  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      // next-themes writes the theme class on the client, which would
      // otherwise trip a hydration mismatch warning on every load.
      suppressHydrationWarning
      className={`${inter.variable} ${sora.variable} ${notoDevanagari.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <ThemeProvider>
          {/* First tab stop: lets keyboard and screen-reader users skip the
              navigation instead of tabbing through every nav item. */}
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>

          {showSidebar ? (
            <div className="flex min-h-screen">
              <Sidebar />
              <main id="main-content" tabIndex={-1} className="flex-1 md:ml-64">
                <div className="container mx-auto p-4 md:p-8">{children}</div>
              </main>
            </div>
          ) : (
            <main id="main-content" tabIndex={-1} className="min-h-screen">
              {children}
            </main>
          )}

          <Toaster />
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
