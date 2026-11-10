#!/usr/bin/env bash
# Cria um banco Postgres descartável, aplica as migrations e roda os testes.
# Uso: PGHOST=/tmp PGPORT=5432 PGUSER=postgres bash supabase/tests/rodar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="genesis_teste_$$"
createdb "$DB"
trap 'dropdb "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/supabase_minimo.sql
for f in migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 | grep -v NOTICE || true; done
psql -v ON_ERROR_STOP=1 -d "$DB" -f tests/base.sql
