import type { MetadataRoute } from "next";

/**
 * Web app manifest, so Snap Count can be added to a phone home screen and open
 * without browser chrome — which is how a check-the-scores dashboard actually
 * gets used on a Sunday.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Snap Count",
    short_name: "Snap Count",
    description: "All your fantasy football teams, one screen.",
    start_url: "/",
    display: "standalone",
    background_color: "#10151A",
    theme_color: "#10151A",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
