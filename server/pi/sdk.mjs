/**
 * Resolve the pi SDK without pinning a local path.
 * Order: PI_SDK env → package resolution → known global install.
 */
const CANDIDATES = [
  process.env.PI_SDK,
  "@earendil-works/pi-coding-agent",
  `${process.env.HOME}/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js`,
].filter(Boolean);

let cached;
let loadedFrom = null;

/** Which specifier actually resolved — the settings panel shows it. */
export const sdkSpec = () => loadedFrom;

export async function loadSdk() {
  if (cached) return cached;
  const tried = [];
  for (const spec of CANDIDATES) {
    try {
      cached = await import(spec);
      loadedFrom = spec;
      return cached;
    } catch (e) {
      tried.push(`${spec}: ${e.message}`);
    }
  }
  throw new Error(`cannot load pi SDK\n  ${tried.join("\n  ")}`);
}

export const agentDir = () => `${process.env.HOME || ""}/.pi/agent`;
