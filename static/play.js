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

// ---- highlighting (the classes of rok-syntax: k t s n c a) ----

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

let marks = new Set();
function paint() {
  hl.innerHTML = highlight(ed.value);
  const n = ed.value.split("\n").length;
  if (gutter.childElementCount !== n || marks.size) {
    gutter.replaceChildren(...Array.from({ length: n }, (_, k) => {
      const li = document.createElement("li");
      if (marks.has(k + 1)) li.className = "bad";
      return li;
    }));
  }
}
function sync() {
  hl.parentElement.scrollTop = ed.scrollTop;
  hl.parentElement.scrollLeft = ed.scrollLeft;
  gutter.scrollTop = ed.scrollTop;
}

ed.addEventListener("input", () => { marks.clear(); paint(); save(); });
ed.addEventListener("scroll", sync);
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

// ---- examples ----

const EXAMPLES = [
  ["hello", "Hello, world"], ["sums", "Sum types and match"], ["none", "T | none and ??"],
  ["errors", "throws, try, catch"], ["iter", "Lists, closures, iterators"], ["structs", "Structs and traits"],
];
for (const [file, label] of EXAMPLES) pick.append(new Option(label, file));
pick.append(new Option("(your code)", ""));

async function loadExample(file) {
  const r = await fetch(`examples/${file}.rok`);
  ed.value = await r.text();
  pick.dataset.text = ed.value;
  marks.clear();
  paint();
  save();
}
pick.addEventListener("change", () => { if (pick.value) loadExample(pick.value); });

// ---- the code in the link, and in this browser between visits ----

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
  try {
    await navigator.clipboard.writeText(url);
    say("link copied ✓", "ok");
  } catch {
    say("link in the address bar", "ok");
  }
});

// ---- output ----

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
$("clear").addEventListener("click", () => { out.replaceChildren(); $("copy-out").disabled = true; });

// Copy the output, and download the compiled module.
$("copy-out").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(out.innerText); say("output copied ✓", "ok"); }
  catch { say("copy failed", "bad"); }
});


// Diagnostics: each `--> main.rok:<line>:<col>` marks that line.
function showErrors(text) {
  marks = new Set([...text.matchAll(/--> [^:\n]+:(\d+):\d+/g)].map((m) => +m[1]));
  paint();
  for (const line of text.split("\n")) {
    const cls = /^error/.test(line) ? "err" : /^warning/.test(line) ? "warn" : /^\s*(\||-->|=|\d+ \|)/.test(line) ? "dim" : "";
    print(line + "\n", cls);
  }
}

// ---- run ----

let worker = null;
const LIMIT = 10_000;

async function run() {
  if (worker) { worker.terminate(); worker = null; }
  out.replaceChildren();
  marks.clear();
  paint();
  runBtn.disabled = true;
  say("compiling…", "busy");
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(`api/compile?opt=${opt.value}`, { method: "POST", body: ed.value, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch {
    runBtn.disabled = false;
    say("offline", "bad");
    print("cannot reach the compile server\n", "err");
    return;
  }
  const took = res.headers.get("X-Rok-Cache") === "hit" ? "cached" : `${((performance.now() - t0) / 1000).toFixed(1)}s`;
  if (!res.ok) {
    runBtn.disabled = false;
    const text = await res.text();
    if (res.status === 422) { say(`errors · ${took}`, "bad"); showErrors(text); }
    else { say(`${res.status}`, "bad"); print(text + "\n", "err"); }
    return;
  }
  const wasm = await res.arrayBuffer();
  say(`running · compiled ${took === "cached" ? "(cached)" : "in " + took}`, "busy");
  const t1 = performance.now();
  worker = new Worker("run.js", { type: "module" });
  const stop = setTimeout(() => {
    worker.terminate();
    worker = null;
    runBtn.disabled = false;
    print(`\n⏱ stopped after ${LIMIT / 1000} s\n`, "warn");
    say("stopped", "bad");
  }, LIMIT);
  worker.onmessage = ({ data }) => {
    if (data.text !== undefined) { print(data.text, data.fd === 2 ? "err" : ""); return; }
    clearTimeout(stop);
    worker.terminate();
    worker = null;
    runBtn.disabled = false;
    const ms = Math.round(performance.now() - t1);
    if (data.error) { print(`\n${data.error}\n`, "err"); say("crashed", "bad"); return; }
    print(`\n▸ exit ${data.code} · ran in ${ms} ms\n`, data.code === 0 ? "ok" : "warn");
    say(data.code === 0 ? `done · ${took} + ${ms} ms` : `exit ${data.code}`, data.code === 0 ? "ok" : "bad");
  };
  worker.postMessage(wasm, [wasm]);
}
runBtn.addEventListener("click", run);

// The Run shortcut glyph: ⌘ on a Mac, Ctrl elsewhere.
const runKey = document.querySelector("#run .key");
if (runKey && !/Mac|iPhone|iPad/.test(navigator.platform)) runKey.textContent = "Ctrl↵";

// ---- start: the link's code, else the last session's, else hello ----

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
})();

// A draggable divider resizes the editor vs the output (desktop only).
const divider = document.querySelector(".divider");
const panes = document.querySelector(".panes");
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
      save();
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });
  divider.addEventListener("keydown", (ev) => {
    const cur = parseFloat(panes.style.getPropertyValue("--split")) || 55;
    if (ev.key === "ArrowLeft") { ev.preventDefault(); apply(cur - 3); save(); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); apply(cur + 3); save(); }
  });
}

// The theme button, as on the other rok sites.
const tb = document.querySelector(".theme");
const order = ["auto", "light", "dark"];
const glyph = { auto: "◐", light: "☀", dark: "☾" };
const getTheme = () => { try { return localStorage.getItem("theme") || "auto"; } catch { return "auto"; } };
const showTheme = (t) => { tb.textContent = glyph[t]; tb.setAttribute("aria-label", `Theme: ${t}`); tb.title = `Theme: ${t}`; };
showTheme(getTheme());
tb.addEventListener("click", () => {
  const t = order[(order.indexOf(getTheme()) + 1) % order.length];
  try { t === "auto" ? localStorage.removeItem("theme") : localStorage.setItem("theme", t); } catch {}
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  showTheme(t);
});
