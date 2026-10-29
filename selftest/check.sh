#!/bin/sh
# Capri check for Linux and macOS.   sh check.sh            quick (touches nothing)
#                                    sh check.sh --full     also tries speech and the microphone
# It needs Node.js 20 or newer; if there is none, the Node inside an installed Capri is used.
cd "$(dirname "$0")" || exit 1

RUNNER=""
if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)' >/dev/null 2>&1; then
  RUNNER="node"
else
  for candidate in "$CAPRI_EXE" "/Applications/Capri.app/Contents/MacOS/Capri" "$HOME/Applications/Capri.app/Contents/MacOS/Capri" "/opt/Capri/capri" "/opt/capri/capri" "$(pwd)/../Capri/capri"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      RUNNER="$candidate"
      export ELECTRON_RUN_AS_NODE=1
      break
    fi
  done
fi
if [ -z "$RUNNER" ] && command -v node >/dev/null 2>&1; then RUNNER="node"; fi
if [ -z "$RUNNER" ]; then
  echo "Node.js was not found. Install Node.js 20 or newer from https://nodejs.org and run this again."
  exit 2
fi

"$RUNNER" ./selftest.js "${@:---quick}"
code=$?
echo
printf "Press Enter to close... "
read -r _ 2>/dev/null
exit $code
