-- Drizzle Migration 0132: v10.2 package 11 part 2d, the text search of the activity log (OBS-R1-32, TD-1324)
--
-- The activity log search compared description, user full name, username and entity with ILIKE '%…%', which no btree
-- index serves: every search read the whole table (565 to 622 ms at 300,000 rows). One GIN trigram index over the four
-- columns joined by the unit separator (chr 31, which no search text holds, so a match never spans two columns) serves
-- the search, and `activityLogSearchText` in src/db/schema/auth.ts is the same expression the query compares.
-- pg_trgm exists since the baseline (0000). Built without CONCURRENTLY, inside the Drizzle migrator transaction; on
-- 1,500,000 rows of the production shape (589 MB table) it took 65 s on 4 cores with maintenance_work_mem 64MB and made a
-- 314 MB index; a search went from about 1750 ms to 56 ms. No row is changed.

CREATE INDEX IF NOT EXISTS activity_logs_search_trgm ON activity_logs USING gin (
  (coalesce(description, '') || E'\x1f' || coalesce(user_full_name, '') || E'\x1f' || coalesce(username, '') || E'\x1f' || coalesce(entity, '')) gin_trgm_ops
);
