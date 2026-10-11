-- v10.0.262 (I-04): the costliest statements of this database, read-only.
-- Needs pg_stat_statements loaded (shared_preload_libraries) and created in the database; see docs/PERFORMANCE_BASELINE.md.
--   sudo -u postgres psql -d papital_erp -f scripts/sql/top-statements.sql
\pset pager off
SELECT round(total_exec_time::numeric, 1)                 AS total_ms,
       round(mean_exec_time::numeric, 1)                  AS mean_ms,
       calls,
       rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 200)  AS query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY total_exec_time DESC
LIMIT 20;

SELECT round(mean_exec_time::numeric, 1)                  AS mean_ms,
       round(max_exec_time::numeric, 1)                   AS max_ms,
       calls,
       left(regexp_replace(query, '\s+', ' ', 'g'), 200)  AS query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND calls >= 5
ORDER BY mean_exec_time DESC
LIMIT 20;
