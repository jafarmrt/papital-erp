#!/usr/bin/env bash
# v10.0.192: starts PostgreSQL 16 on the GitHub runner for the database, coverage and e2e jobs of
# .github/workflows/ci.yml, instead of a service container pulled from a registry (an anonymous pull was refused with
# "toomanyrequests" and failed a job before any test ran).
# v11 (phase 5.4, TD-1355): the jobs run on ubuntu-26.04, whose image does not ship PostgreSQL 16 (the 24.04 image
# did). Version 16 comes from the PostgreSQL apt repository, as install.sh installs it on a server, and its cluster is
# the only one left, on port 5432; the client tools (pg_dump, pg_restore) then follow that cluster, version 16 like a
# server's.
# The role, password and database match the former service container: postgres / test / <database>.
# Usage: bash scripts/ci-start-postgres.sh <database> [password]
set -euo pipefail

db="${1:?usage: ci-start-postgres.sh <database> [password]}"
password="${2:-test}"

if [ ! -x /usr/lib/postgresql/16/bin/postgres ]; then
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
  [ -n "$codename" ] || { echo "The runner's release has no VERSION_CODENAME in /etc/os-release" >&2; exit 1; }
  curl -fsSL --retry 3 https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/pgdg.gpg
  echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt ${codename}-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-16 postgresql-client-16
fi

# only the 16 cluster runs, on 5432 (a newer cluster of the image would hold the port, and pg_wrapper would pick its tools)
if command -v pg_lsclusters >/dev/null 2>&1; then
  pg_lsclusters -h | while read -r version cluster _; do
    [ "$version" = "16" ] || sudo pg_dropcluster --stop "$version" "$cluster"
  done
  cluster16="$(pg_lsclusters -h | awk '$1 == 16 { print $2; exit }')"
  if [ -z "$cluster16" ]; then
    sudo pg_createcluster 16 main
    cluster16=main
  fi
  sudo pg_conftool 16 "$cluster16" set port 5432
  sudo pg_ctlcluster 16 "$cluster16" status >/dev/null 2>&1 || sudo pg_ctlcluster 16 "$cluster16" start
else
  sudo systemctl start postgresql.service
fi
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
echo "PostgreSQL ${version} is ready on localhost:5432 with database ${db} (pg_dump $(pg_dump --version | awk '{ print $3 }'))"
