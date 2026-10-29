#!/bin/sh
# Double-click on macOS: the quick check.
cd "$(dirname "$0")" || exit 1
exec sh ./check.sh --quick
