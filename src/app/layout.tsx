import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NoticeBanner } from "@/components/notice-banner";
import { Toaster } from "@/components/ui/sonner";
import { siteUrl } from "@/lib/site-url";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { THEME_SCRIPT } from "@/lib/theme/theme-script";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  applicationName: "Ledgerly",
  openGraph: { type: "website", siteName: "Ledgerly", locale: "en_ZA" },
  twitter: { card: "summary_large_image" },
  title: { default: "Ledgerly — run your whole business from one app", template: "%s · Ledgerly" },
  description:
    "Invoices, clients, expenses, tasks and bookings in one simple app, built for South African small businesses.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1120" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-ZA"
      data-theme="light"
      data-accent="emerald"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* The one permitted inline script: a constant that applies the saved theme before paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <NoticeBanner />
          {children}
          <Toaster position="bottom-center" offset={88} />
        </ThemeProvider>
      </body>
    </html>
  );
}
