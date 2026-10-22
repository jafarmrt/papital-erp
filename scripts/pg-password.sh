#!/usr/bin/env bash
# v10.2.26 (#339 review N-C, TD-1351): sourced by restore.sh and upgrade-rehearsal.sh so the database password never
# appears on a psql / pg_restore command line, where every user of the server can read it in the process list.
# pg_password_setup <dir> writes <dir>/pgpass (mode 600, a copy of an inherited PGPASSFILE first), exports it as
# PGPASSFILE and removes the password from DATABASE_URL and RESTORE_ADMIN_URL; the full DATABASE_URL stays in
# PG_FULL_DATABASE_URL for a Node program, which gets it through its environment. The same parsing as nightly-verify.sh.

PG_URL_RE='^(postgres(ql)?://)([^:@/]+)(:([^@]*))?@([^/?]*)(.*)$'
# percent-decoding as libpq does it: a + stays a +, and a backslash is a plain character
pg_url_decode() { local v="${1//\\/\\\\}"; printf '%b' "${v//%/\\x}"; }
pg_pgpass_field() { printf '%s' "$1" | sed -e 's/[\\:]/\\&/g'; }
# host and port of the URL's host part; an IPv6 address comes without its brackets ([::1]:5433 -> ::1 5433)
# an empty host (a socket given as ?host=/path) is written as localhost, which libpq matches for the default
# socket directory; a socket in another directory needs a pgpass line of its own (#346 review)
pg_split_hostport() {
  local hostport="$1" host port=""
  if [[ "$hostport" == \[* ]]; then
    host="${hostport%%]*}"
    host="${host#[}"
    [[ "$hostport" == *]:* ]] && port="${hostport##*]:}"
  else
    host="${hostport%%:*}"
    [ "$hostport" = "$host" ] || port="${hostport##*:}"
  fi
  echo "${host:-localhost} ${port:-5432}"
}
# prints the URL without its password and adds host:port:*:user:password to the PGPASSFILE
pg_strip_password() {
  local url="$1"
  if [[ "$url" =~ $PG_URL_RE ]] && [ -n "${BASH_REMATCH[4]}" ]; then
    local scheme="${BASH_REMATCH[1]}" user="${BASH_REMATCH[3]}" pass="${BASH_REMATCH[5]}" hostport="${BASH_REMATCH[6]}" rest="${BASH_REMATCH[7]}"
    local host port
    read -r host port <<< "$(pg_split_hostport "$hostport")"
    printf '%s:%s:*:%s:%s\n' "$(pg_pgpass_field "$host")" "$port" "$(pg_pgpass_field "$(pg_url_decode "$user")")" \
      "$(pg_pgpass_field "$(pg_url_decode "$pass")")" >> "$PGPASSFILE"
    echo "${scheme}${user}@${hostport}${rest}"
  else
    echo "$url"
  fi
}
pg_password_setup() {
  local inherited="${PGPASSFILE:-}"
  PG_FULL_DATABASE_URL="${PG_FULL_DATABASE_URL:-$DATABASE_URL}"
  PGPASSFILE="$1/pgpass"
  ( umask 077; : > "$PGPASSFILE" )
  if [ -n "$inherited" ] && [ -r "$inherited" ]; then cat "$inherited" >> "$PGPASSFILE"; fi
  export PGPASSFILE PG_FULL_DATABASE_URL
  DATABASE_URL="$(pg_strip_password "$DATABASE_URL")"
  export DATABASE_URL
  if [ -n "${RESTORE_ADMIN_URL:-}" ]; then
    RESTORE_ADMIN_URL="$(pg_strip_password "$RESTORE_ADMIN_URL")"
    export RESTORE_ADMIN_URL
  fi
}
