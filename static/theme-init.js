// Theme class before first paint; a file because the CSP bars inline scripts.
// The `theme` cookie is shared by every *.rok-lang.org site, so it wins.
try {
  var m = document.cookie.match(/(?:^|;\s*)theme=(light|dark)(?:;|$)/);
  var t = m ? m[1] : localStorage.getItem("theme");
  if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.className = "rk " + (t === "dark" ? "dk" : "lt");
} catch (e) { document.documentElement.className = "rk lt"; }
