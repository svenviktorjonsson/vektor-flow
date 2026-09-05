FROM emscripten/emsdk:4.0.14
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    clang-14 lld-14 llvm-14 qemu-user
WORKDIR /src
