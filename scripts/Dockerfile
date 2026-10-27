# A throwaway container for one rokc build, play.rust-lang.org style:
# each compile runs rokc here, with no network, a memory cap, a read-only
# root and a tmpfs. The toolchain is baked in read-only; rokc links its
# own LLVM and linker and ships the C library for each target, so nothing
# else is needed to build for wasm32-unknown-unknown.
#
#   docker build -t rok-playground:<version> \
#     --build-arg TOOLCHAIN=rok-<version>-x86_64-unknown-linux-gnu \
#     -f scripts/Dockerfile <dir holding the unpacked toolchain>
FROM debian:bookworm-slim
ARG TOOLCHAIN
COPY ${TOOLCHAIN}/ /opt/rok/
ENV PATH=/opt/rok/bin:$PATH NO_COLOR=1 ROKC_INCREMENTAL=0
WORKDIR /job
ENTRYPOINT ["rokc"]
