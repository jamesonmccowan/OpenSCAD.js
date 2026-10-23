#!/bin/sh
set -eu
: "${BOOST_INCLUDE_DIR:?Set BOOST_INCLUDE_DIR to a directory containing Boost headers}"
em++ src/geometry/roof-voronoi.cpp -idirafter "$BOOST_INCLUDE_DIR" -std=c++17 -O3 --bind \
  -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH \
  -sINITIAL_MEMORY=16777216 -sMAXIMUM_MEMORY=268435456 -sFILESYSTEM=0 \
  -sDISABLE_EXCEPTION_CATCHING=0 -sDYNAMIC_EXECUTION=0 -o src/geometry/roof-voronoi-wasm.js