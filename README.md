# playground.rok-lang.org

Write rok in the browser and run it. The page sends the source to this server, which compiles it with `rokc --target=wasm32-unknown-unknown` and returns the module; the page runs it in a Web Worker with the toolchain's `rok.mjs`. The server is written in rok.

- Programs are one file. They have no files, network or threads (those calls fail with `Unsupported`), stdout and stderr show as they are printed, and a run stops after 10 seconds.
- Nothing is stored. **Share** puts the source, deflated, in the link's `#code=` fragment.
- A compiled module is cached by the SHA-256 of its level and source, so a shared link compiles once.

## Run it locally

You need a rok toolchain with the `wasm32-unknown-unknown` runtime (release archives ship it; from source, `targets/build.sh wasm32-unknown-unknown`) and the rok-lang.org checkout next to this one, for the shared stylesheet and logo.

```bash
rok build
PLAY_ROKC=~/.rok/toolchains/0.1.0-aarch64-apple-darwin/bin/rokc ./target/debug/rok_playground
# http://127.0.0.1:8405
```

Without `PLAY_WRAP` the server only listens on a loopback address: an unsandboxed rokc could be made to read the machine's files.

## API

| Request | Answer |
|---|---|
| `POST /api/compile?opt=0` (or `opt=2`), body: the source, UTF-8, at most 64 KiB | `200` `application/wasm`: the module (`X-Rok-Cache: hit` or `miss`). `422` `text/plain`: rokc's diagnostics, paths relative to `main.rok`. `413` too large, `429` over the per-client rate, `503` all compile slots busy, `504` over the time limit. |
| `GET /`, `/play.js`, ... | `static/`, then the shared files of rok-lang.org (`PLAY_SITE`), and `/rok.mjs` from the toolchain |

## Settings

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PLAY_ADDR` | `127.0.0.1:8405` | Where to listen |
| `PLAY_ROKC` | `rokc` | The compiler: the toolchain's own `bin/rokc`, not the `~/.rok/bin` proxy |
| `PLAY_MJS` | `<rokc dir>/../lib/rok/targets/wasm32-unknown-unknown/rok.mjs` | The JS host served at `/rok.mjs` |
| `PLAY_SITE` | `../rok-lang.org/static` | Shared stylesheet, logo, icons |
| `PLAY_WRAP` | (none) | The sandbox command rokc runs under: `scripts/sandbox.sh` |
| `PLAY_WORK` | `<temp>/rok-playground` | Job directories and the module cache |
| `PLAY_JOBS` | `2` | Compiles at a time |
| `PLAY_TIMEOUT` | `20` | Seconds a compile may take |
| `PLAY_RATE` | `30` | Compiles a minute per client (`X-Forwarded-For`, else the peer) |

## Deploy (Linux)

rokc reads any file it can reach at compile time (`include_str!`, `include_bytes!`, `#[path]`, WIT imports) and can put it in the module it returns, and a program can make it use a lot of memory. The server refuses those features up front, but the sandbox is what keeps the machine's files out of reach. There are two; pick one for `PLAY_WRAP`.

### Docker (recommended, the way play.rust-lang.org runs rustc)

Each compile runs rokc in a throwaway container: the job directory is the only writable mount, there is no network, the root is read-only, and Docker's cgroup caps memory and CPUs. The host is never mounted, so a program can read only the container's own files (a plain Debian plus the public toolchain) and never the server's.

```sh
# Unpack a Linux release archive, then build the image from it:
docker build -t rok-playground:0.1.0   --build-arg TOOLCHAIN=rok-0.1.0-x86_64-unknown-linux-gnu   -f scripts/Dockerfile <dir holding the unpacked rok-0.1.0-x86_64-unknown-linux-gnu/>
```

`PLAY_IMAGE`, `PLAY_MEM` (default `4g`) and `PLAY_CPUS` (default `2`) tune it. `PLAY_ROKC` can be any rokc the server can find for the pre-flight; the image's own rokc does the build. The service user must be able to run `docker`.

```ini
# /etc/systemd/system/rok-playground.service
[Service]
User=rokplay
SupplementaryGroups=docker
WorkingDirectory=/srv/playground
Environment=PLAY_ADDR=127.0.0.1:8405
Environment=PLAY_ROKC=/srv/rok/toolchains/0.1.0-x86_64-unknown-linux-gnu/bin/rokc
Environment=PLAY_WRAP=/srv/playground/scripts/docker-sandbox.sh
Environment=PLAY_SITE=/srv/rok-lang.org/static
ExecStart=/srv/playground/target/release/rok_playground
Restart=on-failure
```

Put a TLS reverse proxy in front that sets `X-Forwarded-For`.

### bubblewrap (lighter, no daemon)

`scripts/sandbox.sh` runs each compile under bubblewrap: only the job directory (writable), the toolchain and `/usr` (read-only), a fresh `/proc` and a `/dev` with only `null`. No `/etc`, no home directories, no network, no other processes, with prlimit caps on CPU time, address space and file size. Real memory still needs a cgroup cap, so run the service with `MemoryMax=6G`. Set `PLAY_WRAP=/srv/playground/scripts/sandbox.sh`.

### Checked

On Ubuntu 26.04 aarch64, both sandboxes: a normal program builds and runs; `include_str!` of a host file (`../`, a home directory, a secret) reports "no such file"; `/dev/zero` is killed by the memory cap; the container has no network.

## Layout

| File | Contents |
|---|---|
| `src/main.rok` | Settings, the compile API (job directory, sandbox, time limit, cache, rate limit), static files |
| `src/http.rok` | HTTP/1.1, the same code as rokstones.io's `src/http.rok` |
| `static/` | `index.html`, `play.js` (editor, highlighting, share links), `run.js` (the worker), `play.css`, `examples/*.rok` |
| `scripts/Dockerfile`, `scripts/docker-sandbox.sh` | The Docker sandbox for one compile (recommended) |
| `scripts/sandbox.sh` | The bubblewrap sandbox, an alternative |
