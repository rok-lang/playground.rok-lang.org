// The reader's theme, before the page paints (a file: the CSP allows no inline script).
try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
