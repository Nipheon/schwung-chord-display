#!/usr/bin/env bash
# Build the Chord Display audio FX (ARM64). Uses Docker for cross-compilation
# unless CROSS_PREFIX is set (e.g. a native ARM build).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
IMAGE_NAME="move-anything-builder"

if [ -z "$CROSS_PREFIX" ] && [ ! -f "/.dockerenv" ]; then
    if ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
        docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile" "$REPO_ROOT"
    fi
    docker run --rm -v "$REPO_ROOT:/build" -u "$(id -u):$(id -g)" -w /build \
        "$IMAGE_NAME" ./scripts/build.sh
    exit 0
fi

CROSS_PREFIX="${CROSS_PREFIX:-aarch64-linux-gnu-}"
cd "$REPO_ROOT"

# An audio_fx is loaded by the chain host as <id>/<id>.so, whatever module.json says.
rm -rf dist/chord-display dist/chord-display-module.tar.gz
mkdir -p build dist/chord-display
${CROSS_PREFIX}gcc -O2 -shared -fPIC \
    -march=armv8-a -mtune=cortex-a72 \
    -fno-stack-protector -DNDEBUG \
    -Wall -Wextra \
    src/dsp/chord_display.c \
    -o build/chord-display.so \
    -Isrc/dsp \
    -ldl

# cat, not cp: avoids ExtFS deallocation issues with Docker mounts
cat src/module.json > dist/chord-display/module.json
cat src/canvas.js > dist/chord-display/canvas.js
cat src/help.json > dist/chord-display/help.json
cat build/chord-display.so > dist/chord-display/chord-display.so
chmod +x dist/chord-display/chord-display.so

(cd dist && tar -czf chord-display-module.tar.gz chord-display/)
echo "Tarball: dist/chord-display-module.tar.gz"
