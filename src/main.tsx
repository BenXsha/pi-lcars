import { render } from "preact";
import "./styles/themes.css";
import "./styles/lcars.css";
import { restoreTheme } from "./theme";
import { initSettings } from "./settings";
import { App } from "./app";

// theme before first paint — no flash of the default palette
restoreTheme();
initSettings();

render(<App />, document.getElementById("root")!);
