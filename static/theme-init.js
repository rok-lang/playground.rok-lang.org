// Theme class before first paint; a file because the CSP bars inline scripts.
try {
  var t = localStorage.getItem("theme");
  if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.className = "rk " + (t === "dark" ? "dk" : "lt");
} catch (e) { document.documentElement.className = "rk lt"; }
