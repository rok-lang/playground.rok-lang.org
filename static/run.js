// Runs one compiled program, off the page's thread so a loop cannot
// freeze it: output goes back line by line, then the exit code.
import { load } from "./rok.mjs";

onmessage = async ({ data }) => {
  const dec = [new TextDecoder(), new TextDecoder()];
  const write = (fd, bytes) => postMessage({ fd, text: dec[fd === 2 ? 1 : 0].decode(bytes, { stream: true }) });
  try {
    const app = await load(data, { args: ["main"], write });
    postMessage({ code: app.main() });
  } catch (e) {
    postMessage({ error: String(e && e.message || e) });
  }
};
