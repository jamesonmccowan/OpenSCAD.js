#!/usr/bin/env bash
set -euo pipefail

install_deps=false
for argument in "$@"; do
    case "$argument" in
        --install-deps) install_deps=true ;;
        --help|-h)
            printf '%s\n' \
                'Usage: bash scripts/build-reference.sh [--install-deps]' \
                'Initialize and build the pinned native OpenSCAD test reference.' \
                '--install-deps installs Debian/Ubuntu build packages using apt-get.' \
                'Package installation requires root or passwordless sudo.' \
                'REFERENCE_BUILD_DIR selects the output directory (default: references/openscad/build).' \
                'REFERENCE_BUILD_JOBS selects 1-4 parallel jobs (default: 2).'
            exit 0
            ;;
        *) printf 'Unknown argument: %s\n' "$argument" >&2; exit 1 ;;
    esac
done

cd "$(dirname "$0")/.."
revision=7d44e5796cd489bcbfb8cef0720abe4db60ce35e
source_dir="$PWD/references/openscad"
build_dir="${REFERENCE_BUILD_DIR:-$source_dir/build}"
jobs="${REFERENCE_BUILD_JOBS:-2}"
if [[ ! "$jobs" =~ ^[1-4]$ ]]; then
    printf '%s\n' 'REFERENCE_BUILD_JOBS must be 1-4' >&2
    exit 1
fi

unset LD_LIBRARY_PATH LD_RUN_PATH LD_PRELOAD OPENSCAD_LIBRARIES GLEWDIR CMAKE_PREFIX_PATH
if "$install_deps"; then
    if ! command -v apt-get >/dev/null; then
        printf '%s\n' '--install-deps requires a Debian/Ubuntu host with apt-get; install equivalent build dependencies manually.' >&2
        exit 1
    fi
    elevate=()
    if (( EUID != 0 )); then
        elevate=(sudo -n)
    fi
    "${elevate[@]}" apt-get update
    "${elevate[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential cmake ninja-build pkg-config bison flex gettext \
        libcgal-dev libgmp-dev libmpfr-dev libeigen3-dev \
        libboost-regex-dev libboost-program-options-dev \
        libharfbuzz-dev libfontconfig1-dev libfreetype6-dev libglib2.0-dev \
        libdouble-conversion-dev libzip-dev libxml2-dev libssl-dev \
        libtbb-dev fonts-liberation python3
fi

for tool in git cmake ninja c++ pkg-config bison flex msgfmt; do
    if ! command -v "$tool" >/dev/null; then
        printf 'Missing build tool: %s. Install build dependencies or use --install-deps on Debian/Ubuntu.\n' "$tool" >&2
        exit 1
    fi
done

if [[ -e "$source_dir/.git" ]] && [[ "$(git -C "$source_dir" rev-parse HEAD)" != "$revision" ]]; then
    printf '%s\n' 'Native oracle source revision does not match the pinned profile; refusing to change an existing checkout.' >&2
    exit 1
fi
git submodule update --init --recursive -- references/openscad
if [[ "$(git -C "$source_dir" rev-parse HEAD)" != "$revision" ]]; then
    printf '%s\n' 'Native oracle source revision does not match the pinned profile' >&2
    exit 1
fi
if ! git -C "$source_dir" diff --quiet HEAD --; then
    printf '%s\n' 'Native oracle has tracked source changes; preserve or commit them before building the pinned reference.' >&2
    exit 1
fi

generator=(-G Ninja)
if [[ -f "$build_dir/CMakeCache.txt" ]]; then
    generator=()
fi
cmake -S "$source_dir" -B "$build_dir" "${generator[@]}" \
    -U 'GMP*' -U Eigen3_DIR -DCMAKE_SKIP_RPATH=ON \
    -DCMAKE_BUILD_TYPE=Release -DOPENSCAD_VERSION=2026.10.02 \
    -DHEADLESS=ON -DNULLGL=ON -DEXPERIMENTAL=ON \
    -DENABLE_TESTS=OFF -DENABLE_GUI_TESTS=OFF -DENABLE_PYTHON=OFF \
    -DENABLE_MANIFOLD=ON -DENABLE_CGAL=ON \
    -DUSE_BUILTIN_MANIFOLD=ON -DUSE_BUILTIN_CLIPPER2=ON \
    -DUSE_MANIFOLD_TRIANGULATOR=ON -DUSE_MANIFOLD_MINKOWSKI=OFF \
    -DENABLE_CAIRO=OFF -DENABLE_HIDAPI=OFF -DENABLE_SPNAV=OFF \
    -DCMAKE_REQUIRE_FIND_PACKAGE_Lib3MF=OFF -DCMAKE_DISABLE_FIND_PACKAGE_Lib3MF=ON
cmake --build "$build_dir" --target OpenSCADExe --parallel "$jobs"
"$build_dir/openscad" --version 2>&1 | grep -Fx 'OpenSCAD version 2026.10.02'
"$build_dir/openscad" --help 2>&1 | grep -- '--enable' >/dev/null
printf 'Native reference ready: %s/openscad\n' "$build_dir"
printf '%s\n' 'Run npm run test:all (or xvfb-run -a npm run test:all in a displayless Linux session).'