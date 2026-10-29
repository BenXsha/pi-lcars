import { Craft } from "./views/Craft";
import { Console } from "./views/Console";

/** `?craft` renders the primitive sheet; everything else is the console. */
export function App() {
  const craft = new URLSearchParams(location.search).has("craft");
  return craft ? <Craft /> : <Console />;
}
