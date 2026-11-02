#!/usr/bin/env node
/**
 * Build the share bundle — one folder you can hand to somebody else.
 *
 *   npm run release            → release/
 *
 * `release/` is generated and gitignored: the only copy of the installer text
 * lives here, so the bundle can never drift from the package it installs.
 *
 * What lands in it:
 *   pi-lcars-<version>.tgz          the npm package (bin + server + dist)
 *   install.command                 macOS / Linux, double-click or `bash install.command`
 *   install.ps1                     Windows, `powershell -ExecutionPolicy Bypass -File install.ps1`
 *   README.txt                      what it is, what it needs, how to remove it
 *   pi-lcars-<version>-share.tar.gz the whole folder in one file to send
 *
 * The installers install into a user-owned prefix (never sudo, never the
 * system npm root) and then run `pi-lcars doctor`, because the console is a
 * client: without pi on the machine there is nothing to talk to.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "release");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const MIN_NODE = "22.19";

/* ------------------------------------------------------------ the tarball */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
// `npm pack` runs prepack → vite build, so dist/ is rebuilt from the working
// tree by definition; a bundle can never ship a stale client.
execFileSync("npm", ["pack", "--pack-destination", OUT, "--silent"], { cwd: ROOT, stdio: "inherit" });
const TGZ = `pi-lcars-${pkg.version}.tgz`;

/* ---------------------------------------------------------- install.command */
const sh = `#!/bin/bash
# pi-lcars ${pkg.version} — one-click install (macOS / Linux)
#
#   double-click this file on macOS, or:  bash install.command
#   options:  --prefix DIR   install here instead of ~/.pi-lcars
#             --bin-dir DIR  put the command here instead of /usr/local/bin or ~/.local/bin
#             --no-link      do not touch your PATH
#             --no-doctor    skip the pi backend check
#
# It installs into a folder you own, so no sudo and no writes to the system
# npm root. Re-running it upgrades in place.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX="\${PI_LCARS_PREFIX:-$HOME/.pi-lcars}"
BIN_DIR=""
LINK=1
DOCTOR=1

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX="\${2:-}"; shift 2 ;;
    --bin-dir) BIN_DIR="\${2:-}"; shift 2 ;;
    --no-link) LINK=0; shift ;;
    --no-doctor) DOCTOR=0; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$PREFIX" ] || { echo "  --prefix needs a directory" >&2; exit 2; }

say()  { printf '%s\\n' "$*"; }
fail() { printf '\\n  %s\\n\\n' "$*" >&2; exit 1; }

say ""
say "  pi-lcars ${pkg.version} — installer"
say "  ------------------------------------------"

# 1. node: the console is a node program, and pi itself needs >= ${MIN_NODE}
command -v node >/dev/null 2>&1 || fail "node is not on PATH.
  pi-lcars needs Node >= ${MIN_NODE}: https://nodejs.org (or \`brew install node\`)."
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)' \\
  || fail "Node $(node -v) is too old.
  pi-lcars needs >= ${MIN_NODE}. Upgrade: https://nodejs.org"
say "  node        $(node -v)"

command -v npm >/dev/null 2>&1 || fail "npm is not on PATH (it ships with Node)."
say "  npm         $(npm -v)"

# 2. the package itself
[ -f "$HERE/${TGZ}" ] || fail "${TGZ} is missing from this folder.
  Re-download the share bundle, or copy the .tgz next to this script."
say "  package     ${TGZ} ($(du -h "$HERE/${TGZ}" | cut -f1 | tr -d ' '))"

say "  prefix      $PREFIX"
mkdir -p "$PREFIX" || fail "cannot create $PREFIX"
npm install -g --prefix "$PREFIX" "$HERE/${TGZ}" >/dev/null 2>&1 \\
  || fail "npm install failed. Run it by hand to see why:
  npm install -g --prefix \\"$PREFIX\\" \\"$HERE/${TGZ}\\""

BIN="$PREFIX/bin/pi-lcars"
[ -x "$BIN" ] || fail "installed, but $BIN is missing — npm layout changed?"

# 3. put it on PATH: /usr/local/bin when writable, otherwise ~/.local/bin
if [ "$LINK" = 1 ]; then
  TARGET=""
  if [ -n "$BIN_DIR" ]; then
    candidates=("$BIN_DIR")
  else
    candidates=("/usr/local/bin" "$HOME/.local/bin")
  fi
  for dir in "\${candidates[@]}"; do
    if mkdir -p "$dir" 2>/dev/null && [ -w "$dir" ]; then
      if ln -sf "$BIN" "$dir/pi-lcars" 2>/dev/null; then TARGET="$dir/pi-lcars"; break; fi
    fi
  done
  if [ -n "$TARGET" ]; then
    say "  command     $TARGET"
    case ":$PATH:" in
      *":$(dirname "$TARGET"):"*) ;;
      *) say ""
         say "  $(dirname "$TARGET") is not on your PATH yet. Add this to ~/.zshrc or ~/.bashrc:"
         say "    export PATH=\\"$(dirname "$TARGET"):\\$PATH\\"" ;;
    esac
  else
    say "  command     $BIN (no writable bin folder — call it by full path,"
    say "              or add $PREFIX/bin to PATH)"
  fi
fi

# 4. the backend: without pi there is nothing to talk to, so say so now
if [ "$DOCTOR" = 1 ]; then
  say ""
  say "  checking the pi backend"
  if "$BIN" doctor; then
    say ""
    say "  ready."
  else
    say ""
    say "  Installed. The console will start, but it needs the pi backend above"
    say "  (install it, then run \`pi\` once so it writes settings.json)."
  fi
fi

say ""
say "  next:"
say "    pi-lcars              start the console for the current folder"
say "    pi-lcars status       list running instances"
say "    pi-lcars doctor       re-check the pi backend"
say "    pi-lcars --version    version + build time of this bundle"
say ""
say "  remove it:"
say "    rm -f \\"$HOME/.local/bin/pi-lcars\\" /usr/local/bin/pi-lcars"
say "    rm -rf \\"$PREFIX\\""
say ""
`;

/* ------------------------------------------------------------ install.ps1 */
const ps1 = `# pi-lcars ${pkg.version} — one-click install (Windows)
#
#   right-click → "Run with PowerShell", or:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# Installs into %LOCALAPPDATA%\\pi-lcars (no admin rights), then checks that the
# pi backend is present. Override the location with $env:PI_LCARS_PREFIX.
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = if ($env:PI_LCARS_PREFIX) { $env:PI_LCARS_PREFIX } else { Join-Path $env:LOCALAPPDATA "pi-lcars" }

Write-Host ""
Write-Host "  pi-lcars ${pkg.version} — installer"
Write-Host "  ------------------------------------------"

# 1. node / npm
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "node is not on PATH. pi-lcars needs Node >= ${MIN_NODE}: https://nodejs.org"
}
$raw = (& node -v).Trim().TrimStart("v")
$parts = $raw.Split(".")
if ([int]$parts[0] -lt 22 -or ([int]$parts[0] -eq 22 -and [int]$parts[1] -lt 19)) {
  throw "Node v$raw is too old — pi-lcars needs >= ${MIN_NODE}."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is not on PATH (it ships with Node)." }
Write-Host "  node        v$raw"
Write-Host "  npm         $(& npm -v)"

# 2. the package
$tgz = Get-ChildItem -Path $here -Filter "pi-lcars-*.tgz" | Select-Object -First 1
if (-not $tgz) { throw "${TGZ} is missing from this folder." }
Write-Host "  package     $($tgz.Name)"
Write-Host "  prefix      $prefix"

& npm install -g --prefix "$prefix" "$($tgz.FullName)"
if ($LASTEXITCODE -ne 0) { throw "npm install failed — run it by hand to see why." }

$cmd = Join-Path $prefix "pi-lcars.cmd"
if (-not (Test-Path $cmd)) { throw "installed, but $cmd is missing." }

# 3. PATH for this user (idempotent)
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $userPath) { $userPath = "" }
if ($userPath -notlike "*$prefix*") {
  [Environment]::SetEnvironmentVariable("Path", ($userPath.TrimEnd(";") + ";" + $prefix), "User")
  Write-Host "  command     added $prefix to your user PATH — open a new terminal to use \`pi-lcars\`"
} else {
  Write-Host "  command     $cmd"
}

# 4. the pi backend
Write-Host ""
Write-Host "  checking the pi backend"
& $cmd doctor
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  Installed. The console will start, but it needs the pi backend above."
}
Write-Host ""
Write-Host "  next:    pi-lcars           start the console for the current folder"
Write-Host "           pi-lcars status    list running instances"
Write-Host "           pi-lcars doctor    re-check the pi backend"
Write-Host ""
Write-Host "  remove:  npm uninstall -g --prefix \\"$prefix\\" pi-lcars"
Write-Host ""
`;

/* --------------------------------------------------------------- README */
const banner = `pi-lcars ${pkg.version}`;
const readme = `${banner}
${"=".repeat(banner.length)}

An LCARS console for the pi coding agent: one command starts a local web UI and
the in-process pi backend, then opens your browser. It is a client — all the
work still happens in pi (sessions, tools, approvals), the console just shows
it the way a TNG bridge would.

Everything runs on your machine: the server binds 127.0.0.1, there is no
telemetry and no account. Nothing from this bundle talks to the network except
pi itself (model calls, web search, MCP servers you configure).


WHAT THIS FOLDER HOLDS
----------------------
  pi-lcars-${pkg.version}.tgz       the npm package (bin + server + dist)
  install.command            macOS / Linux installer
  install.ps1                Windows installer
  README.txt                 this file


BEFORE YOU START
----------------
1. Node >= ${MIN_NODE}                     https://nodejs.org
   macOS with Homebrew:  brew install node
   Check:                node -v

2. The pi coding agent               (this console has no model of its own)
   macOS / Linux:  curl -fsSL https://pi.dev/install.sh | sh
   Windows:        powershell -c "irm https://pi.dev/install.ps1 | iex"
   then run \`pi\` once so it writes ~/.pi/agent/settings.json, and sign in to
   the provider you want to use.

   Installed it somewhere unusual? Point PI_SDK at the SDK folder, or leave it
   alone as long as it lives under ~/.pi/agent/install/releases/.


INSTALL
-------
macOS / Linux
   Double-click install.command, or:
       bash install.command
   It installs into ~/.pi-lcars (no sudo), links the \`pi-lcars\` command into
   /usr/local/bin or ~/.local/bin, then runs \`pi-lcars doctor\`.

   Options:  --prefix DIR   install elsewhere
             --bin-dir DIR  link the command somewhere else
             --no-link      do not touch PATH
             --no-doctor    skip the backend check

Windows
   Right-click install.ps1 -> "Run with PowerShell", or:
       powershell -ExecutionPolicy Bypass -File install.ps1
   It installs into %LOCALAPPDATA%\\pi-lcars and adds that folder to your user
   PATH (open a new terminal afterwards).

Manual, if you would rather do it yourself:
       npm install -g ./pi-lcars-${pkg.version}.tgz


RUN
---
       cd ~/some/project        # the folder you want the agent to work in
       pi-lcars                 # start; opens http://127.0.0.1:4173

       pi-lcars status          # list running instances (pid / url / cwd)
       pi-lcars stop [--port N] # stop one
       pi-lcars doctor          # what pi it found, and what to fix if not
       pi-lcars --dev           # source checkout only: vite HMR on :5173
       pi-lcars --version       # version + build time of this bundle

The working directory is fixed per session: pick it when you create a session
(NEW SESSION opens a folder picker). Port 4173 is tried first; if it is taken
the launcher walks up to 4189 and prints the URL it actually got.


REMOVE
------
macOS / Linux
       rm -f ~/.local/bin/pi-lcars /usr/local/bin/pi-lcars
       rm -rf ~/.pi-lcars

Windows
       npm uninstall -g --prefix "%LOCALAPPDATA%\\pi-lcars" pi-lcars
       (then remove that folder from PATH in System Properties)

Your sessions and settings live in the pi agent directory
(~/.pi/agent), not in this bundle — removing pi-lcars does not touch them.


LICENCES
--------
pi-lcars is MIT (see the LICENSE inside the npm package).

Three typefaces ship with it, all SIL OFL 1.1, unmodified and under their
original file names:
       D-DIN 400/700              labels, numerals, readouts
       IBM Plex Mono 400/600      commands, paths, diffs
       Michroma 400               wordmark, cycle numerals
Their licence texts travel with the fonts (OFL-*.txt) and are also inside the
package at dist/fonts/.

Star Trek and LCARS are trademarks of Paramount/CBS. This is an unaffiliated
fan project: no original artwork or footage is included, and the layout is a
re-implementation from public descriptions. pi is a separate project with its
own authors and licence.
`;

/* -------------------------------------------------------------------- write */
writeFileSync(join(OUT, "install.command"), sh);
chmodSync(join(OUT, "install.command"), 0o755);
writeFileSync(join(OUT, "install.ps1"), ps1);
writeFileSync(join(OUT, "README.txt"), readme);

/* one file to send: archive in a temp dir, then move it in (a tarball cannot
   include itself while it is being written) */
const archive = `pi-lcars-${pkg.version}-share.tar.gz`;
const staged = join(tmpdir(), archive);
rmSync(staged, { force: true });
execFileSync("tar", ["-czf", staged, "-C", OUT, "."], { stdio: "inherit" });
copyFileSync(staged, join(OUT, archive));
rmSync(staged, { force: true });

for (const f of [TGZ, "install.command", "install.ps1", "README.txt", archive]) {
  const size = execFileSync("du", ["-h", join(OUT, f)], { encoding: "utf8" }).split("\t")[0];
  process.stdout.write(`  ${f.padEnd(40)} ${size}\n`);
}
process.stdout.write(`\n  release/ is ready — send it, or send just ${archive}\n\n`);
