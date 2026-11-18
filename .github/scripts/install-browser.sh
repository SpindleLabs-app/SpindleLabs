#!/usr/bin/env bash
# Installs one Playwright browser and the system packages it needs, for the
# browser checks in .github/workflows/ci.yml and nightly.yml. Run from
# apps/fission (where playwright is installed).
#
# `npx playwright install --with-deps` runs apt-get, which can stall on the
# Ubuntu mirror (it hung #251's and #252's runs for 13 minutes). So apt
# retries each download and gives up on a silent connection after 30 s (a
# stall limit, not a total one: a slow mirror that keeps sending is left to
# finish). The packages get PACKAGE_SECONDS (default 420) a try and the
# browser download BROWSER_SECONDS (default 240), three tries in all, but the
# whole script never runs past TOTAL_SECONDS (default 1500): each limit is cut
# to what is left of it, so a dead mirror fails the job in 25 minutes at most.
# A healthy run takes about two minutes; apt keeps what a killed try had
# already downloaded, so a slow mirror's tries add up rather than start over.
# Try 2 switches apt from the runner's own regional mirror (Azure's, or since
# 2026-11-18 an EC2 one such as us-east-2.ec2.archive.ubuntu.com) to
# archive.ubuntu.com, in case that mirror is the slow one (on 2026-10-26
# Azure's sent 52 MB of packages at about 100 kB/s, three tries of 720 s ran
# out and Firefox never installed; on 2026-11-18 the EC2 one took 5 to 60 s a
# package, and as the old switch only knew Azure's name all three tries stayed
# on it and WebKit never installed). Try 3 moves to the fallback mirror
# (FALLBACK_MIRROR, default mirrors.edge.kernel.org, run by someone else
# entirely) when it resolves, in case Ubuntu's own hosts are the slow ones.
#
# APT_CACHE, when set, is a folder apt keeps the downloaded packages in, and
# the Playwright browsers stay in ~/.cache/ms-playwright: ci.yml caches both
# between runs (keyed on the image and the lock file), so a run with a warm
# cache downloads nothing but apt's index. The folder is handed back to the
# runner user at the end so the cache step can save it, and the setting is
# removed again so the job's later apt-get calls leave that folder alone.
# Ubuntu 24.04 runners name their mirrors in apt-mirrors.txt (ubuntu.sources
# points at it as `mirror+file:`), Azure's first, so that file is rewritten
# too; older images named the mirror in sources.list. The packages are
# installed by a `timeout` running as root: timeout signals its whole process
# group, and only root may signal the apt-get it starts (as the runner user,
# the killed attempt left apt-get running, holding the dpkg lock the next try
# then failed on). A killed install is repaired with `dpkg --configure -a`
# before the next try, and apt waits up to 120 s for a lock still held. The
# browser itself downloads as the runner user, into its own cache, as before.
#
# If no Ubuntu mirror even resolves (on 2026-11-11 the new ubuntu-26.04 image
# had no DNS for them: every try waited out its whole limit and the job failed
# after 22 minutes), the system packages are skipped after a 10 s probe and
# only the browser is installed. The runner image already holds the libraries
# the browsers need; at most the extra fonts are missing, and a browser that
# then cannot start or a golden image that differs fails the test loudly.
#
# APT_DIR (default /etc/apt) and RETRY_SLEEP (default 15 s between tries) are
# for test_install_browser.py, which runs this script against a copy of a
# runner's apt files with fake sudo, npx and dpkg programs.
#
# Usage: install-browser.sh <chromium|firefox|webkit>
set -u
browser=$1
package_seconds=${PACKAGE_SECONDS:-420}
browser_seconds=${BROWSER_SECONDS:-240}
total_seconds=${TOTAL_SECONDS:-1500}
retry_sleep=${RETRY_SLEEP:-15}
apt_dir=${APT_DIR:-/etc/apt}
start=$SECONDS
mirror_probe=${MIRROR_PROBE:-getent hosts}

printf 'Acquire::Retries "3";\nAcquire::http::Timeout "30";\nDPkg::Lock::Timeout "120";\n' \
  | sudo tee "$apt_dir/apt.conf.d/80-retries" > /dev/null

apt_cache=${APT_CACHE:-}
if [ -n "$apt_cache" ]; then
  mkdir -p "$apt_cache/partial"
  printf 'Dir::Cache::Archives "%s/";\n' "$apt_cache" | sudo tee "$apt_dir/apt.conf.d/81-cache" > /dev/null
  # apt (as root) leaves its files root-owned and partial/ readable by _apt only: the cache step, as the runner
  # user, could not save them.
  # The setting goes too, so the job's later apt-get calls leave the cached folder alone.
  trap 'sudo rm -f "$apt_dir/apt.conf.d/81-cache"; sudo chown -R "$(id -u):$(id -g)" "$apt_cache" 2>/dev/null; true' EXIT
fi

# The smaller of a per-step limit and the time left in the total budget (at
# least 1 s, so `timeout` always gets a positive number).
limit() {
  local left=$((total_seconds - (SECONDS - start)))
  [ "$left" -lt 1 ] && left=1
  [ "$1" -lt "$left" ] && echo "$1" || echo "$left"
}

# Try 2: every regional mirror (azure.archive.ubuntu.com, us-east-2.ec2.archive.ubuntu.com, ...) becomes
# archive.ubuntu.com: in the mirror list (its first line, so archive.ubuntu.com is tried first; the list may then
# name it twice, which apt doesn't mind) and in the older sources files.
# Try 3: the fallback mirror, if it resolves, replaces the list and every Ubuntu host in the sources files.
other_mirror() {
  if [ "$1" = 2 ]; then
    sudo sh -c "sed -i 's#[a-z0-9.-]*\.archive\.ubuntu\.com#archive.ubuntu.com#g' '$apt_dir/apt-mirrors.txt' '$apt_dir/sources.list' '$apt_dir'/sources.list.d/* 2>/dev/null; true"
  elif timeout 10 $mirror_probe "$fallback_mirror" > /dev/null 2>&1; then
    echo "install-browser: try $1 uses $fallback_mirror" >&2
    use_fallback
  fi
}

# Succeeds if any mirror host resolves (the Azure one first, then the plain ones).
mirrors_resolve() {
  local host
  for host in azure.archive.ubuntu.com archive.ubuntu.com security.ubuntu.com; do
    timeout 10 $mirror_probe "$host" > /dev/null 2>&1 && return 0
  done
  return 1
}

# Fallback mirror, used when none of Ubuntu's own hosts resolves (the same
# runners reach other hosts; WebKit and Firefox need packages the image lacks).
fallback_mirror=${FALLBACK_MIRROR:-mirrors.edge.kernel.org}
use_fallback() {
  sudo sh -c "printf 'http://$fallback_mirror/ubuntu/\tpriority:1\n' > '$apt_dir/apt-mirrors.txt'; sed -i 's#https\?://[a-z0-9.-]*ubuntu\.com/ubuntu/\?#http://$fallback_mirror/ubuntu/#g' '$apt_dir/sources.list' '$apt_dir'/sources.list.d/*.sources 2>/dev/null; true"
}

if ! mirrors_resolve; then
  if timeout 10 $mirror_probe "$fallback_mirror" > /dev/null 2>&1; then
    echo "install-browser: no Ubuntu mirror resolves; using $fallback_mirror" >&2
    use_fallback
  else
    echo "install-browser: no Ubuntu mirror resolves; skipping the system packages (the runner image has the libraries)" >&2
    for try in 1 2 3; do
      timeout -k 15 "$(limit "$browser_seconds")" npx playwright install "$browser" && exit 0
      echo "install-browser: browser try $try of 3 failed" >&2
      [ "$try" = 3 ] && exit 1
      sleep "$retry_sleep"
    done
  fi
fi

for try in 1 2 3; do
  [ "$try" -gt 1 ] && other_mirror "$try"
  if sudo env "PATH=$PATH" timeout -k 15 "$(limit "$package_seconds")" npx playwright install-deps "$browser" \
    && timeout -k 15 "$(limit "$browser_seconds")" npx playwright install "$browser"; then
    exit 0
  fi
  echo "install-browser: try $try of 3 failed" >&2
  [ "$try" = 3 ] && exit 1
  [ $((SECONDS - start)) -ge "$total_seconds" ] && { echo "install-browser: out of time" >&2; exit 1; }
  sudo dpkg --configure -a || true
  sleep "$retry_sleep"
done
