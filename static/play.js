// The playground page: an editor with highlighting, the compile request,
// a worker that runs the module, examples, and share links (the code
// lives in the link's #fragment, deflated).

const $ = (id) => document.getElementById(id);
const ed = $("editor");
const hl = document.querySelector(".hl code");
const gutter = document.querySelector(".gutter");
const out = $("out");
const status = $("status");
const runBtn = $("run");
const pick = $("example");
const opt = $("opt");
const sqs = document.querySelector(".sqs");
const tip = $("tip");
const pos = $("pos");
const diagBtn = $("diag");

// Highlighting, with the classes of rok-syntax: k t s n c a.

const KEYWORDS = new Set(("fn let mut if else match for in while loop return break continue struct enum trait impl " +
  "pub use mod const static type as is none true false throws try catch async await yield self Self where ref " +
  "unsafe extern defer using move dyn any super crate").split(" "));
const PRIMS = new Set("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str".split(" "));
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(f?"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)')|(#!?\[[^\]\n]*\]?)|(\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?(?:[iu](?:8|16|32|64|128|size)|f32|f64)?\b|\b0x[\da-fA-F_]+\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function highlight(src) {
  let html = "";
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    html += esc(src.slice(last, m.index));
    last = m.index + m[0].length;
    const [w, com, str, attr, num, id] = m;
    const cls = com ? "c" : str ? "s" : attr ? "a" : num ? "n"
      : KEYWORDS.has(id) ? "k" : PRIMS.has(id) || /^[A-Z]/.test(id) ? "t" : "";
    html += cls ? `<span class="${cls}">${esc(w)}</span>` : esc(w);
  }
  return html + esc(src.slice(last)) + "\n";
}

// The last failed compile's diagnostics that point into main.rok:
// { warn, head, notes, line, col, len }. Cleared on the next edit.
let diags = [];

// The underline layer: the source in transparent ink, each diagnostic's
// span wrapped so only its wavy underline shows.
function underlines(src) {
  const lines = src.split("\n");
  const byLine = new Map();
  for (const d of diags) if (d.line) (byLine.get(d.line) || byLine.set(d.line, []).get(d.line)).push(d);
  return lines.map((ln, i) => {
    const ds = byLine.get(i + 1);
    if (!ds) return esc(ln);
    const d = ds[0];
    const a = Math.min(d.col - 1, ln.length), b = Math.min(a + Math.max(d.len, 1), Math.max(ln.length, a + 1));
    const span = ln.slice(a, b) || " ";
    return esc(ln.slice(0, a)) + `<span class="sq${d.warn ? " w" : ""}">${esc(span)}</span>` + esc(ln.slice(b));
  }).join("\n") + "\n";
}

function paint() {
  hl.innerHTML = highlight(ed.value);
  sqs.innerHTML = diags.length ? underlines(ed.value) : "";
  const n = ed.value.split("\n").length;
  if (gutter.childElementCount !== n || gutter.dataset.marked || diags.length) {
    const bad = new Map(diags.filter((d) => d.line).map((d) => [d.line, d.warn ? "warn" : "bad"]));
    gutter.replaceChildren(...Array.from({ length: n }, (_, k) => {
      const li = document.createElement("li");
      if (bad.has(k + 1)) li.className = bad.get(k + 1);
      return li;
    }));
    if (bad.size) gutter.dataset.marked = "1"; else delete gutter.dataset.marked;
  }
  showDiagCount();
}
function sync() {
  for (const el of [hl.parentElement, sqs]) { el.scrollTop = ed.scrollTop; el.scrollLeft = ed.scrollLeft; }
  gutter.scrollTop = ed.scrollTop;
  hideTip();
}

ed.addEventListener("input", () => { diags = []; hideTip(); paint(); keep(); });
ed.addEventListener("scroll", sync);

// Caret position, diagnostics count, and the diagnostic tooltip.

function caretAt(i) {
  const before = ed.value.slice(0, i);
  const line = before.split("\n").length;
  return { line, col: i - before.lastIndexOf("\n") };
}
function showPos() {
  const { line, col } = caretAt(ed.selectionStart);
  pos.textContent = `Ln ${line}, Col ${col}`;
  const d = diags.find((x) => x.line === line);
  if (d && document.activeElement === ed) showTip(d); else if (!hovering) hideTip();
}
document.addEventListener("selectionchange", () => { if (document.activeElement === ed) showPos(); });
ed.addEventListener("blur", () => { if (!hovering) hideTip(); });

function showDiagCount() {
  const errs = diags.filter((d) => !d.warn).length, warns = diags.length - errs;
  const parts = [];
  if (errs) parts.push(`${errs} error${errs > 1 ? "s" : ""}`);
  if (warns) parts.push(`${warns} warning${warns > 1 ? "s" : ""}`);
  diagBtn.hidden = !parts.length;
  diagBtn.textContent = parts.join(", ");
  diagBtn.classList.toggle("w", !errs && warns > 0);
  diagBtn.title = diags.some((d) => d.line) ? "Go to the first one" : "";
}
// The count jumps to the first diagnostic with a place in the source.
diagBtn.addEventListener("click", () => {
  const d = diags.find((x) => x.line);
  if (!d) return;
  const lines = ed.value.split("\n");
  let i = 0;
  for (let k = 0; k < d.line - 1 && k < lines.length; k++) i += lines[k].length + 1;
  i += Math.min(d.col - 1, (lines[d.line - 1] || "").length);
  ed.focus();
  ed.setSelectionRange(i, i);
  const lh = parseFloat(getComputedStyle(ed).lineHeight);
  ed.scrollTop = Math.max(0, (d.line - 4) * lh);
  showPos();
});

// One monospace cell, measured once the fonts are in.
let cell = 0;
function cellWidth() {
  if (cell) return cell;
  const probe = document.createElement("span");
  probe.textContent = "0".repeat(40);
  sqs.append(probe);
  cell = probe.getBoundingClientRect().width / 40;
  probe.remove();
  return cell;
}
document.fonts && document.fonts.ready.then(() => { cell = 0; });

function showTip(d) {
  tip.replaceChildren();
  const head = document.createElement("span");
  head.className = "h" + (d.warn ? " w" : "");
  const b = document.createElement("b");
  b.textContent = d.kind;
  head.append(b, d.head ? `: ${d.head}` : "");
  tip.append(head);
  for (const [k, text] of d.notes) {
    const n = document.createElement("span");
    n.className = "n";
    const nb = document.createElement("b");
    nb.textContent = k;
    n.append(nb, `: ${text}`);
    tip.append(n);
  }
  const cs = getComputedStyle(ed);
  const lh = parseFloat(cs.lineHeight), padT = parseFloat(cs.paddingTop), padL = parseFloat(cs.paddingLeft);
  tip.hidden = false;
  const box = ed.parentElement.getBoundingClientRect();
  let left = padL + (d.col - 1) * cellWidth() - ed.scrollLeft - 12;
  left = Math.max(8, Math.min(left, box.width - tip.offsetWidth - 8));
  tip.style.left = `${left}px`;
  tip.style.top = `${tipTop(d.line, tip.offsetHeight, box.height, lh, padT)}px`;
}
// Below the line, else above it, else past the run of marked lines it
// sits in: never over another underlined line if there is room.
function tipTop(line, h, room, lh, padT) {
  const y = (n) => padT + (n - 1) * lh - ed.scrollTop;
  const marked = new Set(diags.map((x) => x.line));
  let a = line, b = line;
  while (marked.has(a - 1)) a--;
  while (marked.has(b + 1)) b++;
  const fits = (t) => t >= 4 && t + h <= room - 4;
  const clear = (t) => fits(t) && ![...marked].some((n) => n !== line && y(n) < t + h && y(n) + lh > t);
  const tries = [y(line + 1) + 6, y(line) - h - 6, y(b + 1) + 6, y(a) - h - 6];
  return tries.find(clear) ?? tries.find(fits) ?? tries[0];
}
function hideTip() { tip.hidden = true; }

// Hovering the underlined span shows its diagnostic too.
let hovering = false;
ed.addEventListener("mousemove", (ev) => {
  if (!diags.length) return;
  const cs = getComputedStyle(ed);
  const lh = parseFloat(cs.lineHeight);
  const line = Math.floor((ev.offsetY + ed.scrollTop - parseFloat(cs.paddingTop)) / lh) + 1;
  const col = Math.floor((ev.offsetX + ed.scrollLeft - parseFloat(cs.paddingLeft)) / cellWidth()) + 1;
  const d = diags.find((x) => x.line === line && col >= x.col && col < x.col + Math.max(x.len, 1));
  hovering = !!d;
  if (d) showTip(d); else if (!(document.activeElement === ed && diags.some((x) => x.line === caretAt(ed.selectionStart).line))) hideTip();
});
ed.addEventListener("mouseleave", () => { hovering = false; if (document.activeElement !== ed) hideTip(); else showPos(); });
// A code-editor keystroke: what to do (or null to leave it to the
// textarea). The handler applies it with execCommand so undo still works.
const PAIRS = { "{": "}", "(": ")", "[": "]" };
function editAction(v, s, e, key, shift) {
  const lineStart = v.lastIndexOf("\n", s - 1) + 1;
  const indent = (v.slice(lineStart, s).match(/^[ \t]*/) || [""])[0];
  const before = v[s - 1], after = v[s];

  if (key === "Enter" && !shift && s === e) {
    if (before === "{" && after === "}") {
      return { insert: "\n" + indent + "    \n" + indent, caret: 1 + indent.length + 4 };
    }
    const add = "{([".includes(before) ? "    " : "";
    return { insert: "\n" + indent + add, caret: 1 + indent.length + add.length };
  }

  if (key === "Tab") {
    if (s === e && !shift) return { insert: "    ", caret: 4 };
    const ls = lineStart;
    let le = v.indexOf("\n", e > s ? e - 1 : e);
    if (le === -1) le = v.length;
    const out = v.slice(ls, le).split("\n").map((ln) => {
      if (shift) {
        if (ln.startsWith("    ")) return ln.slice(4);
        if (ln.startsWith("\t")) return ln.slice(1);
        return ln.replace(/^ {1,3}/, "");
      }
      return ln === "" ? ln : "    " + ln;
    }).join("\n");
    return { replace: [ls, le], text: out, sel: [ls, ls + out.length] };
  }

  if (s === e) {
    if (PAIRS[key]) {
      if (!after || /[\s)\]},;]/.test(after)) return { insert: key + PAIRS[key], caret: 1 };
      return null;
    }
    if (key === '"') {
      if (after === '"') return { caret: s + 1 };
      if (!after || /[\s)\]},;]/.test(after)) return { insert: '""', caret: 1 };
      return null;
    }
    if ((key === "}" || key === ")" || key === "]") && after === key) return { caret: s + 1 };
    if (key === "Backspace" && (PAIRS[before] === after || (before === '"' && after === '"'))) {
      return { del: [s - 1, s + 1] };
    }
  }
  return null;
}

// Tab indents, so Escape first hands the next Tab back to the browser
// and keyboard users can leave the editor (WCAG 2.1.2).
let escaped = false;
ed.addEventListener("blur", () => { escaped = false; });
ed.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); run(); return; }
  if (ev.key === "Escape") { escaped = true; hideTip(); return; }
  if (ev.key === "Shift") return;
  if (ev.key === "Tab" && escaped) { escaped = false; return; }
  escaped = false;
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const a = editAction(ed.value, ed.selectionStart, ed.selectionEnd, ev.key, ev.shiftKey);
  if (!a) return;
  ev.preventDefault();
  const s = ed.selectionStart;
  if (a.insert !== undefined) {
    document.execCommand("insertText", false, a.insert);
    ed.setSelectionRange(s + a.caret, s + a.caret);
  } else if (a.replace) {
    ed.setSelectionRange(a.replace[0], a.replace[1]);
    document.execCommand("insertText", false, a.text);
    ed.setSelectionRange(a.sel[0], a.sel[1]);
  } else if (a.del) {
    ed.setSelectionRange(a.del[0], a.del[1]);
    document.execCommand("delete");
  } else if (a.caret !== undefined) {
    ed.setSelectionRange(a.caret, a.caret);
  }
});


// What the editor shows: the visitor's own code ("mine", kept in
// localStorage "play.mine"), code from a share link ("link"), or an
// example. Picking an example never touches "mine"; edits to an
// example last until the next pick.

const EXAMPLES = [
  ["hello", "Hello, world"], ["sums", "Sum types and match"], ["none", "T | none and ??"],
  ["errors", "throws, try, catch"], ["iter", "Lists, closures, iterators"], ["structs", "Structs and traits"],
];
for (const [file, label] of EXAMPLES) pick.append(new Option(label, file));
pick.append(new Option("Your code", "mine"));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const texts = new Map();
async function exampleText(file) {
  if (!texts.has(file)) texts.set(file, await (await fetch(`/examples/${file}.rok`)).text());
  return texts.get(file);
}

let view = "mine";
let mine = "";
let linked = null;

// Untouched Hello world is still Hello world, not "Your code".
function syncPick() {
  pick.value = view === "mine" && ed.value === texts.get("hello") ? "hello" : view;
}
function show(text, v) {
  view = v;
  ed.value = text;
  diags = [];
  hideTip();
  paint();
  ed.setSelectionRange(0, 0);
  ed.scrollTop = ed.scrollLeft = 0;
  sync();
  syncPick();
  showPos();
}
function keep() {
  if (view === "mine") { mine = ed.value; store.set("play.mine", mine); }
  else if (view === "link") linked = ed.value;
  syncPick();
}
pick.addEventListener("change", async () => {
  const v = pick.value;
  if (v === "mine") show(mine, "mine");
  else if (v === "link") show(linked, "link");
  else show(await exampleText(v), v);
});

// The code in the link.


const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function pack(text) {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return b64(new Uint8Array(await new Response(s).arrayBuffer()));
}
async function unpack(code) {
  // Read the decompressed bytes with a cap, so a crafted link cannot
  // decompression-bomb the editor. The real source limit is 64 KiB.
  const LIMIT = 262144;
  const r = new Blob([unb64(code)]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    total += value.length;
    if (total > LIMIT) { await r.cancel(); throw new Error("too large"); }
    parts.push(value);
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { buf.set(p, at); at += p.length; }
  return new TextDecoder().decode(buf);
}
$("share").addEventListener("click", async () => {
  const q = opt.value !== "0" ? `&opt=${opt.value}` : "";
  const url = `${location.origin}${location.pathname}#code=${await pack(ed.value)}${q}`;
  history.replaceState(null, "", url);
  const btn = $("share");
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "Link copied";
  } catch {
    btn.textContent = "Link in the address bar";
  }
  clearTimeout(btn.reset);
  btn.reset = setTimeout(() => { btn.textContent = "Share"; }, 2000);
});


function say(text, kind) {
  status.textContent = text;
  status.dataset.kind = kind || "";
}

// Output is queued and written once a frame, as few nodes as there are
// colour changes, and capped: a program printing 200,000 lines must not
// cost a node and a layout per line.
const MAX_LINES = 10_000;
const MAX_CHARS = 1 << 20;
const copyBtn = $("copy-out");
let queue = [];
let frame = 0;
let shown = { lines: 0, chars: 0, cut: false };

function put(text, cls) {
  const last = queue[queue.length - 1];
  if (last && last[1] === cls) last[0] += text;
  else queue.push([text, cls]);
  if (!frame) frame = requestAnimationFrame(flush);
}
// `always` is for the run's own notes, which still show after a cut.
function print(text, cls = "", always = false) {
  if (!text) return;
  if (always) { put(text, cls); return; }
  if (shown.cut) return;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    if (++shown.lines === MAX_LINES) { text = text.slice(0, i + 1); shown.cut = true; break; }
  }
  shown.chars += text.length;
  if (shown.chars > MAX_CHARS) {
    text = text.slice(0, text.length - (shown.chars - MAX_CHARS)) + "\n";
    shown.cut = true;
  }
  put(text, cls);
  if (shown.cut) put(`\noutput truncated after ${shown.lines.toLocaleString("en")} lines\n`, "warn");
}
function flush() {
  frame = 0;
  const atEnd = out.scrollHeight - out.scrollTop - out.clientHeight < 32;
  const frag = document.createDocumentFragment();
  for (const [text, cls] of queue) {
    if (!cls) { frag.append(text); continue; }
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    frag.append(span);
  }
  queue = [];
  out.append(frag);
  if (atEnd) out.scrollTop = out.scrollHeight;
  copyBtn.disabled = false;
}
function clearOut() {
  cancelAnimationFrame(frame);
  frame = 0;
  queue = [];
  shown = { lines: 0, chars: 0, cut: false };
  out.replaceChildren();
}
// A cargo-style progress line: a right-aligned verb, then the rest.
function step(verb, rest) {
  print(verb.padStart(12) + " ", "v");
  print(rest + "\n");
}
$("clear").addEventListener("click", () => { clearOut(); copyBtn.disabled = true; say(""); });

copyBtn.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(out.innerText); copyBtn.textContent = "Copied"; }
  catch { copyBtn.textContent = "Copy failed"; }
  clearTimeout(copyBtn.reset);
  copyBtn.reset = setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
});

// rokc's diagnostics: each `error[..]: msg` / `warning: msg` block, its
// `--> main.rok:<line>:<col>`, the caret run under the code, and its
// `= note:` / `= help:` lines.
function parseDiags(text) {
  const found = [];
  let d = null;
  for (const line of text.split("\n")) {
    let m;
    if ((m = line.match(/^(error|warning)(\[\w+\])?: (.*)$/))) {
      d = { kind: m[1] + (m[2] || ""), warn: m[1] === "warning", head: m[3], notes: [], line: 0, col: 0, len: 1 };
      found.push(d);
    } else if (!d) {
      continue;
    } else if ((m = line.match(/^\s*--> main\.rok:(\d+):(\d+)/)) && !d.line) {
      d.line = +m[1];
      d.col = +m[2];
    } else if ((m = line.match(/^\s*\|\s*(\^+)\s*(.*)$/)) && d.len === 1) {
      d.len = m[1].length;
      if (m[2]) d.notes.push(["label", m[2]]);
    } else if ((m = line.match(/^\s*= (note|help): (.*)$/))) {
      d.notes.push([m[1], m[2]]);
    }
  }
  // A caret label reads as part of the headline, not as a note.
  for (const x of found) x.notes = x.notes.map(([k, t]) => (k === "label" ? ["here", t] : [k, t]));
  return found;
}

// Diagnostics in the output, coloured as rokc colours them in a terminal.
function showErrors(text) {
  diags = parseDiags(text);
  paint();
  for (const line of text.replace(/\n+$/, "").split("\n")) {
    let m;
    if ((m = line.match(/^(error|warning)(\[\w+\])?(:.*)$/))) {
      print(m[1] + (m[2] || ""), m[1] === "error" ? "e" : "w");
      print(m[3] + "\n");
    } else if ((m = line.match(/^(\s*)(-->|=|\d* ?\|)(.*)$/))) {
      print(m[1]);
      print(m[2], "g");
      const caret = m[3].match(/^(\s*)(\^+)(.*)$/);
      if (caret) { print(caret[1]); print(caret[2], diags.some((d) => !d.warn) ? "e" : "w"); print(caret[3] + "\n"); }
      else print(m[3] + "\n");
    } else {
      print(line + "\n");
    }
  }
}


// One run at a time: `gen` tells a stale await it was stopped or
// replaced. While a run is in flight the Run button is Stop.
const LIMIT = 10_000;
const secs = (ms) => `${(ms / 1000).toFixed(2)} s`;
const runHTML = () => `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1v8l7-4z" fill="currentColor"/></svg>Run <kbd class="kbd">${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl↵"}</kbd>`;
const STOP_HTML = `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="currentColor"/></svg>Stop`;
let gen = 0;
let worker = null;
let aborter = null;
let timer = 0;

function busy(on) {
  if (on && !runBtn.dataset.running) runBtn.style.minWidth = `${runBtn.offsetWidth}px`;
  if (!on) runBtn.style.minWidth = "";
  runBtn.innerHTML = on ? STOP_HTML : runHTML();
  if (on) { runBtn.dataset.running = "1"; runBtn.removeAttribute("aria-keyshortcuts"); }
  else { delete runBtn.dataset.running; runBtn.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter"); }
}
function finish() {
  gen++;
  if (worker) { worker.terminate(); worker = null; }
  if (aborter) { aborter.abort(); aborter = null; }
  clearTimeout(timer);
  busy(false);
}
function stop() {
  if (!runBtn.dataset.running) return;
  const compiling = !worker;
  finish();
  print(`\nstopped${compiling ? " while compiling" : ""}\n`, "warn", true);
  say("stopped", "bad");
}

// Stacked panes: bring the output up so the result (or the errors) is
// in view without scrolling for it.
function reveal() {
  if (!matchMedia("(max-width: 860px)").matches) return;
  const pane = out.closest(".out-pane");
  const hdr = document.querySelector(".hdr");
  const cover = getComputedStyle(hdr).position === "sticky" ? hdr.offsetHeight : 0;
  const top = pane.getBoundingClientRect().top - cover;
  if (top < innerHeight * 0.35) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  scrollTo({ top: scrollY + top, behavior: still ? "auto" : "smooth" });
}

async function run() {
  finish();
  const me = gen;
  clearOut();
  diags = [];
  hideTip();
  paint();
  busy(true);
  say("compiling…");
  step("Compiling", `main.rok (wasm32, -O${opt.value})`);
  reveal();
  const t0 = performance.now();
  aborter = new AbortController();
  let res, body;
  try {
    res = await fetch(`/api/compile?opt=${opt.value}`, { method: "POST", body: ed.value, headers: { "Content-Type": "text/plain; charset=utf-8" }, signal: aborter.signal });
    body = res.ok && !res.headers.has("X-Rok-Diagnostics") ? await res.arrayBuffer() : await res.text();
  } catch {
    if (me !== gen) return;
    finish();
    say("offline", "bad");
    print("cannot reach the compile server\n", "err");
    return;
  }
  if (me !== gen) return;
  aborter = null;
  const cached = res.headers.get("X-Rok-Cache") === "hit";
  const took = performance.now() - t0;
  if (!res.ok) {
    finish();
    say(`HTTP ${res.status}`, "bad");
    print(body.replace(/\n*$/, "\n"), "err");
    return;
  }
  if (typeof body === "string") {
    finish();
    showErrors(body);
    const n = diags.filter((d) => !d.warn).length;
    say(n ? `${n} error${n > 1 ? "s" : ""}` : "failed", "bad");
    return;
  }
  step("Finished", cached ? "cached build" : `in ${secs(took)}`);
  step("Running", "main.wasm");
  print("\n");
  say("running…");
  const t1 = performance.now();
  worker = new Worker("/run.js", { type: "module" });
  timer = setTimeout(() => {
    finish();
    print(`\nstopped after ${LIMIT / 1000} s\n`, "warn", true);
    say("stopped · 10 s limit", "bad");
  }, LIMIT);
  worker.onmessage = ({ data }) => {
    if (data.text !== undefined) { print(data.text, data.fd === 2 ? "err" : ""); return; }
    finish();
    const ms = performance.now() - t1;
    if (data.error) { print(`\n${data.error}\n`, "err", true); say("crashed", "bad"); return; }
    if (data.code !== 0) print(`\nexit code ${data.code}\n`, "warn", true);
    say(`exit ${data.code} · ${secs(ms)}`, data.code === 0 ? "" : "bad");
  };
  worker.postMessage({ wasm: body, lines: MAX_LINES, chars: MAX_CHARS }, [body]);
}
runBtn.addEventListener("click", () => { if (runBtn.dataset.running) stop(); else run(); });
document.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter" && ev.target !== ed) { ev.preventDefault(); run(); }
});
busy(false);

// On a phone the optimisation picker says only -O0 / -O2, so the
// example picker keeps room for its name.
const narrow = matchMedia("(max-width: 480px)");
function optLabels() {
  const [o0, o2] = opt.options;
  o0.text = narrow.matches ? "-O0" : "-O0 · debug";
  o2.text = narrow.matches ? "-O2" : "-O2 · release";
}
narrow.addEventListener("change", optLabels);
optLabels();

// The skip link puts the caret in the editor, not just the scroll.
document.querySelector(".skip").addEventListener("click", (ev) => { ev.preventDefault(); ed.focus(); });

// Start: the visitor's code (or Hello world), then a link's code. A
// link replaces "mine" only while mine is empty or untouched Hello world.

(async () => {
  const om = location.hash.match(/[#&]opt=([02])/);
  if (om) opt.value = om[1];
  mine = store.get("play.mine") ?? store.get("play.code") ?? "";
  try { localStorage.removeItem("play.code"); } catch {}
  if (mine) { store.set("play.mine", mine); show(mine, "mine"); }
  const hello = await exampleText("hello");
  const m = location.hash.match(/^#code=([\w-]+)/);
  if (m) {
    let text = null;
    try { text = await unpack(m[1]); } catch { say("the link's code is damaged", "bad"); }
    if (text !== null && text !== mine) {
      if (!mine || mine === hello) { mine = text; store.set("play.mine", mine); }
      else { linked = text; pick.add(new Option("Code from the link", "link"), pick.options[EXAMPLES.length]); }
    }
  }
  if (!mine) mine = hello;
  if (linked !== null) show(linked, "link");
  else if (ed.value !== mine) show(mine, "mine");
  else syncPick();
})();

// A draggable divider resizes the editor vs the output (desktop only).
const divider = document.querySelector(".divider");
const panes = document.querySelector(".ws");
if (divider && panes) {
  const SPLIT_KEY = "play.split";
  const apply = (pct) => {
    const v = Math.max(25, Math.min(75, pct));
    panes.style.setProperty("--split", v + "%");
    divider.setAttribute("aria-valuenow", String(Math.round(v)));
  };
  apply(parseFloat(store.get(SPLIT_KEY)) || 60);
  const pctAt = (clientX) => {
    const r = panes.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * 100;
  };
  const save = () => {
    const cur = panes.style.getPropertyValue("--split");
    if (cur) store.set(SPLIT_KEY, parseFloat(cur));
  };
  divider.addEventListener("pointerdown", (ev) => {
    if (matchMedia("(max-width: 860px)").matches) return;
    ev.preventDefault();
    divider.setPointerCapture(ev.pointerId);
    panes.classList.add("dragging");
    const move = (e) => apply(pctAt(e.clientX));
    const up = () => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
      panes.classList.remove("dragging");
      hideTip();
      save();
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });
  divider.addEventListener("keydown", (ev) => {
    const cur = parseFloat(panes.style.getPropertyValue("--split")) || 60;
    const to = { ArrowLeft: cur - 3, ArrowRight: cur + 3, Home: 25, End: 75 }[ev.key];
    if (to === undefined) return;
    ev.preventDefault();
    apply(to);
    save();
  });
}

// Theme, shared with rok-lang.org and its docs: a `theme` cookie for
// .rok-lang.org, else localStorage "theme", else the system. "auto"
// (System) deletes both.
const root = document.documentElement;
const dark = matchMedia("(prefers-color-scheme: dark)");
const themeBtn = document.querySelector(".theme");
const COOKIE = "; Path=/; SameSite=Lax; Secure" + (/(^|\.)rok-lang\.org$/.test(location.hostname) ? "; Domain=.rok-lang.org" : "");
function getTheme() {
  const c = document.cookie.match(/(?:^|;\s*)theme=(light|dark)(?:;|$)/);
  if (c) return c[1];
  const t = store.get("theme");
  return t === "light" || t === "dark" ? t : "auto";
}
function applyTheme() {
  const t = getTheme();
  const d = t === "dark" || (t === "auto" && dark.matches);
  root.classList.toggle("dk", d);
  root.classList.toggle("lt", !d);
  for (const b of document.querySelectorAll(".seg button")) b.setAttribute("aria-pressed", String(b.dataset.theme === t));
  themeBtn.setAttribute("aria-pressed", String(d));
  themeBtn.title = d ? "Switch to light theme" : "Switch to dark theme";
}
function setTheme(t) {
  if (t === "auto") {
    try { localStorage.removeItem("theme"); } catch {}
    document.cookie = "theme=" + COOKIE + "; Max-Age=0";
  } else {
    store.set("theme", t);
    document.cookie = `theme=${t}${COOKIE}; Max-Age=31536000`;
  }
  applyTheme();
}
themeBtn.addEventListener("click", () => setTheme(root.classList.contains("dk") ? "light" : "dark"));
for (const b of document.querySelectorAll(".seg button")) b.addEventListener("click", () => setTheme(b.dataset.theme));
dark.addEventListener("change", applyTheme);
// Another rok-lang.org tab may have changed it meanwhile.
document.addEventListener("visibilitychange", () => { if (!document.hidden) applyTheme(); });
applyTheme();
