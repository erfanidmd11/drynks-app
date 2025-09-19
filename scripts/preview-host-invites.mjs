#!/usr/bin/env node
/**
 * Rename 'host_id' -> 'inviter_id' **only** for code that touches public.invites
 * or v_received_invites (and Invite* types), without disturbing other host_id usages.
 *
 * Usage:
 *   npm run codemod:invites         # apply changes
 *
 * Notes:
 * - Idempotent (re-running does nothing if already migrated).
 * - Skips files under supabase/.
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
  // Supports ', " and ` quotes. Works within ~800 chars window.
  const re = new RegExp(
    String.raw`(\.from\(\s*['"\`])${table}(['"\`]\s*\)(?:(?!;\s*$)[\s\S]){0,800}?\.select\(\s*(['"\`]))` +
      String.raw`([\s\S]*?)` + // the select list
      String.raw`(\3)\s*\)`,
    'gmi'
  );
  return src.replace(re, (m, q1, q2, q3, inner, qEnd) => {
    const updated = inner.replace(/\bhost_id\b/g, 'inviter_id');
    return `${q1}${table}${q2}${m.slice((`${q1}${table}${q2}`).length).replace(inner, updated)}`;
  });
}

function replaceInsertOrUpdateForInvites(src) {
  // Replace object literal keys `host_id:` → `inviter_id:` within invites insert/update calls.
  // Limit the lookahead window to avoid cross-statement edits.
  const pat = /\.from\(\s*['"`]invites['"`]\s*\)(?:(?!;\s*$)[\s\S]){0,800}?\.(insert|update)\(\s*([\s\S]*?)\)\s*/gmi;
  return src.replace(pat, (full, method, argsBody) => {
    const fixed = argsBody.replace(/(\b)host_id(\s*:)/g, '$1inviter_id$2');
    return full.replace(argsBody, fixed);
  });
}

function replaceLineWiseWhenInvitey(line) {
  // If a single line mentions "Invite" or "invites" or the view name AND contains host_id,
  // rename alone on that line (e.g., type shapes or simple mappings).
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

  // 3) Last-pass, line-wise: if a line mentions Invite-ish context and host_id, rename it.
  //    Helps with simple mappings and type/interface literals.
  const beforeLines = out.split('\n');
  const afterLines = beforeLines.map(replaceLineWiseWhenInvitey);
  out = afterLines.join('\n');

  if (out !== src) {
    fs.writeFileSync(absPath, out, 'utf8');
    return { rel, changed: true };
  }
  return { rel, changed: false };
}

function main() {
  const files = gitFiles([
    '*.ts',
    '*.tsx',
    '*.js',
    '*.jsx',
    'src/**/*.ts',
    'src/**/*.tsx',
    'src/**/*.js',
    'src/**/*.jsx',
    'scripts/**/*.ts',
    'scripts/**/*.js',
    'app/**/*.ts',
    'app/**/*.tsx',
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
        console.log(`✔ fixed: ${rel}`);
      }
    } catch (e) {
      console.warn(`⚠︎ skipped with error: ${rel}\n  ${String(e)}`);
    }
  }

  console.log('\n-- Summary --');
  console.log(`Scanned: ${scanned} files`);
  console.log(`Changed: ${changed} files`);
  if (changed === 0) {
    console.log('No edits were necessary (already migrated or no invite-related host_id present).');
  } else {
    console.log('Review changes and commit:\n  git add -A && git commit -m "refactor: invites host_id -> inviter_id"');
  }
}

main();
