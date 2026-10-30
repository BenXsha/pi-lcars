import { render } from "preact";
import "./styles/themes.css";
import "./styles/lcars.css";
import { restoreTheme } from "./theme";
import { initSettings } from "./settings";
import { App } from "./app";
import { installInputTrace, installPanicSurface } from "./panic";

// a crash must show the fault, not a blank screen
installPanicSurface();
installInputTrace();

// `?nomotion` disables every animation and transition (diagnostic bisect)
if (new URLSearchParams(location.search).has("nomotion")) {
  document.documentElement.dataset.motion = "off";
}

// theme before first paint — no flash of the default palette
restoreTheme();
initSettings();

render(<App />, document.getElementById("root")!);
