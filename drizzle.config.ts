import { defineConfig } from 'drizzle-kit';
import * as dotenv from "dotenv";

dotenv.config();

const sqlHost = process.env.SQL_HOST;
const sqlDbName = process.env.SQL_DB_NAME;
const user = process.env.SQL_ADMIN_USER;
const password = process.env.SQL_ADMIN_PASSWORD;

let config;

// Fallback to DATABASE_URL if SQL_HOST is not set (e.g. for local development or direct DB usage)
if (!sqlHost && process.env.DATABASE_URL) {
  config = defineConfig({
    schema: './src/db/schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
      url: process.env.DATABASE_URL,
    },
    extensionsFilters: ["postgis"],
    tablesFilter: ["!spatial_ref_sys", "!geography_columns", "!geometry_columns"],
  });
} else {
  if (!sqlHost) throw new Error("SQL_HOST must be set");
  if (!sqlDbName) throw new Error("SQL_DB_NAME must be set");
  if (!user) throw new Error("SQL_ADMIN_USER must be set");
  if (!password) throw new Error("SQL_ADMIN_PASSWORD must be set");

  config = defineConfig({
    schema: './src/db/schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    schemaFilter: ["public"],
    dbCredentials: {
      host: sqlHost,
      user: user,
      password: password,
      database: sqlDbName,
      ssl: false,
    },
    extensionsFilters: ["postgis"],
    tablesFilter: ["!spatial_ref_sys", "!geography_columns", "!geometry_columns"],
  });
}

export default config;
