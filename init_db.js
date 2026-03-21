/**
 * init_db.js
 * 
 * Creates the relational database tables:
 * - users
 * - sub_accounts
 * - transactions
 * 
 * Usage: npm run init-db
 */

require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  console.log('Connecting to Supabase PostgreSQL...');
  await client.connect();

  console.log('Dropping existing tables to reset schema...');
  await client.query(`
    DROP TABLE IF EXISTS transactions CASCADE;
    DROP TABLE IF EXISTS sub_accounts CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
  `);

  console.log('Creating tables...');

  // Ensure pgcrypto is enabled for UUIDs
  await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await client.query(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ Table "users" ready.');

  await client.query(`
    CREATE TABLE sub_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      legacy_id TEXT,
      label TEXT NOT NULL,
      goal NUMERIC DEFAULT 50000,
      daily_deposit NUMERIC DEFAULT 50,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ Table "sub_accounts" ready.');

  await client.query(`
    CREATE TABLE transactions (
      id SERIAL PRIMARY KEY,
      sub_account_id UUID NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC NOT NULL,
      date DATE NOT NULL,
      label TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ Table "transactions" ready.');

  // Create indexes for performance
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_sub_accounts_user_id ON sub_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_sub_account_id ON transactions(sub_account_id);
  `);
  console.log('✅ Indexes created.');

  await client.end();
  console.log('\n🎉 Database initialized successfully!');
}

initDB().catch(err => {
  console.error('❌ Error:', err.message);
  client.end();
  process.exit(1);
});
