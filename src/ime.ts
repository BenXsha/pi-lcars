/* An IME owns the keyboard for as long as a candidate window is open: Enter
 * commits the candidate, ArrowUp/Down pick one, Escape dismisses it, and Space
 * is a commit key in most Chinese/Japanese methods. None of those may reach a
 * console shortcut — `composing` covers the browsers that report
 * `isComposing: false` on the committing Enter, and `keyCode 229` covers the
 * engines that never set `isComposing` at all. */
export function imeBusy(e: KeyboardEvent, composing?: { current: boolean }): boolean {
  if (composing?.current || e.isComposing) return true;
  return (e as KeyboardEvent & { keyCode?: number }).keyCode === 229;
}
