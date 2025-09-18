import fs from "fs";
import path from "path";

const roots = ["src", "app"].filter((p) => fs.existsSync(p));
const exts = new Set([".ts", ".tsx", ".js", ".jsx"]);
const ignoreDirs = new Set(["node_modules", "ios", "android", "build", "dist", ".expo", ".git"]);

const around = 160;
let hits = 0;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoreDirs.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else {
      const ext = path.extname(entry.name);
      if (exts.has(ext)) out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function previewFile(file) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("host_id")) return;

  let idx = 0;
  while ((idx = text.indexOf("host_id", idx)) !== -1) {
    const start = Math.max(0, idx - around);
    const end = Math.min(text.length, idx + around);
    const snippet = text.slice(start, end);
    if (snippet.toLowerCase().includes("invites")) {
      const line = text.slice(0, idx).split("\n").length;
      const clean = snippet.replace(/\n/g, "↵");
      console.log(`${file}:${line}: ...${clean}...`);
      hits++;
    }
    idx = idx + "host_id".length;
  }
}

if (roots.length === 0) {
  console.error("No src/app folder found.");
  process.exit(1);
}
for (const root of roots) for (const f of walk(root)) previewFile(f);

if (hits === 0) {
  console.log("No invite-related host_id occurrences found.");
} else {
  console.log(`\nTotal matches: ${hits}`);
}
