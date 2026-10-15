#!/bin/sh
# One rokc build of untrusted source in a throwaway container, the way
# play.rust-lang.org runs rustc: PLAY_WRAP=scripts/docker-sandbox.sh.
#
#   docker-sandbox.sh <rokc> <args..>      (run in the job directory)
#
# The host rokc path is ignored; the image's own rokc runs. The job
# directory is the only writable mount, there is no network, the root is
# read-only, and Docker's cgroup caps memory (so the container, not the
# host, is OOM-killed) and CPUs. No IPC namespace, a capped open-file
# count, and a small no-exec /tmp. Build the image first (scripts/Dockerfile). Set PLAY_IMAGE,
# PLAY_MEM, PLAY_CPUS to override.
set -eu

[ $# -ge 1 ] || { echo "usage: docker-sandbox.sh <rokc> <args..>" >&2; exit 2; }
shift   # the host rokc; the image carries its own toolchain
job=$(pwd)

exec docker run --rm \
  --network none \
  --ipc none \
  --memory "${PLAY_MEM:-4g}" --memory-swap "${PLAY_MEM:-4g}" \
  --cpus "${PLAY_CPUS:-2}" --pids-limit 128 \
  --ulimit nofile=512:512 --ulimit fsize=67108864 \
  --read-only --tmpfs /tmp:size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  --env HOME=/job --env TMPDIR=/job \
  --volume "$job":/job --workdir /job \
  "${PLAY_IMAGE:-rok-playground:0.1.0}" "$@"
