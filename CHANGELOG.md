# Changelog

All notable changes to pi-lcars. Version numbers follow [SemVer](https://semver.org)
(0.x: a minor bump means new behaviour, a patch means fixes only).

Release notes are written **before** the version is bumped: `scripts/build-release.mjs`
reads the section for the current `package.json` version and prints it inside the
share bundle's `README.txt`, and fails the build when there is no such section.

## [0.4.0] — 2026-11-04

The release that made the console readable from across the room: the STREAM view
grew a live dot matrix, the mission log grew the same readout as a strip, and the
layout was pinned down for the two laptop sizes people actually use.

### Added

- **The dot matrix** (`src/braille.ts`, `BrailleBand`). A strip of round dots that
  answers "what is the machine doing right now", in five phases derived from the
  real item stream: `idle` (sparse, slow reshuffle) · `thinking` (dots firing on
  their own periods) · `streaming` (a waveform travelling right) · `running`
  (columns draining, a bright head over a dim tail) · `done` (collapsing to a
  baseline, then idle). 90ms fixed step on one shared rAF; `prefers-reduced-motion`
  and `[data-motion="reduced"]` freeze it to a still frame.
- **The band in STREAM** sits in the seam under the THINKING header — 8 dot rows
  (two braille cell rows) at a 6 × 4.5px pitch, a 36px strip coloured by the zone.
- **`ACTIVITY` in the mission log.** The same band, read once for the whole
  session instead of per zone: `[14px leg][ACTIVITY][dot matrix][state]`, 36px,
  between the header and the transcript so it stays put while the log scrolls.
  Its colour is the *phase* (thinking = moon, streaming = orange, running =
  tangerine, quiet = grey). Both bands call the same `phaseFor(items, running)`,
  so the log and the STREAM zones cannot describe the same moment differently —
  and a run that is thinking silently still reads `SCANNING` instead of `IDLE`.
- **Back to the tail** (the log): a floating `LATEST · N NEW` control in the
  transcript's lower-right corner, plus `ctrl+end` (jump to the end and follow
  new output again) and `ctrl+home` (top) — the same bindings as pi's TUI
  (`tui.altScreen.bottom` / `.top`). The composer keeps both keys while it has
  focus, where they mean "end of text".
- **Two more gated viewports.** 1440×900 and 1280×800 are now asserted on every
  `npm test`: two columns, a 52px header, an input field of at least 300px, a
  usable body in every instrument, no horizontal scroll.
- `?craft#logstrip` — both states of the activity strip on the craft page.

### Changed

- **The matrix is drawn, not typeset.** It started as braille glyphs (U+2800–28FF):
  cheap, and it inherits colour for free — but a braille dot is ~14% of its font
  size and the cell carries wide side bearings, so the dot stayed 3px wide however
  big the type got, and the horizontal rhythm came out uneven (11px inside a cell,
  19px between cells at 44px). The strip is now a single SVG path of zero-length
  segments with round caps: the same braille *cadence* (6 × 4.5px per dot cell),
  but dot size and spacing are ours to set (3.2px dots).
- **Quiet labels are readable.** Zone state blocks and the new strip's key sat at
  `--g2` on `--g1` — 3.1:1, below AA for 11px text. They now use `--t3` (a 70%
  white mix), ≥ 6.6:1 in all nine themes, and `check-themes.mjs` checks that pair
  on every theme (it gained `color-mix` support to do it).
- **Narrower desktops get their width back.** At 1280 the header's subtitle used
  to wrap (66px of content in a 52px box), the quick-pad column squeezed the input
  field to 248px, and the STREAM left column left the terminal 292px. The header is
  a fixed 52px band with single-line truncation, `cmd-aux` drops to 272px at
  ≤1400 (field: 312px), and the STREAM column is `clamp(280px, 38%, 360px)`
  (terminal: 372px). The thinking strip's tail readouts drop by *instrument* width
  (container query), not viewport width.
- **Internal, no behaviour change:** one file per station (`views/stations/*`,
  `views/console/*`), the 31 endpoints split into seven route modules, the pure
  readouts moved to `src/format.ts` and the IME gate to `src/ime.ts`:
  `Console.tsx` 2767 → 619 lines, `server/index.mjs` 795 → 295. Deleted `demo/`
  (2173 unreachable lines), nine unused icons, dead CSS and five dead server
  exports; `noUnusedLocals` is on.

### Fixed

- **A 30px hole under the STREAM elbow.** The band carried a 14px margin to make
  room for the instrument's leg, but the leg was only drawn on the body below it,
  so the rail broke right under the fillet and each instrument looked cut in half.
  The leg is now a border on the wrapper that owns both the band and the body.
- **The elbow's width.** The curve was 28px wide against a 34px numeral block,
  which left a 6px step under the block; the arm now matches the block and the
  block's bottom-right corner is square.
- **The activity strip's control moved the composer.** `LATEST` used to be an
  in-flow 32px bar: scrolling away shoved the input up by 32px mid-draft. It is
  now an absolute overlay over the transcript (`.scroll-wrap`), so nothing moves.
- **Dots at 3px read as texture.** The idle phase filled 9% of a 320-cell grid —
  on the finer drawn grid the same share of dots would have been one dot every
  30px, so the density follows the grid (9% of 8 rows).

### Notes

- No configuration, environment or API changes: sessions, providers, MCP servers,
  themes and keybindings carry over untouched.
- Node >= 22.19, unchanged.
- Test gate: 9 theme palettes × 12 contrast pairs + 18 + 12 + 29 + 27 + 66 + 28
  checks + 193 UI checks (`npm test`).

## Before 0.4.0

0.1 – 0.3.2 were the build-out: the SDK-backed session registry and SSE stream,
providers / MCP / skills / history stations, Markdown + diff + sub-agent rows,
six themes, bundled typefaces, the launcher (`pi-lcars doctor|status|stop`), and
the share bundle. `git log` is the record; releases were tagged by their
`release: x.y.z` commits.
