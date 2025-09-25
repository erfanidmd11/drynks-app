#!/usr/bin/env node
/**
 * Codemod: rename 'host_id' -> 'inviter_id' ONLY in invite-related code:
 *
 *  - public.invites queries (.select/.insert/.update)
 *  - v_received_invites view selects
 *  - single-line types/props that clearly mention Invite/Invites/view
 *
 * Safety:
 *  - Skips the 'supabase/' folder
 *  - Limits replacements to a small window after .from('invites')
 *  - Idempotent (re-running does not keep changing)
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function gitFiles(globs) {
  const args = ['ls-files', '--'].concat(globs);
  const out = execSync(`git ${args.join(' ')}`, { encoding: 'utf8' });
  return out.split('\n').map(s => s.trim()).filter(Boolean);
}

function replaceSelectForTable(src, table) {
  // Matches: .from('table') ... .select(' id, date_id, host_id, ... ')
  // Supports ', " and ` quotes. Works within ~800 chars window between from() and select().
  const re = new RegExp(
    String.raw`(\.from\(\s*['"\`])${table}(['"\`]\s*\)(?:(?!;\s*$)[\s\S]){0,800}?\.select\(\s*(['"\`]))` +
    String.raw`([\s\S]*?)` + // the select list
    String.raw`(\3)\s*\)`,
    'gmi'
  );

  return src.replace(re, (full, _q1, _q2, _q3, inner /*, _qEnd */) => {
    const updatedInner = inner.replace(/\bhost_id\b/g, 'inviter_id');
    return full.replace(inner, updatedInner);
  });
}

function replaceInsertOrUpdateForInvites(src) {
  // Replace object literal keys `host_id:` → `inviter_id:` within invites insert/update calls.
  // Limit to ~800 chars after .from('invites') to avoid cross-statement edits.
  const pat = /\.from\(\s*['"`]invites['"`]\s*\)(?:(?!;\s*$)[\s\S]){0,800}?\.(insert|update)\(\s*([\s\S]*?)\)\s*/gmi;
  return src.replace(pat, (full, _method, argsBody) => {
    const fixed = argsBody
      // bare keys
      .replace(/(\b)host_id(\s*:)/g, '$1inviter_id$2')
      // string keys: {"host_id": ...}
      .replace(/(["'])host_id\1\s*:/g, '"inviter_id":');
    return full.replace(argsBody, fixed);
  });
}

function replaceInviteAdjacentLine(line) {
  // If a single line mentions "Invite" or "invites" or the view name and contains host_id,
  // rename on that line only (helps with TS interfaces and prop objects).
  if (!/\bhost_id\b/.test(line)) return line;
  if (/(Invite|invites|v_received_invites)/i.test(line)) {
    return line.replace(/\bhost_id\b/g, 'inviter_id');
  }
  return line;
}

function processFile(absPath) {
  const rel = path.relative(repoRoot, absPath);
  if (rel.startsWith('supabase/')) return { rel, changed: false, reason: 'skip supabase/' };

  const src = fs.readFileSync(absPath, 'utf8');
  let out = src;

  // 1) .select() field lists for invites + view
  out = replaceSelectForTable(out, 'invites');
  out = replaceSelectForTable(out, 'v_received_invites');

  // 2) .insert(...) / .update(...) payload keys for invites
  out = replaceInsertOrUpdateForInvites(out);

  // 3) Line-wise invite-adjacent shapes (types/props)
  out = out.split('\n').map(replaceInviteAdjacentLine).join('\n');

  if (out !== src) {
    fs.writeFileSync(absPath, out, 'utf8');
    return { rel, changed: true };
  }
  return { rel, changed: false };
}

function main() {
  const files = gitFiles([
    '*.ts','*.tsx','*.js','*.jsx',
    'src/**/*.ts','src/**/*.tsx','src/**/*.js','src/**/*.jsx',
    'app/**/*.ts','app/**/*.tsx',
    'scripts/**/*.ts','scripts/**/*.js'
  ]);

  let changed = 0;
  let scanned = 0;

  for (const rel of files) {
    const abs = path.join(repoRoot, rel);
    try {
      const res = processFile(abs);
      scanned++;
      if (res.changed) {
        changed++;
        console.log(`fixed: ${rel}`);
      }
    } catch (e) {
      console.warn(`skipped with error: ${rel}\n  ${String(e)}`);
    }
  }

  console.log('\n-- Summary --');
  console.log(`Scanned: ${scanned} files`);
  console.log(`Changed: ${changed} files`);
  if (changed === 0) {
    console.log('No edits were necessary (already migrated or no invite-related host_id present).');
  } else {
    console.log('Review and commit:\n  git add -A && git commit -m "refactor: invites host_id -> inviter_id"');
  }
}

main();
