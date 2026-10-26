/**
 * OBS-R1-26: the schema is built by the hand-written migrations in `drizzle/*.sql` run by the atomic migrator (AGENTS §22);
 * `drizzle/meta` holds only their journal, no snapshot (v11 phase 4.1). A drizzle-kit command that compares the schema
 * with a snapshot or with the database (`generate`, `push`, `migrate`, `drop`, `up`, `pull` / `introspect`) would drop or
 * rebuild objects the migrations made, so `drizzle.config.ts` refuses it; only the read-only `studio`, `check` and
 * `export` (prints the schema's SQL, writes nothing; v10.1.66) run.
 */
export const DRIZZLE_KIT_ALLOWED_COMMANDS = ['studio', 'check', 'export'] as const;
const DRIZZLE_KIT_COMMANDS = ['generate', 'push', 'migrate', 'drop', 'up', 'pull', 'introspect', 'studio', 'check', 'export'];

/** The refused drizzle-kit command in `argv`, with the reason, or null when the command is allowed or none is named */
export function drizzleKitCommandRefusal(argv: readonly string[]): string | null {
  const command = argv.find(arg => DRIZZLE_KIT_COMMANDS.includes(arg));
  if (!command || (DRIZZLE_KIT_ALLOWED_COMMANDS as readonly string[]).includes(command)) return null;
  return `drizzle-kit ${command} is disabled in this repository: migrations are hand-written in drizzle/*.sql and applied `
    + 'by the atomic migrator at server start; the drizzle/meta snapshot is stale, so this command would '
    + 'drop or rebuild objects those migrations made. Write a new numbered migration instead (AGENTS.md section 22).';
}
