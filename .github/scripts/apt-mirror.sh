#!/usr/bin/env bash
# Points apt at a mirror that resolves, for the jobs that install packages
# (kernel-ci.yml's valgrind and PrusaSlicer step). Since 2026-11-11 the runners
# cannot resolve Ubuntu's own mirror hosts (azure.archive, archive, security
# .ubuntu.com: "Temporary failure resolving"): apt then waited out every
# 10-minute try, and kernel runs sat on their apt step for 80 minutes.
#
# If any of those hosts resolves, nothing changes. Otherwise, if the fallback
# mirror (FALLBACK_MIRROR, default mirrors.edge.kernel.org) resolves, the
# mirror list and the sources files are rewritten to it. If nothing resolves
# the script exits 1 at once (the caller's packages are not on the image, so
# there is nothing to wait for).
#
# APT_DIR (default /etc/apt) and MIRROR_PROBE (default `getent hosts`) are for
# test_apt_mirror.py.
set -u
apt_dir=${APT_DIR:-/etc/apt}
probe=${MIRROR_PROBE:-getent hosts}
fallback=${FALLBACK_MIRROR:-mirrors.edge.kernel.org}

for host in azure.archive.ubuntu.com archive.ubuntu.com security.ubuntu.com; do
  timeout 10 $probe "$host" > /dev/null 2>&1 && exit 0
done
if timeout 10 $probe "$fallback" > /dev/null 2>&1; then
  echo "apt-mirror: no Ubuntu mirror resolves; using $fallback" >&2
  sudo sh -c "printf 'http://$fallback/ubuntu/\\tpriority:1\\n' > '$apt_dir/apt-mirrors.txt'; sed -i 's#https\\?://[a-z.]*ubuntu\\.com/ubuntu/\\?#http://$fallback/ubuntu/#g' '$apt_dir/sources.list' '$apt_dir'/sources.list.d/*.sources 2>/dev/null; true"
  exit 0
fi
echo "apt-mirror: no Ubuntu mirror and no fallback resolves; the packages cannot be installed" >&2
exit 1
