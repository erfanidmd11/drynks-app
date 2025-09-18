import fs from "fs";
import path from "path";

const roots = ["src", "app"].filter((p) => fs.existsSync(p));
const exts = new Set([".ts", ".tsx", ".js", ".jsx"]);
const ignoreDirs = new Set(["node_modules", "ios", "android", "build", "dist", ".expo", ".git"]);

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

function transformInvitesChains(text) {
  const re = /\.from\(\s*['"`]invites['"`]\s*\)/g;
  let m;
  let out = "";
  let cursor = 0;

  while ((m = re.exec(text))) {
    const start = m.index;
    const before = text.slice(cursor, start);

    const tail = text.slice(start);
    const semi = tail.indexOf(";");
    // heuristic: limit to ~2000 chars to avoid huge blocks w/o semicolon
    const chainEnd = start + (semi >= 0 ? Math.min(semi + 1, 2000) : Math.min(tail.length, 2000));
    const seg = text.slice(start, chainEnd);

    const replaced = seg
      // .select('id, date_id, host_id, invitee_id, status')
      .replace(/(\.select\(\s*['"`][^'"`]*?)\bhost_id\b/g, "$1inviter_id")
      // filters: .eq('host_id' ...), .neq/.in/.is/.order/.contains/.like/.ilike
      .replace(/\.(eq|neq|in|is|order|contains|like|ilike)\(\s*['"`]host_id['"`]/g, ".$1('inviter_id'")
      // payload keys inside object literals for insert/update
      .replace(/(\{[^{}]{0,400}?)\bhost_id\b(\s*:)/g, "$1inviter_id$2")
      // property access .host_id
      .replace(/\.host_id\b/g, ".inviter_id");

    out += before + replaced;
    cursor = chainEnd;
  }

  if (cursor === 0) return text;
  out += text.slice(cursor);
  return out;
}

function transformInviteTypes(text) {
  // rename host_id property inside "Invite"ish types
  const blockRe = /(interface|type)\s+([A-Za-z0-9_]*Invite[A-Za-z0-9_]*|InviteRow|InvitesRow)\b[\s\S]{0,2000}?}/g;
  return text
    .replace(blockRe, (blk) => blk.replace(/\bhost_id(\s*\??\s*:)/g, "inviter_id$1"))
    // fallback: direct property in union/type defs
    .replace(/\bhost_id(\s*\??\s*:)/g, "inviter_id$1");
}

function maybeTransformInviteScreens(file, text) {
  // For ReceivedInvites / SentInvites screens we also normalize object literal keys
  if (!/Invites/i.test(file) && !/ReceivedInvites|SentInvites/i.test(text)) return text;
  return text.replace(/(\{[^{}]{0,800}?)\bhost_id\b(\s*:)/g, "$1inviter_id$2");
}

function processFile(file) {
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes("host_id")) return false;

  const original = text;
  text = transformInvitesChains(text);
  text = transformInviteTypes(text);
  text = maybeTransformInviteScreens(file, text);

  if (text !== original) {
    fs.writeFileSync(file, text, "utf8");
    return true;
  }
  return false;
}

function main() {
  const files = roots.flatMap((r) => walk(r));
  if (files.length === 0) {
    console.error("No src/app folder found.");
    process.exit(1);
  }
  let changed = 0;
  for (const f of files) {
    try {
      changed += processFile(f) ? 1 : 0;
    } catch (e) {
      console.warn("Skip (error):", f, e?.message);
    }
  }
  console.log(changed === 0 ? "No changes were necessary." : `Done. Updated ${changed} file(s).`);
}

main();
