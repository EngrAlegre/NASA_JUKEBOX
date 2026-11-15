#!/usr/bin/env node
/*
 * Point the document at its real address.
 *
 *   node tools/set-url.js https://user.github.io/earth-jukebox/
 *
 * Social crawlers ignore relative og:image URLs, so before publishing the card
 * and the canonical link have to be absolute. This rewrites those two lines and
 * nothing else, and refuses to run without a scheme.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const raw = process.argv[2];

if (!raw) {
  console.error("usage: node tools/set-url.js https://example.com/path/");
  process.exit(2);
}

let base = raw.trim();
if (!/^https?:\/\//i.test(base)) {
  console.error("the address must start with http:// or https://");
  process.exit(2);
}
if (!base.endsWith("/")) base += "/";

const file = path.join(ROOT, "index.html");
let html = fs.readFileSync(file, "utf8");
const before = html;

html = html.replace(
  /<link rel="canonical" href="[^"]*">/,
  `<link rel="canonical" href="${base}">`
);
html = html.replace(
  /(<meta property="og:image" content=")[^"]*(">)/,
  `$1${base}og.png$2`
);
html = html.replace(
  /(<meta name="twitter:image" content=")[^"]*(">)/,
  `$1${base}og.png$2`
);

if (html === before) {
  console.error("nothing matched — has index.html been edited?");
  process.exit(1);
}

fs.writeFileSync(file, html);

// Report what the crawler will now see, so the change can be eyeballed.
for (const m of html.matchAll(/<(?:meta|link)[^>]+(?:og:image|twitter:image|canonical)[^>]*>/g)) {
  console.log("  " + m[0].trim());
}
console.log(`\nindex.html now points at ${base}`);
console.log("Check the card at https://cards-dev.twitter.com/validator or the Facebook debugger.");
