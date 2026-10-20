#!/bin/sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org, then run this again."
  exit 1
fi
node -e "require('express');require('bcryptjs');require('exceljs');require('xlsx');require('pg')" >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund || exit 1
exec node server.js
