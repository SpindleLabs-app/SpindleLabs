#!/usr/bin/env bash
# Takes a picture of every failure's 3D page: each
# DIR/**/failure-dumps/<dump>/index.html (the kernel's failure dumps: the
# failing bodies as STL, OBJ and STEP with a page that draws them, the
# problem in red) gets picture.png beside it, which file_issues.py shows in
# the failure's issue (Ben, 2026-11-04: see a failure without replaying it).
#
#   dump_pictures.sh DIR
#
# With the runner's own headless Chrome (CHROME, or the first of
# google-chrome, chromium, chromium-browser on PATH; GitHub's Ubuntu runners
# have Chrome), so no package is installed beside the results key. Best
# effort: no browser, or a page that doesn't draw in 30 s, leaves no picture
# and never fails the run. Bounded so collect always finishes: at most
# MAX_PICTURES (default 40), no new picture after TOTAL_SECONDS (default
# 240), and none after two pages in a row fail (the browser is broken).
# Prints one line, "pictures N of M", and nothing from the pages or the
# browser.
set -uo pipefail
dir=${1:?usage: dump_pictures.sh DIR}
chrome=${CHROME:-}
if [ -z "$chrome" ]; then
  for c in google-chrome chromium chromium-browser; do
    command -v "$c" >/dev/null 2>&1 && { chrome=$c; break; }
  done
fi
max=${MAX_PICTURES:-40} total_seconds=${TOTAL_SECONDS:-240}
pages=$(find "$dir" -path '*/failure-dumps/*/index.html' -type f 2>/dev/null | sort)
total=$(printf '%s' "$pages" | grep -c . || true)
made=0 failed=0 start=$SECONDS
if [ -n "$chrome" ] && [ -n "$pages" ]; then
  while IFS= read -r page; do
    [ "$made" -lt "$max" ] && [ "$failed" -lt 2 ] && [ $((SECONDS - start)) -lt "$total_seconds" ] || break
    at=$(cd "$(dirname "$page")" && pwd)
    rm -f "$at/picture.png"
    # The page draws once, as it loads, so the shot is taken after that.
    timeout -k 5 30 "$chrome" --headless --no-sandbox --disable-gpu --hide-scrollbars --no-first-run \
      --window-size=1200,800 --screenshot="$at/picture.png" "file://$at/index.html" >/dev/null 2>&1 </dev/null
    if [ "$(head -c 4 "$at/picture.png" 2>/dev/null | tail -c 3)" = PNG ]; then
      made=$((made + 1)) failed=0
    else
      rm -f "$at/picture.png"
      failed=$((failed + 1))
    fi
  done <<<"$pages"
fi
echo "pictures $made of $total"
