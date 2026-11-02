/**
 * The composer is the one place that owns draft text. Anything that wants to
 * put words there (quote a message, recall a prompt) publishes an intent here
 * instead of drilling callbacks through the transcript.
 */
export type ComposerIntent = { kind: "quote" | "replace"; text: string };

export function askComposer(intent: ComposerIntent) {
  window.dispatchEvent(new CustomEvent<ComposerIntent>("lcars:composer", { detail: intent }));
}

export function onComposerRequest(fn: (intent: ComposerIntent) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<ComposerIntent>).detail);
  window.addEventListener("lcars:composer", handler);
  return () => window.removeEventListener("lcars:composer", handler);
}

/** Ask the shell to open one of its decks (used by slash commands). */
export function askDeck(deck: "new" | "model" | "think" | "quick") {
  window.dispatchEvent(new CustomEvent<{ deck: string }>("lcars:deck", { detail: { deck } }));
}

export function onDeckRequest(fn: (deck: "new" | "model" | "think" | "quick") => void) {
  const handler = (e: Event) => fn((e as CustomEvent<{ deck: "new" | "model" | "think" | "quick" }>).detail.deck);
  window.addEventListener("lcars:deck", handler);
  return () => window.removeEventListener("lcars:deck", handler);
}
