# Deploying

The repository **is** the site: static HTML, CSS, JS, and a folder of frames. No
build step, no bundler, no server-side code, no environment variables. Anything
that can serve files can host it.

```bash
python tools/serve.py          # local, http://127.0.0.1:8177
```

The one requirement is **HTTP** rather than `file://`: browsers refuse to expose
canvas pixels for images loaded from disk, and reading those pixels is the whole
instrument. The app detects the mistake and says so.

---

## If GitHub Actions are blocked

A GitHub account with a **billing lock** will not start any workflow — the job
fails before it runs, with `The job was not started because your account is
locked due to a billing issue.` Nothing in the repository causes that. Two ways
around it:

**Pages without Actions.** Settings → Pages → **Deploy from a branch** → `main` /
`/ (root)`. That path does not consume Actions and does not run the workflow. The
`CNAME` file in this repository already claims `fivesides.site`, so the custom
domain works as soon as DNS points at GitHub:

| Type | Name | Value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `engralegre.github.io` |

**Or skip GitHub entirely.** Netlify takes the same folder and does not care
about your GitHub billing: drag `dist/` onto <https://app.netlify.com/drop>, then
add `fivesides.site` as a custom domain and follow the DNS records it prints.
Netlify also serves the security headers and cache policy from `netlify.toml`,
which Pages cannot do (the `<meta>` CSP still applies there).

## Pick a host

| Host | Command | Notes |
|---|---|---|
| **GitHub Pages** | enable Pages → Source: *GitHub Actions*, push to `main` | `.github/workflows/pages.yml` runs the engine tests and the browser checks *before* publishing. Serves from a subpath (`/repo-name/`) — the app uses relative paths throughout, so this works unchanged. |
| **Netlify** | `npx netlify deploy --prod --dir=.` | `netlify.toml` sets the security headers, CSP and cache policy. No build command. |
| **Vercel** | `npx vercel --prod` | `vercel.json` carries the same headers. |
| **Cloudflare Pages** | connect the repo, build command empty, output directory `/` | Reads `_headers`; if you want the headers, copy the block from `netlify.toml` into a `_headers` file at the root. |
| **Docker / any VPS** | `docker build -t earth-jukebox . && docker run -p 8080:80 earth-jukebox` | `nginx.conf` mirrors the same headers and cache rules, gzip on. |
| **Anything else** | copy the folder | Only the files listed under "What to publish" are needed. |

## What to publish

Everything except the development and reproducibility machinery:

```
index.html   styles.css   404.html   manifest.webmanifest   og.png
src/         data/        audio/     docs/
```

Optional: `README.md`, `LICENSE`.

**Not** needed (excluded by `.dockerignore`, ignored by git where appropriate):
`.cache/` (hundreds of MB of downloaded NASA video), `tests/`, `tools/`,
`audio/*.wav`, `.git/`.

`tools/serve.py` will happily serve the whole folder, which is what you want
locally.

## After the first deploy

1. **Set the real address**, so link previews resolve:

   ```bash
   node tools/set-url.js https://your-host/your-path/
   ```

   This rewrites the `<link rel="canonical">` and the two `og:image` URLs from
   relative paths to absolute ones. Crawlers ignore relative preview images;
   browsers do not, which is why it is a post-deploy step rather than a build
   step. Commit the change.

2. **Check the preview card** with a social debugger (Facebook Sharing Debugger,
   `cards-dev.twitter.com/validator`) or by pasting the URL into a chat app.

3. **Run the same checks against production**, not just localhost:

   ```bash
   node tools/qa.js https://your-host/your-path/
   ```

   It exercises the accessibility tree, keyboard, the real Export button,
   reduced motion and load timing, and writes `docs/qa-report.json`.

4. **Confirm the headers** actually arrived:

   ```bash
   curl -sI https://your-host/your-path/ | grep -i -E 'content-security|cache-control|x-content-type'
   ```

## Hosting notes worth knowing

- **The live tuner needs `gibs.earthdata.nasa.gov`.** The CSP allows exactly that
  origin in `img-src` and `connect-src`. GIBS sends
  `Access-Control-Allow-Origin: *`, so frames can be read from any origin; if a
  proxy or firewall strips that header, the five local records still work and the
  tuner reports the failure in the panel.
- **No service worker.** Deliberate: caching 9.6 MB of frames behind a service
  worker creates a stale-content problem for a project that changes often, and
  the app already works offline-ish once loaded from a local folder. If you want
  one, cache `index.html`, `styles.css`, `src/*`, `data/*` with a versioned cache
  name and treat `audio/` as network-only.
- **Bandwidth.** First load is ~1.5 MB (18 frames of the first record, ~500 KB of
  code, no fonts). Switching records adds ~1.5 MB each. `audio/` (6.3 MB of MP3)
  is only fetched if someone opens a liner note and presses play.
- **`_headers` on Cloudflare Pages**: the file is read from the output directory,
  so add one if you want the CSP as a header rather than only the `<meta>` tag.
  The meta tag already enforces it in every browser that supports it, which is
  why the app is safe even on hosts where you cannot set headers at all.
- **Subpath deployments are fine.** Every URL in `index.html` is relative
  (`styles.css`, `src/app.js`, `data/records.js`, `audio/*.mp3`). Only the
  canonical/`og:image` lines are absolute, and `tools/set-url.js` sets those.

## Rollback

There is no database and no state: redeploying an earlier commit *is* the
rollback. On Netlify/Vercel use the deploy history; on GitHub Pages re-run the
workflow from an earlier commit or `git revert` and push.

## Verifying a deployment from scratch

```bash
git clone <repo> && cd <repo>
node tests/engine.test.js          # 59 assertions, no dependencies
python tools/serve.py &            # http://127.0.0.1:8177
node tools/qa.js                   # 18 browser checks
node tools/render_sides.js         # five WAVs in audio/
```

If those four pass, the site will deploy anywhere that serves files.
