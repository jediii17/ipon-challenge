/**
 * migrate_live.js
 * 
 * Extracts data directly from the live `global_state` JSON blob
 * and migrates it into the newly created relational UUID tables.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const pgClient = new Client({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false }
});

const EMAIL_DOMAIN = '@iponchallenge.com';

async function migrate() {
  console.log('🚀 Starting live database UUID migration...\n');
  
  await pgClient.connect();

  // 1. Fetch live global state
  console.log('--> Fetching live data from global_state...');
  const res = await pgClient.query("SELECT state FROM global_state WHERE id = 'app_data'");
  if (res.rows.length === 0 || !res.rows[0].state) {
    console.log('❌ No live state found in `global_state`. Nothing to migrate.');
    process.exit(0);
  }

  const usersData = res.rows[0].state;
  console.log(`✅ Loaded live state for ${Object.keys(usersData).length} users.`);

  // 2. Map Users from Supabase Auth to get UUIDs
  console.log('--> Mapping Auth UUIDs & Inserting users...');
  
  // We first register admin if not exists (just in case)
  const adminEmail = `admin${EMAIL_DOMAIN}`;
  await supabase.auth.admin.createUser({ email: adminEmail, password: 'password', email_confirm: true }); // Will fail silently if exists

  for (const [key, user] of Object.entries(usersData)) {
    const email = `${key}${EMAIL_DOMAIN}`;
    
    // Register user if they somehow don't exist yet
    let { data: authData, error } = await supabase.auth.admin.createUser({
      email, password: user.password || 'tempPass123', email_confirm: true,
      user_metadata: { display_name: user.name, user_key: key }
    });

    if (error && error.message.includes('already been registered')) {
      // Find the user to get their UUID
      const { data: { users } } = await supabase.auth.admin.listUsers();
      authData = { user: users.find(u => u.email === email) };
    }

    if (!authData || !authData.user) {
      console.error(`❌ Could not resolve UUID for user ${key}`);
      continue;
    }

    const uuid = authData.user.id;

    // Insert to DB using true UUID
    await pgClient.query(
      `INSERT INTO users (id, user_key, name) VALUES ($1, $2, $3)`,
      [uuid, key, user.name]
    );

    // 3. Migrate Sub-Accounts
    if (user.subAccounts) {
      console.log(`  --> Migrating ${Object.keys(user.subAccounts).length} sub-accounts for ${user.name}`);
      for (const [saKey, saData] of Object.entries(user.subAccounts)) {
        
        const saRes = await pgClient.query(
          `INSERT INTO sub_accounts (user_id, legacy_id, label, goal, daily_deposit) 
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [uuid, saKey, saData.label, saData.goal || 0, saData.dailyDeposit || 0]
        );
        const subUUID = saRes.rows[0].id;

        // 4. Migrate Transactions
        if (saData.deposits && saData.deposits.length > 0) {
          for (const tx of saData.deposits) {
            await pgClient.query(
              `INSERT INTO transactions (sub_account_id, user_id, amount, date, label) 
               VALUES ($1, $2, $3, $4, $5)`,
              [subUUID, uuid, tx.amount, tx.date, tx.label || null]
            );
          }
        }
      }
    }
  }

  console.log('\n🎉 Live migration complete! Data successfully mapped to UUID relational tables.');
  await pgClient.end();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
