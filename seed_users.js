/**
 * seed_users.js
 * 
 * Run once to:
 * 1. Register all initial users in Supabase Auth (username@iponchallenge.com)
 * 2. Register the admin account (admin@iponchallenge.com)
 * 3. Insert users into the users table
 * 
 * Usage: npm run seed
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Load initial state
const initialState = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'initial_state.json'), 'utf8')
);

// Supabase Admin Client (uses service role key for user management)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// PostgreSQL Client
const pgClient = new Client({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false }
});

const EMAIL_DOMAIN = '@iponchallenge.com';

async function seed() {
  console.log('🌱 Starting seed process...\n');

  // Validate env
  if (!process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY === '[YOUR-SERVICE-ROLE-KEY]') {
    console.error('❌ ERROR: You must set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  // ========== 1. Register Admin in Supabase Auth ==========
  console.log('--- Registering Admin Account ---');
  const adminEmail = `admin${EMAIL_DOMAIN}`;
  const { data: adminData, error: adminError } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: initialState.adminPassword,
    email_confirm: true
  });

  if (adminError) {
    if (adminError.message.includes('already been registered')) {
      console.log(`⚠️  Admin (${adminEmail}) already exists, skipping.`);
    } else {
      console.error(`❌ Error creating admin:`, adminError.message);
    }
  } else {
    console.log(`✅ Admin registered: ${adminEmail}`);
  }

  // ========== 2. Register Users in Supabase Auth + Insert into DB ==========
  console.log('\n--- Registering User Accounts ---');
  await pgClient.connect();

  for (const [key, user] of Object.entries(initialState.usersData)) {
    const email = `${key}${EMAIL_DOMAIN}`;
    
    // Register in Supabase Auth
    let { data: authData, error } = await supabase.auth.admin.createUser({
      email: email,
      password: user.password || 'password123',
      email_confirm: true,
      user_metadata: { display_name: user.name, user_key: key }
    });

    if (error && error.message.includes('already been registered')) {
      const { data: { users } } = await supabase.auth.admin.listUsers();
      authData = { user: users.find(u => u.email === email) };
      console.log(`⚠️  ${user.name} (${email}) already exists in Auth, fetched UUID.`);
    } else if (error) {
      console.error(`❌ Error creating ${user.name}:`, error.message);
      continue;
    } else {
      console.log(`✅ ${user.name} registered in Auth: ${email}`);
    }

    if (!authData || !authData.user) {
      console.error(`❌ Could not resolve UUID for user ${key}`);
      continue;
    }

    const uuid = authData.user.id;

    // Insert into users table
    try {
      await pgClient.query(
        `INSERT INTO users (id, user_key, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = $3`,
        [uuid, key, user.name]
      );
      console.log(`✅ ${user.name} inserted into users table`);

      // Seed Sub-accounts
      if (user.subAccounts) {
        for (const [saKey, saData] of Object.entries(user.subAccounts)) {
          // Check if subaccount already exists by legacy_id to prevent duplicates
          const existCheck = await pgClient.query('SELECT id FROM sub_accounts WHERE legacy_id = $1 LIMIT 1', [saKey]);
          let subUUID;
          
          if (existCheck.rows.length > 0) {
            subUUID = existCheck.rows[0].id;
            console.log(`⚠️  Sub-account ${saData.label} already exists.`);
          } else {
            const saRes = await pgClient.query(
              `INSERT INTO sub_accounts (user_id, legacy_id, label, goal, daily_deposit) 
               VALUES ($1, $2, $3, $4, $5) RETURNING id`,
              [uuid, saKey, saData.label, saData.goal || 0, saData.dailyDeposit || 0]
            );
            subUUID = saRes.rows[0].id;
            console.log(`✅ Created sub-account: ${saData.label}`);
            
            // Seed Transactions ONLY if we just created the sub-account
            if (saData.deposits && saData.deposits.length > 0) {
              for (const tx of saData.deposits) {
                await pgClient.query(
                  `INSERT INTO transactions (sub_account_id, user_id, amount, date, label) 
                   VALUES ($1, $2, $3, $4, $5)`,
                  [subUUID, uuid, tx.amount, tx.date, tx.label || null]
                );
              }
              console.log(`✅ Inserted ${saData.deposits.length} transactions for ${saData.label}`);
            }
          }
        }
      }

    } catch (err) {
      console.error(`❌ Error inserting ${user.name} data into DB:`, err.message);
    }
  }

  await pgClient.end();
  console.log('\n🎉 Seed complete! You can now start the server with `npm run dev`');
}

seed();
