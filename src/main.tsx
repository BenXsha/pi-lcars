import { render } from "preact";
import "./styles/themes.css";
import "./styles/lcars.css";
import { restoreTheme } from "./theme";
import { App } from "./app";

// theme before first paint — no flash of the default palette
restoreTheme();

render(<App />, document.getElementById("root")!);
