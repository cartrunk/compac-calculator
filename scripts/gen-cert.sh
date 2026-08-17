#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/certs"
mkdir -p "$DIR"

if [[ -f "$DIR/key.pem" && -f "$DIR/cert.pem" ]]; then
  echo "Cert already exists at $DIR — remove it first to regenerate."
  exit 0
fi

openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout "$DIR/key.pem" -out "$DIR/cert.pem" \
  -subj "/CN=localhost"

echo "Generated self-signed dev cert in $DIR (gitignored, local dev only)."
