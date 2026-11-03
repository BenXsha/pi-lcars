import type { TKey } from "../../i18n";
import type { IconName } from "../../components/Icon";

/** Stations: hash-addressable views + the rail's station list. */

export type View = "session" | "mcp" | "skills" | "providers" | "history" | "system" | "about";

/** Stations are hash-addressable so a link can open e.g. #about. */
export const VIEWS: View[] = ["session", "mcp", "skills", "providers", "history", "system", "about"];
export const viewFromHash = (): View => {
  const hash = typeof location === "undefined" ? "" : location.hash.replace(/^#/, "");
  return (VIEWS as string[]).includes(hash) ? (hash as View) : "session";
};

export const NAV: { view: View; key: TKey; icon: IconName; tone: "amber" | "lav" | "moon" | "ice" | "cyan" }[] = [
  { view: "mcp", key: "nav.mcp", icon: "station-mcp", tone: "lav" },
  { view: "skills", key: "nav.skills", icon: "station-skills", tone: "ice" },
  { view: "providers", key: "nav.providers", icon: "station-provider", tone: "cyan" },
  { view: "history", key: "nav.history", icon: "station-history", tone: "amber" },
  { view: "system", key: "nav.settings", icon: "station-system", tone: "moon" },
  { view: "about", key: "nav.about", icon: "station-about", tone: "ice" },
];
