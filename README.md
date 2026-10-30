# playground.rok-lang.org

Source for https://playground.rok-lang.org, the browser playground for Rok. The page sends source to this server, which compiles it with `rokc --target=wasm32-unknown-unknown` and returns the module; the page runs it in a Web Worker. The server is written in Rok.

- Programs are one file, with no files, network, or threads (those calls fail with `Unsupported`), and stop after 10 seconds.
- The page keeps the visitor's code in the browser's `localStorage` (edits to each example too, until Reset example). The server keeps source only when Share asks it to: `POST /api/share` stores it under `PLAY_SHARES` as `<id>.rok`, the id being the first 50 bits of its SHA-256 in base32, and `/p/<id>` opens the page with it. A stored file is never rewritten, compiled or run by the server. When the server cannot store it, Share puts the deflated source in the link's `#code=` fragment instead (`#src=`, plain base64url, in browsers without deflate-raw).
- An example has its own address, `/#example=<name>` (its file name in `static/examples/`, without `.rok`). A link's or a share's address lasts until the first edit; then the address goes back to `/`.
- Compiled modules are cached by SHA-256 of level + source.

## Run it locally

Needs a Rok toolchain with the `wasm32-unknown-unknown` runtime (release archives ship it; from source, `targets/build.sh wasm32-unknown-unknown`), and the [web kit](https://github.com/rok-lang/web) submodule at `web/`:

```bash
git clone --recurse-submodules https://github.com/rok-lang/playground.rok-lang.org.git
cd playground.rok-lang.org      # or, in a clone made without it: git submodule update --init
rok build
PLAY_ROKC=~/.rok/toolchains/<version>-aarch64-apple-darwin/bin/rokc ./target/debug/rok_playground
# http://127.0.0.1:8405
```

Without `PLAY_WRAP` the server only listens on loopback: an unsandboxed rokc could be made to read the machine's files.

## Web kit

`web/` is [rok-lang/web](https://github.com/rok-lang/web), pinned to a commit. The server builds its `web` library in (`Dep::path("web/rok")`): HTTP, the canonical-address 301s, and the kit's files, served at `/rok.css`, `/theme.js` (also as `/theme-init.js`, its old name), `/logo.svg`, `/rok.svg`, `/favicon.ico` and `/apple-touch-icon.png`. The webfonts are files, not built in: `/fonts/...` comes from `web/assets/fonts` relative to the working directory (a day, with an ETag), so a deploy ships that directory beside `static/`. `static/index.html` and `static/404.html` hold `<!--web:fonts-->` (the font preloads), `<!--web:theme-button-->`, `<!--web:header-sites-->`, `<!--web:credits-->`, `<!--web:social-->`, `<!--web:theme-seg-->` and `<!--web:not-found-->`, which the server fills from the kit's markup (the sites, licence and credit, social links and theme switch go in the header and its menu; the 404 body is the one every Rok site shares). Move to a newer kit with:

```bash
git submodule update --remote web
rok build && rok test
git commit -am "chore: bump the web kit"
```

## Link previews

`static/index.html` points og:image and twitter:image at `og.png?v=dev`; the server puts the first 10 hex digits of og.png's SHA-256 (hashed at start) in place of `dev`, so a new image is a new URL. Pages name their stylesheets and scripts the same way (`/play.js?v=<first 10 hex digits of its SHA-256>`, filled in per request). A file asked for by its current `?v=` is cached for a year (`immutable`); a page for five minutes; anything else is revalidated each time. Every file answer carries an ETag of its content and answers `If-None-Match` with 304. When only a page's text changes, the cached card stays: re-scrape it with the [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/), the [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) or Kakao's [sharing debugger](https://developers.kakao.com/tool/debugger/sharing) (clear the cache); X has no tool and refreshes in about 7 days.

## Settings

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PLAY_ADDR` | `127.0.0.1:8405` | Where to listen |
| `PLAY_ROKC` | `rokc` | The compiler (the toolchain's own `bin/rokc`, not the proxy) |
| `PLAY_MJS` | `<rokc dir>/../lib/rok/targets/wasm32-unknown-unknown/rok.mjs` | JS host served at `/rok.mjs` |
| `PLAY_SITE` | `../rok-lang.org/static` | Fallback for static files in neither `static/` nor the kit |
| `PLAY_WRAP` | (none) | Sandbox command rokc runs under (see Deploy) |
| `PLAY_WORK` | `<temp>/rok-playground` | Job directories and module cache |
| `PLAY_JOBS` | `2` | Compiles at a time |
| `PLAY_TIMEOUT` | `20` | Seconds a compile may take |
| `PLAY_RATE` | `30` | Compiles a minute per client |
| `PLAY_SHARES` | `<PLAY_WORK>/shares` | Stored share links; must be writable and should outlive restarts |
| `PLAY_SHARE_RATE` | `10` | Share links a minute per client |
| `PLAY_SHARE_MAX` | `100000` | Share links kept; past it new ones are refused (Share falls back to `#code=`) |

The compile API is `POST /api/compile?opt=0` (body: UTF-8 source, max 64 KiB) returning `application/wasm`, or rokc's diagnostics as text with an `X-Rok-Diagnostics: 1` header (both 200; 4xx/5xx only for the request itself). `POST /api/fmt` takes the same body and returns it as `rokc fmt` lays it out (run in a job directory under `PLAY_WRAP`, like a build, stopped after 5 s), or its diagnostics the same way. `POST /api/share` takes the same body and returns the short link's id (`GET /api/share/<id>` gives the source back, `/p/<id>` the page); see `src/main.rok`. Other paths answer 404 with `static/404.html`.

## Deploy (Linux)

rokc can read any file it reaches at compile time, so a sandbox is what keeps the machine's files out of reach. Pick one for `PLAY_WRAP`.

- Docker (recommended): `scripts/docker-sandbox.sh` runs each compile in a throwaway container with the job directory as the only writable mount, no network, read-only root, and cgroup memory/CPU caps. Build the image from an unpacked Linux release archive:

```sh
docker build -t rok-playground:current \
  --build-arg TOOLCHAIN=rok-<version>-x86_64-unknown-linux-gnu \
  -f scripts/Dockerfile <dir holding the unpacked toolchain>
```

Tune with `PLAY_IMAGE`, `PLAY_MEM` (default `4g`), `PLAY_CPUS` (default `2`); the service user must run `docker`. Put a TLS reverse proxy in front that sets `X-Forwarded-For`.

- bubblewrap (lighter, no daemon): `scripts/sandbox.sh` runs each compile under bwrap with only the job directory writable, no network, and prlimit caps. Real memory still needs a cgroup cap, so run the service with `MemoryMax=6G`.

## Layout

| File | Contents |
|---|---|
| `src/main.rok` | Settings, compile and format API (job dir, sandbox, time limit, cache, rate limit), static files, the kit's files and markup, the 404 page |
| `static/` | `index.html`, `404.html`, `play.js`, `run.js` (the worker), `play.css`, `examples/*.rok`, `og.png` |
| `web/` | the web kit (submodule): `rok.css`, `theme.js`, the marks and icons, and the `web` library (HTTP, addresses) |
| `scripts/og.html` | Source of `static/og.png` |
| `scripts/` | `Dockerfile` + `docker-sandbox.sh` (recommended), `sandbox.sh` (bubblewrap) |
