// Runs one compiled program, off the page's thread so a loop cannot
// freeze it: output goes back line by line, then the exit code. Past
// what the page shows, output is dropped here, so a program that
// prints forever cannot flood the page with messages.
import { load } from "./rok.mjs";

onmessage = async ({ data: { wasm, lines, chars } }) => {
  const dec = [new TextDecoder(), new TextDecoder()];
  const write = (fd, bytes) => {
    if (lines < 0 || chars < 0) return;
    const text = dec[fd === 2 ? 1 : 0].decode(bytes, { stream: true });
    chars -= text.length;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lines--;
    postMessage({ fd, text });
  };
  try {
    const app = await load(wasm, { args: ["main"], write });
    postMessage({ code: app.main() });
  } catch (e) {
    postMessage({ error: String(e && e.message || e) });
  }
};
