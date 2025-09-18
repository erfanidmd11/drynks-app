#!/usr/bin/env bash
set -euo pipefail

echo "──────────────── DrYnks Handoff Snapshot ────────────────"
date
echo

# Basic env
echo "Node:     $(node -v)"
echo "NPM:      $(npm -v || true)"
echo "Yarn:     $(yarn -v || true)"
echo "PNPM:     $(pnpm -v || true)"
echo "Expo CLI: $(npx expo --version)"
echo

# Project info
if [ -f package.json ]; then
  echo "package.json name/version:"
  node -pe "require('./package.json').name + ' @ ' + require('./package.json').version"
  echo "Dependencies (top 20):"
  node -e "const p=require('./package.json'); console.log(Object.entries(p.dependencies||{}).slice(0,20).map(([k,v])=>k+'@'+v).join(', '))"
fi
echo

# Git info
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Git:"
  echo "  Branch:  $(git rev-parse --abbrev-ref HEAD)"
  echo "  Commit:  $(git rev-parse --short HEAD)"
  echo "  Status:"
  git status -s || true
fi
echo

# Expo/React Native versions
echo "React Native version:"
node -pe "require('./node_modules/react-native/package.json').version" 2>/dev/null || echo "n/a"
echo "Expo SDK:"
node -e "try{console.log(require('./package.json').dependencies['expo'])}catch(e){console.log('n/a')}"
echo

# Quick static scan for Platform misuse
echo "Scan: files that use Platform.* but don't obviously import it"
echo "(heuristic; please eyeball results)"
echo "-----------------------------------------------------------"
# Only scan src/, app/, and top-level TSX/JSX files
FILES=$(git ls-files '**/*.ts' '**/*.tsx' '**/*.js' '**/*.jsx' 2>/dev/null | grep -E '^(src|app|App\.tsx|index\.(js|ts)x?)')
MISUSE=0
while IFS= read -r f; do
  grep -q "Platform\." "$f" || continue
  grep -Eq "import\s*{\s*Platform\s*}\s*from\s*'react-native'" "$f" && continue
  echo "⚠️  $f"
  MISUSE=1
done <<< "$FILES"
if [ "$MISUSE" -eq 0 ]; then echo "✓ none detected"; fi
echo

# Masked env (safe to paste)
echo "Environment (masked):"
echo "  SUPABASE_URL: $(echo ${SUPABASE_URL:-unset} | sed 's/https:\\/\\///')"
echo "  SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY:-unset} | length $(echo -n ${SUPABASE_ANON_KEY:-} | wc -c | tr -d ' ')"
echo "  GOOGLE_API_KEY: ${GOOGLE_API_KEY:+set}"
echo "  EXPO_PUBLIC_GOOGLE_API_KEY: ${EXPO_PUBLIC_GOOGLE_API_KEY:+set}"
echo

echo "Run:  npm run start:dev"
echo "If the app crashes at launch, attach the last 50 Metro lines:"
echo "  (press 'j' for debugger; or copy terminal output)"
echo
echo "──────────────── End Snapshot ────────────────────────────"
