#!/bin/sh
# One rokc build of untrusted source in a throwaway container, the way
# play.rust-lang.org runs rustc: PLAY_WRAP=scripts/docker-sandbox.sh.
#
#   docker-sandbox.sh <rokc> <args..>      (run in the job directory)
#
# The host rokc path is ignored; the image's own rokc runs. The job
# directory is the only writable mount, there is no network, the root is
# read-only, and Docker's cgroup caps memory (so no OOM of the host) and
# CPUs. Build the image first (scripts/Dockerfile). Set PLAY_IMAGE,
# PLAY_MEM, PLAY_CPUS to override.
set -eu

[ $# -ge 1 ] || { echo "usage: docker-sandbox.sh <rokc> <args..>" >&2; exit 2; }
shift   # the host rokc; the image carries its own toolchain
job=$(pwd)

exec docker run --rm \
  --network none \
  --memory "${PLAY_MEM:-4g}" --memory-swap "${PLAY_MEM:-4g}" \
  --cpus "${PLAY_CPUS:-2}" --pids-limit 128 \
  --read-only --tmpfs /tmp:size=256m,exec \
  --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  --env HOME=/job --env TMPDIR=/job \
  --volume "$job":/job --workdir /job \
  "${PLAY_IMAGE:-rok-playground:0.1.0}" "$@"
