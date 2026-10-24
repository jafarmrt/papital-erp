#!/usr/bin/env bash
# v10.2.28 (#339 review N-C, TD-1351): sourced by restore.sh and upgrade-rehearsal.sh so the database password never
# appears on a psql / pg_restore command line, where every user of the server can read it in the process list.
# pg_password_setup <dir> writes <dir>/pgpass (mode 600; the URLs' passwords, then a copy of an inherited PGPASSFILE), exports it as
# PGPASSFILE and removes the password from DATABASE_URL and RESTORE_ADMIN_URL; the full DATABASE_URL stays in
# PG_FULL_DATABASE_URL for a Node program, which gets it through its environment. nightly-verify.sh has an older copy of the
# parsing (no ~/.pgpass copy, no socket directory).
# v10.3.22 (#381 review): without an inherited PGPASSFILE the user's ~/.pgpass is copied first, since libpq reads only the
# file PGPASSFILE names (a URL without a password that relied on ~/.pgpass kept working), and a socket directory given
# as ?host=/path is the host field of the line written for it.

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
# the socket directory of a URL whose host part is empty (postgresql://u:p@/db?host=/run/pg), percent-decoded
pg_query_socket_dir() {
  local rest="$1" value
  [[ "$rest" =~ [?\&]host=([^\&]*) ]] || return 0
  value="$(pg_url_decode "${BASH_REMATCH[1]}")"
  [[ "$value" == /* ]] && echo "$value"
  return 0
}
# prints the URL without its password and adds host:port:*:user:password to the PGPASSFILE
pg_strip_password() {
  local url="$1"
  if [[ "$url" =~ $PG_URL_RE ]] && [ -n "${BASH_REMATCH[4]}" ]; then
    local scheme="${BASH_REMATCH[1]}" user="${BASH_REMATCH[3]}" pass="${BASH_REMATCH[5]}" hostport="${BASH_REMATCH[6]}" rest="${BASH_REMATCH[7]}"
    local host port socket_dir
    read -r host port <<< "$(pg_split_hostport "$hostport")"
    socket_dir="$(pg_query_socket_dir "$rest")"
    # libpq reads its own default socket directory as localhost, any other one by its path: both lines are written
    local h hosts=("$host")
    [ -n "$hostport" ] || [ -z "$socket_dir" ] || hosts=("$socket_dir" "$host")
    for h in "${hosts[@]}"; do
      printf '%s:%s:*:%s:%s\n' "$(pg_pgpass_field "$h")" "$port" "$(pg_pgpass_field "$(pg_url_decode "$user")")" \
        "$(pg_pgpass_field "$(pg_url_decode "$pass")")" >> "$PGPASSFILE"
    done
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
  export PGPASSFILE PG_FULL_DATABASE_URL
  DATABASE_URL="$(pg_strip_password "$DATABASE_URL")"
  export DATABASE_URL
  if [ -n "${RESTORE_ADMIN_URL:-}" ]; then
    RESTORE_ADMIN_URL="$(pg_strip_password "$RESTORE_ADMIN_URL")"
    export RESTORE_ADMIN_URL
  fi
  # after the URLs' lines: libpq takes the first matching line, and a password in the URL wins over a password file
  [ -n "$inherited" ] || inherited="${HOME:+$HOME/.pgpass}"
  if [ -n "$inherited" ] && [ -r "$inherited" ]; then cat "$inherited" >> "$PGPASSFILE"; fi
}
