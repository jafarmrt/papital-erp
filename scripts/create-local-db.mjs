import pg from 'pg';

const client = new pg.Client({
  host: 'localhost',
  port: 5433,
  user: 'postgres',
  password: 'Papital_Local_2026!',
  database: 'postgres',
});

try {
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'papital_erp'");
  if (exists.rowCount === 0) {
    await client.query('CREATE DATABASE papital_erp ENCODING UTF8');
    console.log('DB CREATED: papital_erp');
  } else {
    console.log('DB ALREADY EXISTS: papital_erp');
  }
} finally {
  await client.end();
}
