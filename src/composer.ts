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
