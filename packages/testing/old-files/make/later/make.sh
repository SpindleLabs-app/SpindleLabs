#!/bin/bash
# Makes the later old files (old-files/later/, Design data versions 9 to 15) by running each older SpindleLabs's
# own document functions on its own committed kernel (save/load hunt, 2026-11-11; #512 item 2):
#   ./make.sh   (from packages/testing/old-files/make/later; needs `npm ci` at the root)
# A worktree of each commit borrows this checkout's node_modules, its @fission packages pointing into the worktree.
# rich.ts takes LEVEL (the newest Design version whose features it uses), combine.ts TOOLX (where the cutting box
# starts along x). Remade files are byte for byte the ones kept: `git diff ../../later` shows nothing.
set -e
here=$(cd "$(dirname "$0")" && pwd); root=$(git -C "$here" rev-parse --show-toplevel); out=$here/../../later
make() { # <commit> <script> <file> [LEVEL] [TOOLX]
  wt=${TMPDIR:-/tmp}/spindlelabs-old-$1
  if [ ! -d "$wt" ]; then
    git -C "$root" worktree add -q --detach "$wt" "$1"
    mkdir -p "$wt/node_modules/@fission"
    for e in "$root"/node_modules/* "$root"/node_modules/.bin; do n=$(basename "$e"); [ "$n" = "@fission" ] || ln -s "$e" "$wt/node_modules/$n"; done
    for p in "$root"/node_modules/@fission/*; do ln -s "$(readlink -f "$p" | sed "s|^$root|$wt|")" "$wt/node_modules/@fission/$(basename "$p")"; done
  fi
  (cd "$wt" && ROOT=$wt LEVEL=$4 TOOLX=$5 node --experimental-strip-types --no-warnings "$here/$2" "$out/$3" >/dev/null)
}
make ea1e562 rich.ts v9-rich.spindlelabs.json 9      # #349, 2026-11-07: the last main at Design version 9
make dd32b65 rich.ts v12-rich.spindlelabs.json 12    # #440, 2026-11-07: version 12
make c644c66 rich.ts v13-rich.spindlelabs.json 13    # #450, 2026-11-08: version 13
make 327bc19 rich.ts v14-rich.spindlelabs.json 14    # #451, 2026-11-08: version 14
make 9188c89 rich.ts v15-rich.spindlelabs.json 15    # #462, 2026-11-08: version 15
make 9188c89 join.ts v15-join-piece.spindlelabs.json
make dd32b65 combine.ts v12-cut-unequal.spindlelabs.json "" 10
make dd32b65 combine.ts v12-cut-equal.spindlelabs.json "" 13
