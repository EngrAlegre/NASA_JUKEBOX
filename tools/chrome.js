/*
 * Find a Chromium for the headless tools, on any platform.
 *
 * Order of preference: an explicit CHROME_PATH, then Playwright's bundled
 * browsers (which is what this project was developed against), then whatever
 * Chrome/Edge/Chromium is installed system-wide. CI runners (GitHub Actions)
 * ship google-chrome, so that case is covered too.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const CANDIDATES = [
  process.env.CHROME_PATH,
  // Playwright's cache — macOS and Linux layouts are included so the same
  // checkout works for a teammate on a different machine.
  ...["1234", "1223", "1217"].flatMap((build) => [
    path.join(os.homedir(), "AppData", "Local", "ms-playwright", `chromium-${build}`, "chrome-win64", "chrome.exe"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright", `chromium-${build}`, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    path.join(os.homedir(), ".cache", "ms-playwright", `chromium-${build}`, "chrome-linux", "chrome"),
  ]),
  // System browsers.
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function findChrome() {
  for (const candidate of CANDIDATES) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* unreadable path */ }
  }
  throw new Error(
    "No Chromium found. Set CHROME_PATH to a Chrome/Edge/Chromium binary, or run " +
    "`npx playwright install chromium`."
  );
}

// Flags the headless tools share. `--mute-audio` keeps CI quiet; the autoplay
// policy lets the QA harness start playback without a real user gesture.
const BASE_ARGS = [
  "--headless=new",
  "--disable-gpu",
  "--mute-audio",
  "--no-first-run",
  "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
];

module.exports = { findChrome, BASE_ARGS };
