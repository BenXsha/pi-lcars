import { render } from "preact";
import "./styles/themes.css";
import "./styles/lcars.css";
import { restoreTheme } from "./theme";
import { initSettings, setSettings } from "./settings";
import { App } from "./app";
import { installInputTrace, installPanicSurface, installWatchdog } from "./panic";

// a crash must show the fault, not a blank screen
installPanicSurface();
installInputTrace();
installWatchdog();

// `?nomotion` / `?motion` flip the same switch the settings panel uses, so the
// choice survives reloads while we bisect a renderer fault.
const params = new URLSearchParams(location.search);
if (params.has("nomotion")) setSettings({ motion: "reduced" });
else if (params.has("motion")) setSettings({ motion: "system" });
if (params.has("backdrop")) setSettings({ backdrop: params.get("backdrop") === "0" ? "off" : "on" });

// theme before first paint — no flash of the default palette
restoreTheme();
initSettings();

render(<App />, document.getElementById("root")!);
