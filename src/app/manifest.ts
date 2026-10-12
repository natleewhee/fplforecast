import type { MetadataRoute } from "next";

/** Lets the app be added to a phone's home screen and open full-screen like
 * an app, which is how it gets used on match days. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FPL Forecaster",
    short_name: "FPL",
    description: "Personal FPL squad, captain and transfer decisions.",
    start_url: "/",
    display: "standalone",
    background_color: "#06090f",
    theme_color: "#06090f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
