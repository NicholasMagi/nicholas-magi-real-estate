#!/usr/bin/env bash
# Esegue tutte le prove nel browser (Chromium, Playwright) con Supabase simulato.
# Uso: bash tests/browser/run_all.sh   (dalla radice del repository)
set -uo pipefail
cd "$(dirname "$0")/../.."
failed=0
for spec in tests/browser/*.cjs; do
  case "$spec" in *serve_from_disk.cjs) continue;; esac
  echo "== $spec"
  if ! node -r ./tests/browser/serve_from_disk.cjs "$spec" tests/browser/stubs; then failed=$((failed+1)); fi
done
if [[ $failed -ne 0 ]]; then echo "$failed prove nel browser non superate" >&2; exit 1; fi
echo "Tutte le prove nel browser superate."
