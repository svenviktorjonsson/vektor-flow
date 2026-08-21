FROM ubuntu:24.04

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        clang \
        ghc \
        ocaml-nox \
        perl \
    && rm -rf /var/lib/apt/lists/*

COPY scalar-control.c scalar-control.hs scalar-control.ml run.pl /bench/

WORKDIR /bench
