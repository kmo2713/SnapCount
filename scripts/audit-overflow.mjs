/**
 * Checks that nothing on a phone scrolls sideways.
 *
 * Run against a dev server: `npm run dev`, then `npm run audit:overflow`.
 *
 * The rule this enforces is that a phone scrolls up and down only. Vertical
 * space is free — you can always scroll further — but horizontal space is
 * fixed, so anything wider than the screen is content you cannot reach without
 * a gesture nobody makes. Each view is therefore expected to have a layout
 * that fits, not a layout that scrolls.
 *
 * ## How it works, and why it is a browser rather than a linter
 *
 * Overflow is not visible in the source. A table fits or does not depending on
 * the longest team name in the data, the font, and how the browser distributes
 * column widths — none of which a static check can know. So this loads the real
 * app in a real browser at real phone widths, walks every tab, and measures.
 *
 * Two numbers matter per view:
 *
 *  - `scrollWidth > clientWidth` on the scrolling pane — the pane can be
 *    dragged sideways.
 *  - any element whose right edge sits past the pane's right edge — something
 *    is rendering off-screen even if the pane itself cannot scroll.
 *
 * The second is what catches a layout hidden behind `overflow: hidden`, which
 * is why the clamp in globals.css does not blind this.
 *
 * A known, benign exception is reported rather than hidden: a classic
 * scrollbar occupies width that `clientWidth` excludes and `scrollWidth`
 * includes, so a pane can report a few pixels of overflow with nothing
 * actually off-screen. Phones use overlay scrollbars and never see it, so a
 * run is only failed when something genuinely renders past the edge, or the
 * pane overflows by more than a scrollbar's width.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT, "public");
const HARNESS = join(PUBLIC_DIR, "__overflow-audit.html");

const BASE = process.env.AUDIT_URL ?? "http://localhost:3000";
const WIDTHS = (process.env.AUDIT_WIDTHS ?? "320,390,430").split(",").map(Number);

/** Wider than this and it is a layout problem, not a scrollbar. */
const SCROLLBAR_SLACK = 16;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

function findChrome() {
  for (const path of CHROME_CANDIDATES) if (existsSync(path)) return path;
  throw new Error(
    `Could not find Chrome. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join("\n  ")}`,
  );
}

/*
 * The harness runs inside the page because that is the only place the
 * measurements exist. It reports into a <pre> that --dump-dom hands back.
 */
const harnessHtml = `<!doctype html>
<title>overflow audit</title>
<style>iframe{border:0;position:absolute;left:-9999px;height:844px}</style>
<iframe id="f"></iframe>
<pre id="out">running</pre>
<script>
const P = new URLSearchParams(location.search);
const f = document.getElementById("f");
const out = document.getElementById("out");
f.style.width = (P.get("w") || 390) + "px";
f.src = P.get("path") || "/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const desc = (el) => {
  const cls = typeof el.className === "string" && el.className
    ? "." + el.className.trim().split(/\\s+/).slice(0, 3).join(".")
    : "";
  const text = (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 44);
  return el.tagName.toLowerCase() + cls + ' "' + text + '"';
};

function measure(label, lines) {
  const d = f.contentDocument;
  const w = f.contentWindow;
  // The gameday route scrolls its own element; the dashboard uses .sc-content.
  const pane = d.querySelector(".sc-content") || d.querySelector(".sc-gameday");
  if (!pane) { lines.push("FAIL " + label + ": no scrolling pane found"); return; }

  const over = pane.scrollWidth - pane.clientWidth;
  const right = pane.getBoundingClientRect().right;

  const past = [];
  for (const el of pane.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > right + 1) past.push(desc(el) + " [+" + Math.round(r.right - right) + "px]");
  }

  const scrollers = [];
  for (const el of pane.querySelectorAll("*")) {
    if (el.scrollWidth - el.clientWidth <= 1 || el.clientWidth <= 0) continue;
    const ox = w.getComputedStyle(el).overflowX;
    if (ox === "auto" || ox === "scroll") {
      scrollers.push(desc(el) + " [" + el.clientWidth + " -> " + el.scrollWidth + "]");
    }
  }

  lines.push("VIEW " + label + " over=" + over + " past=" + past.length + " scrollers=" + scrollers.length);
  for (const s of scrollers.slice(0, 4)) lines.push("  SCROLLER " + s);
  for (const s of past.slice(0, 4)) lines.push("  PAST " + s);
}

(async () => {
  await new Promise((r) => f.addEventListener("load", r, { once: true }));
  await sleep(3500);
  const lines = [];
  const navs = Array.from(f.contentDocument.querySelectorAll(".sc-nav-btn"));
  if (navs.length === 0) {
    measure(P.get("path") || "/", lines);
  } else {
    // The dialog menu holds a second copy of every nav button; the first of
    // each label is the one in the rail.
    const seen = new Set();
    for (const nav of navs) {
      const label = (nav.textContent || "?").trim();
      if (seen.has(label)) continue;
      seen.add(label);
      nav.click();
      await sleep(850);
      measure(label, lines);
    }
  }
  out.textContent = "BEGIN\\n" + lines.join("\\n") + "\\nEND";
})().catch((e) => { out.textContent = "BEGIN\\nFAIL harness: " + e.message + "\\nEND"; });
</script>
`;

function run(chrome, url) {
  const html = execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--window-size=1000,900",
      "--virtual-time-budget=60000",
      "--dump-dom",
      url,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
  const body = html.split("BEGIN")[1]?.split("END")[0];
  if (!body) throw new Error(`No audit output from ${url}`);
  return body.trim().split("\n").map((l) => l.trim()).filter(Boolean);
}

function main() {
  const chrome = findChrome();
  mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(HARNESS, harnessHtml);

  let failures = 0;
  try {
    for (const width of WIDTHS) {
      for (const path of ["/", "/gameday"]) {
        console.log(`\n--- ${width}px ${path} ---`);
        const lines = run(
          chrome,
          `${BASE}/__overflow-audit.html?w=${width}&path=${encodeURIComponent(path)}`,
        );

        let current = "";
        for (const line of lines) {
          if (line.startsWith("VIEW ")) {
            const over = Number(/over=(-?\d+)/.exec(line)?.[1] ?? 0);
            const past = Number(/past=(\d+)/.exec(line)?.[1] ?? 0);
            const scrollers = Number(/scrollers=(\d+)/.exec(line)?.[1] ?? 0);
            current = line.slice(5).split(" over=")[0];
            const bad = past > 0 || scrollers > 0 || over > SCROLLBAR_SLACK;
            if (bad) {
              failures++;
              console.log(`  FAIL  ${current}  (${line.split(" ").slice(-3).join(" ")})`);
            } else {
              console.log(`  ok    ${current}`);
            }
          } else if (line.startsWith("  SCROLLER") || line.startsWith("SCROLLER")) {
            console.log(`          ${line.replace(/^\s*/, "")}`);
          } else if (line.startsWith("PAST") || line.startsWith("  PAST")) {
            console.log(`          ${line.replace(/^\s*/, "")}`);
          } else if (line.startsWith("FAIL")) {
            failures++;
            console.log(`  ${line}`);
          }
        }
      }
    }
  } finally {
    rmSync(HARNESS, { force: true });
  }

  console.log(
    failures === 0
      ? "\nNothing scrolls sideways."
      : `\n${failures} view(s) scroll sideways or render past the edge.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main();
