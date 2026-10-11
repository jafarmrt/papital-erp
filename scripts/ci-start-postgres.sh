#!/usr/bin/env bash
# v10.0.191: starts the PostgreSQL 16 server that ships with the GitHub ubuntu-24.04 runner image for the database,
# coverage and e2e jobs of .github/workflows/ci.yml, instead of a service container pulled from a registry
# (an anonymous pull was refused with "toomanyrequests" and failed a job before any test ran).
# The role, password and database match the former service container: postgres / test / <database>.
# Usage: bash scripts/ci-start-postgres.sh <database> [password]
set -euo pipefail

db="${1:?usage: ci-start-postgres.sh <database> [password]}"
password="${2:-test}"

sudo systemctl start postgresql.service
for _ in $(seq 1 30); do
  if pg_isready -h localhost -p 5432 -q; then break; fi
  sleep 1
done
pg_isready -h localhost -p 5432

as_postgres() { sudo -u postgres psql -X -v ON_ERROR_STOP=1 -qtA -d postgres "$@"; }

version="$(as_postgres -c 'SHOW server_version_num')"
if [ "${version:0:2}" != "16" ]; then
  echo "The runner's PostgreSQL on port 5432 is version ${version}, not 16" >&2
  exit 1
fi

as_postgres -c "ALTER USER postgres PASSWORD '${password}'"
if [ "$(as_postgres -c "SELECT 1 FROM pg_database WHERE datname = '${db}'")" != "1" ]; then
  as_postgres -c "CREATE DATABASE \"${db}\""
fi
echo "PostgreSQL ${version} is ready on localhost:5432 with database ${db}"
