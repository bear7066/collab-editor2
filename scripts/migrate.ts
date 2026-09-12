// Applies server/schema.sql to the database in DATABASE_URL.
// Usage: bun run db:migrate
import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Add it to .env or the environment.');
  process.exit(1);
}

const sql = neon(databaseUrl);
const schema = await Bun.file(new URL('../server/schema.sql', import.meta.url)).text();

// The HTTP driver runs one statement per query.
const statements = schema
  .replace(/--.*$/gm, '')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql.query(statement);
}
console.log(`Applied ${statements.length} schema statements.`);
