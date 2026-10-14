import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#06090f",
};

/* Three voices: an editorial grotesk for reading, a condensed broadcast face
 * for scores and headings, and a mono for tabular data. */
const ui = Schibsted_Grotesk({
  variable: "--font-ui",
  subsets: ["latin"],
});

const display = Barlow_Condensed({
  variable: "--font-display-face",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  style: ["normal", "italic"],
});

const data = JetBrains_Mono({
  variable: "--font-data",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GafferFPL",
  description: "Personal FPL squad, captain and transfer decisions.",
  appleWebApp: { capable: true, title: "GafferFPL", statusBarStyle: "black" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${ui.variable} ${display.variable} ${data.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
