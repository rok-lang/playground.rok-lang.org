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
ed.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); run(); return; }
  if (ev.key === "Tab" && !ev.shiftKey && !ev.altKey) {
    ev.preventDefault();
    document.execCommand("insertText", false, "    ");
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
  const s = new Blob([unb64(code)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(s).text();
}
function save() {
  if (pick.value && ed.value !== pick.dataset.text) pick.value = "";
  try { localStorage.setItem("play.code", ed.value); } catch {}
}

$("share").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}#code=${await pack(ed.value)}`;
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
}
$("clear").addEventListener("click", () => out.replaceChildren());

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

// ---- start: the link's code, else the last session's, else hello ----

(async () => {
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
