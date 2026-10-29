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

ed.addEventListener("input", () => { diags = []; hideTip(); paint(); save(); });
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
  let top = padT + d.line * lh - ed.scrollTop + 6;
  if (top + tip.offsetHeight > box.height - 8) top = padT + (d.line - 1) * lh - ed.scrollTop - tip.offsetHeight - 6;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
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

ed.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); run(); return; }
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


const EXAMPLES = [
  ["hello", "Hello, world"], ["sums", "Sum types and match"], ["none", "T | none and ??"],
  ["errors", "throws, try, catch"], ["iter", "Lists, closures, iterators"], ["structs", "Structs and traits"],
];
for (const [file, label] of EXAMPLES) pick.append(new Option(label, file));
pick.append(new Option("Your code", ""));

async function loadExample(file) {
  const r = await fetch(`examples/${file}.rok`);
  ed.value = await r.text();
  pick.dataset.text = ed.value;
  diags = [];
  paint();
  save();
}
pick.addEventListener("change", () => { if (pick.value) loadExample(pick.value); });

// The code in the link, and in this browser between visits.

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
function save() {
  if (pick.value && ed.value !== pick.dataset.text) pick.value = "";
  try { localStorage.setItem("play.code", ed.value); } catch {}
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
function print(text, cls) {
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text;
  out.append(span);
  out.scrollTop = out.scrollHeight;
  $("copy-out").disabled = false;
}
// A cargo-style progress line: a right-aligned verb, then the rest.
function step(verb, rest) {
  print(verb.padStart(12) + " ", "v");
  print(rest + "\n");
}
$("clear").addEventListener("click", () => { out.replaceChildren(); $("copy-out").disabled = true; say(""); });

$("copy-out").addEventListener("click", async () => {
  const btn = $("copy-out");
  try { await navigator.clipboard.writeText(out.innerText); btn.textContent = "Copied"; }
  catch { btn.textContent = "Copy failed"; }
  clearTimeout(btn.reset);
  btn.reset = setTimeout(() => { btn.textContent = "Copy"; }, 2000);
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


let worker = null;
const LIMIT = 10_000;
const secs = (ms) => `${(ms / 1000).toFixed(2)} s`;

async function run() {
  if (worker) { worker.terminate(); worker = null; }
  out.replaceChildren();
  diags = [];
  hideTip();
  paint();
  runBtn.setAttribute("aria-busy", "true");
  const done = () => runBtn.removeAttribute("aria-busy");
  say("compiling…");
  step("Compiling", `main.rok (wasm32, -O${opt.value})`);
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(`api/compile?opt=${opt.value}`, { method: "POST", body: ed.value, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch {
    done();
    say("offline", "bad");
    print("cannot reach the compile server\n", "err");
    return;
  }
  const cached = res.headers.get("X-Rok-Cache") === "hit";
  const took = performance.now() - t0;
  if (!res.ok) {
    done();
    const text = await res.text();
    if (res.status === 422) {
      showErrors(text);
      const n = diags.filter((d) => !d.warn).length;
      say(n ? `${n} error${n > 1 ? "s" : ""}` : "failed", "bad");
    } else {
      say(`HTTP ${res.status}`, "bad");
      print(text.replace(/\n*$/, "\n"), "err");
    }
    return;
  }
  const wasm = await res.arrayBuffer();
  step("Finished", cached ? "cached build" : `in ${secs(took)}`);
  step("Running", "main.wasm");
  print("\n");
  say("running…");
  const t1 = performance.now();
  worker = new Worker("run.js", { type: "module" });
  const stop = setTimeout(() => {
    worker.terminate();
    worker = null;
    done();
    print(`\nstopped after ${LIMIT / 1000} s\n`, "warn");
    say("stopped · 10 s limit", "bad");
  }, LIMIT);
  worker.onmessage = ({ data }) => {
    if (data.text !== undefined) { print(data.text, data.fd === 2 ? "err" : ""); return; }
    clearTimeout(stop);
    worker.terminate();
    worker = null;
    done();
    const ms = performance.now() - t1;
    if (data.error) { print(`\n${data.error}\n`, "err"); say("crashed", "bad"); return; }
    if (data.code !== 0) print(`\nexit code ${data.code}\n`, "warn");
    say(`exit ${data.code} · ${secs(ms)}`, data.code === 0 ? "" : "bad");
  };
  worker.postMessage(wasm, [wasm]);
}
runBtn.addEventListener("click", run);
document.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter" && ev.target !== ed) { ev.preventDefault(); run(); }
});

// The Run shortcut glyph: ⌘ on a Mac, Ctrl elsewhere.
const runKey = document.querySelector("#run .kbd");
if (runKey && !/Mac|iPhone|iPad/.test(navigator.platform)) runKey.textContent = "Ctrl↵";

// Start: the link's code, else the last session's, else hello.

(async () => {
  const om = location.hash.match(/[#&]opt=([02])/);
  if (om) opt.value = om[1];
  const m = location.hash.match(/^#code=([\w-]+)/);
  let text = null;
  if (m) { try { text = await unpack(m[1]); } catch { say("the link's code is damaged", "bad"); } }
  if (text === null) { try { text = localStorage.getItem("play.code"); } catch {} }
  if (text) {
    ed.value = text;
    pick.value = "";
    paint();
  } else {
    pick.value = "hello";
    await loadExample("hello");
  }
  ed.focus();
  ed.setSelectionRange(0, 0);
  showPos();
})();

// A draggable divider resizes the editor vs the output (desktop only).
const divider = document.querySelector(".divider");
const panes = document.querySelector(".ws");
if (divider && panes) {
  const SPLIT_KEY = "play.split";
  const apply = (pct) => panes.style.setProperty("--split", Math.max(25, Math.min(75, pct)) + "%");
  try { const v = localStorage.getItem(SPLIT_KEY); if (v) apply(parseFloat(v)); } catch {}
  const pctAt = (clientX) => {
    const r = panes.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * 100;
  };
  const save = () => {
    const cur = panes.style.getPropertyValue("--split");
    try { if (cur) localStorage.setItem(SPLIT_KEY, parseFloat(cur)); } catch {}
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
    if (ev.key === "ArrowLeft") { ev.preventDefault(); apply(cur - 3); save(); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); apply(cur + 3); save(); }
  });
}

// Theme: localStorage "theme" is "light" or "dark"; absent, follow the system.
const root = document.documentElement;
const dark = matchMedia("(prefers-color-scheme: dark)");
const getTheme = () => { try { return localStorage.getItem("theme") || "auto"; } catch { return "auto"; } };
const isDark = () => root.classList.contains("dk");
function applyTheme() {
  const t = getTheme();
  const d = t === "dark" || (t !== "light" && dark.matches);
  root.classList.toggle("dk", d);
  root.classList.toggle("lt", !d);
  for (const b of document.querySelectorAll(".seg button")) b.setAttribute("aria-pressed", String(b.dataset.theme === t));
  const tb = document.querySelector(".theme");
  tb.setAttribute("aria-label", d ? "Switch to light theme" : "Switch to dark theme");
  tb.title = tb.getAttribute("aria-label");
}
function setTheme(t) {
  try { t === "auto" ? localStorage.removeItem("theme") : localStorage.setItem("theme", t); } catch {}
  applyTheme();
}
document.querySelector(".theme").addEventListener("click", () => setTheme(isDark() ? "light" : "dark"));
for (const b of document.querySelectorAll(".seg button")) b.addEventListener("click", () => setTheme(b.dataset.theme));
dark.addEventListener("change", applyTheme);
applyTheme();
