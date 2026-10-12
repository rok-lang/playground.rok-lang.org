#!/bin/sh
# One rokc build of untrusted source, on Linux: PLAY_WRAP=scripts/sandbox.sh.
#
#   sandbox.sh <toolchain>/bin/rokc <args..>      (run in the job directory)
#
# rokc can read any file it can reach at compile time (include_bytes!,
# #[path], WIT) and put it in the module it writes, so it sees only the
# job directory (writable), its toolchain and /usr (read-only), and a
# fresh /proc and a /dev with only null: no /etc, no home directories, no network, no
# other processes. Limits: 16 GiB of address space (rokc reserves a 1 GiB
# stack and LLVM's threads; cap real memory with a cgroup, README.md), 60 s of CPU, 64 MiB
# per file written; the server's PLAY_TIMEOUT kills it before that.
# Needs bubblewrap and util-linux's prlimit. PLAY_ROKC must be the
# toolchain's own rokc (not the ~/.rok/bin proxy), so its lib/ is bound.
set -eu
# Mounts go in order: /tmp's tmpfs first, then the job directory (often
# under /tmp) on top of it.

[ $# -ge 1 ] || { echo "usage: sandbox.sh <toolchain>/bin/rokc <args..>" >&2; exit 2; }
rokc=$1
shift
root=$(cd "$(dirname "$rokc")/.." && pwd)
job=$(pwd)

exec prlimit --as=17179869184 --cpu=60 --fsize=67108864 --core=0 -- \
  bwrap --unshare-all --die-with-parent --new-session --clearenv \
    --setenv PATH /usr/bin:/bin --setenv HOME "$job" --setenv TMPDIR "$job" \
    --setenv NO_COLOR 1 --setenv ROKC_INCREMENTAL 0 \
    --ro-bind /usr /usr \
    --ro-bind-try /lib /lib --ro-bind-try /lib64 /lib64 \
    --proc /proc --tmpfs /dev --dev-bind /dev/null /dev/null --tmpfs /tmp \
    --ro-bind "$root" "$root" \
    --bind "$job" "$job" --chdir "$job" \
    -- "$root/bin/rokc" "$@"
