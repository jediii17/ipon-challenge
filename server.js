require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.SESSION_SECRET || 'fallback_secret_for_ipon_challenge_123';

const EMAIL_DOMAIN = '@iponchallenge.com';

// ================= SUPABASE AUTH CLIENT =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ================= LOAD CONFIDENTIAL DATA =================
const initialStatePath = path.join(__dirname, 'data', 'initial_state.json');
let initialState = { adminPassword: '', usersData: {} };
try {
  initialState = JSON.parse(fs.readFileSync(initialStatePath, 'utf8'));
  console.log('✅ Loaded initial state from data/initial_state.json');
} catch (err) {
  console.error('❌ Could not load data/initial_state.json:', err.message);
}

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test DB Connection
pool.connect()
  .then(() => console.log('✅ Connected to Supabase PostgreSQL'))
  .catch(err => console.error('❌ Connection Error:', err.message));

// ================= SECURITY MIDDLEWARE =================

// 1. Helmet — sets secure HTTP headers (XSS, Content-Type sniffing, clickjacking, etc.)
app.use(helmet({
  contentSecurityPolicy: false // Disabled for inline scripts in the frontend
}));

// 2. CORS — restrict origins in production
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGIN || 'https://yourdomain.com'
    : '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 3. Body parser with size limit — prevents large payload attacks
app.use(express.json({ limit: '1mb' }));

// 4. Global Rate Limiter — 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a minute.' }
});
app.use('/api/', globalLimiter);

// 5. Strict Login Rate Limiter — 5 attempts per minute per IP
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please wait 1 minute.' }
});

// Serve Static Frontend files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));
app.use('/views', express.static(path.join(__dirname, 'views')));

// ================= SESSION TOKEN STORE =================
// Using JSON Web Tokens (JWT) for stateless serverless auth

// Middleware: Verify session token for protected routes
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const session = jwt.verify(token, JWT_SECRET);
    req.session = session;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}

// ================= HELPER =================
function stripPasswords(data) {
  if (!data) return data;
  const clean = JSON.parse(JSON.stringify(data));
  for (const key of Object.keys(clean)) {
    if (clean[key] && typeof clean[key] === 'object' && 'password' in clean[key]) {
      delete clean[key].password;
    }
  }
  return clean;
}

// ================= API ROUTES =================

// Login endpoint – authenticates via Supabase Auth, returns session token
app.post('/api/login', loginLimiter, async (req, res) => {
  const { role, userKey, password } = req.body;

  // Input validation
  if (!role || !password || typeof password !== 'string') {
    return res.status(400).json({ success: false, message: 'Invalid input.' });
  }

  if (role === 'user' && (!userKey || typeof userKey !== 'string')) {
    return res.status(400).json({ success: false, message: 'Invalid user selection.' });
  }

  // Sanitize userKey — allow UUID format
  if (role === 'user' && !/^[0-9a-fA-F-]{36}$/.test(userKey)) {
    return res.status(400).json({ success: false, message: 'Invalid username format.' });
  }

  try {
    let emailPrefix = 'admin';
    if (role === 'user') {
      const uRes = await pool.query('SELECT user_key FROM users WHERE id = $1', [userKey]);
      if (uRes.rows.length === 0) return res.status(400).json({ success: false, message: 'User not found' });
      emailPrefix = uRes.rows[0].user_key;
    }
    const email = `${emailPrefix}${EMAIL_DOMAIN}`;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      const message = role === 'admin'
        ? 'Incorrect admin password.'
        : 'Incorrect password. Try again.';
      return res.status(401).json({ success: false, message });
    }

    // Generate a stateless session token
    const sessionData = {
      role: role === 'admin' ? 'admin' : 'user',
      userKey: role === 'admin' ? null : userKey,
      userName: data.user?.user_metadata?.display_name || userKey,
      createdAt: Date.now()
    };
    
    // Sign JWT (expires in 24 hours)
    const token = jwt.sign(sessionData, JWT_SECRET, { expiresIn: '24h' });

    if (role === 'admin') {
      return res.json({ success: true, role: 'admin', token });
    }

    return res.json({
      success: true,
      role: 'user',
      userKey,
      userName: sessionData.userName,
      token
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

// Logout endpoint — invalidates session
app.post('/api/logout', (req, res) => {
  // Stateless JWT relies on frontend to discard the token
  res.json({ success: true });
});

// Get the list of user keys and names (public, for login dropdown)
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, user_key, name FROM users');
    const users = {};
    result.rows.forEach(row => {
      users[row.id] = { name: row.name, user_key: row.user_key };
    });
    res.json(users);
  } catch (err) {
    console.error('Error fetching basic users:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 🔒 PROTECTED: Get all data reconstructed into the legacy tree shape
app.get('/api/data', requireAuth, async (req, res) => {
  try {
    // 1. Fetch Users
    const usersRes = await pool.query('SELECT id, user_key, name FROM users');
    const dataTree = {};
    usersRes.rows.forEach(u => {
      dataTree[u.id] = { name: u.name, user_key: u.user_key, subAccounts: {} };
    });

    // 2. Fetch Sub-accounts
    const subsRes = await pool.query('SELECT id, user_id, label, goal, daily_deposit FROM sub_accounts');
    subsRes.rows.forEach(s => {
      if (dataTree[s.user_id]) {
        dataTree[s.user_id].subAccounts[s.id] = {
          label: s.label,
          goal: parseFloat(s.goal) || 0,
          dailyDeposit: parseFloat(s.daily_deposit) || 0,
          deposits: []
        };
      }
    });

    // 3. Fetch Transactions
    const txRes = await pool.query('SELECT id, sub_account_id, user_id, amount, date, label FROM transactions ORDER BY date ASC, id ASC');
    txRes.rows.forEach(t => {
      if (dataTree[t.user_id] && dataTree[t.user_id].subAccounts[t.sub_account_id]) {
        // Format date to YYYY-MM-DD
        const d = new Date(t.date);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const txObj = {
          id: t.id,
          date: dateStr,
          amount: parseFloat(t.amount)
        };
        if (t.label) txObj.label = t.label;
        dataTree[t.user_id].subAccounts[t.sub_account_id].deposits.push(txObj);
      }
    });

    res.json(dataTree);
  } catch (err) {
    console.error('Error fetching data tree:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * NEW: Paginated Transactions Endpoint
 * Optimizes performance by using server-side pagination and single-query JOINs.
 */
app.get('/api/transactions', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const userId = req.query.user_id || '';
    const subAccountId = req.query.sub_account_id || '';

    let whereClause = 'WHERE 1=1';
    let params = [];

    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND (t.label ILIKE $${params.length} OR u.name ILIKE $${params.length} OR s.label ILIKE $${params.length})`;
    }

    if (userId && userId !== 'all') {
      params.push(userId);
      whereClause += ` AND t.user_id = $${params.length}`;
    }

    if (subAccountId && subAccountId !== 'all') {
      params.push(subAccountId);
      whereClause += ` AND t.sub_account_id = $${params.length}`;
    }

    // 1. Get Total Count for Pagination
    const countQuery = `
      SELECT COUNT(*) 
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN sub_accounts s ON t.sub_account_id = s.id
      ${whereClause}
    `;
    const countRes = await pool.query(countQuery, params);
    const totalCount = parseInt(countRes.rows[0].count);

    // 2. Get Paginated Data
    const dataQuery = `
      SELECT t.id, t.amount, t.date, t.label, u.name as user_name, s.label as sub_account_label
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN sub_accounts s ON t.sub_account_id = s.id
      ${whereClause}
      ORDER BY t.date DESC, t.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const dataParams = [...params, limit, offset];
    const dataRes = await pool.query(dataQuery, dataParams);

    res.json({
      data: dataRes.rows,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit
    });
  } catch (err) {
    console.error('Error fetching paginated transactions:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Middleware for Admin Only routes
const requireAdmin = (req, res, next) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Admin access required.' });
  }
  next();
};

// ================= USER CRUD =================

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const { id: shortId, name, password } = req.body;
  if (!shortId || !name || !password) return res.status(400).json({ error: 'Missing short id, name, or password.' });
  try {
    // 1. Create in Supabase Auth
    const email = `${shortId.toLowerCase().replace(/\s+/g,'')}${EMAIL_DOMAIN}`;
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name, user_key: shortId }
    });
    if (authError) return res.status(400).json({ error: authError.message });

    // 2. Insert into DB using genuine Auth UUID
    const uuid = authData.user.id;
    await pool.query('INSERT INTO users (id, user_key, name) VALUES ($1, $2, $3)', [uuid, shortId, name]);
    res.json({ success: true, id: uuid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params; // Expect UUID
  const { name, password } = req.body;
  
  try {
    const uRes = await pool.query('UPDATE users SET name = $1 WHERE id = $2 RETURNING user_key', [name, id]);
    if (uRes.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    
    // Attempt Auth sync
    const sbUpdates = { user_metadata: { display_name: name } };
    if (password && password.trim() !== '') sbUpdates.password = password;
    await supabase.auth.admin.updateUserById(id, sbUpdates);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params; // Expect UUID
  try {
    await supabase.auth.admin.deleteUser(id);
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, password } = req.body;
  const id = req.params.id;
  try {
    // 1. Update DB
    await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, id]);
    
    // 2. Optionally update Supabase Auth
    // First, find the user in auth by email
    const email = `${id}${EMAIL_DOMAIN}`;
    const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers();
    if (!listErr && users) {
      const authUser = users.find(u => u.email === email);
      if (authUser) {
        const updatePayload = { user_metadata: { display_name: name, user_key: id } };
        if (password) updatePayload.password = password; // Only update password if provided
        await supabase.auth.admin.updateUserById(authUser.id, updatePayload);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    // 1. Find user in Auth
    const email = `${id}${EMAIL_DOMAIN}`;
    const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers();
    if (!listErr && users) {
      const authUser = users.find(u => u.email === email);
      if (authUser) await supabase.auth.admin.deleteUser(authUser.id);
    }

    // 2. Delete from DB (cascade deletes sub_accounts and transactions automatically)
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= SUB-ACCOUNT CRUD =================

app.post('/api/subaccounts', requireAuth, requireAdmin, async (req, res) => {
  const { id: dummyId, user_id, label, goal, daily_deposit } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO sub_accounts (user_id, label, goal, daily_deposit) VALUES ($1, $2, $3, $4) RETURNING id',
      [user_id, label, goal || 50000, daily_deposit || 50]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/subaccounts/:id', requireAuth, requireAdmin, async (req, res) => {
  const { label, goal, daily_deposit } = req.body;
  try {
    await pool.query(
      'UPDATE sub_accounts SET label = $1, goal = $2, daily_deposit = $3 WHERE id = $4',
      [label, goal, daily_deposit, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/subaccounts/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM sub_accounts WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= TRANSACTION CRUD =================

app.post('/api/transactions', requireAuth, requireAdmin, async (req, res) => {
  const { sub_account_id, user_id, amount, date, label } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO transactions (sub_account_id, user_id, amount, date, label) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [sub_account_id, user_id, amount, date, label || null]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/transactions/:id', requireAuth, requireAdmin, async (req, res) => {
  const { amount, date } = req.body;
  try {
    await pool.query(
      'UPDATE transactions SET amount = $1, date = $2 WHERE id = $3',
      [amount, date, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/transactions/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM transactions WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit route fallback to index.html for Single Page App behavior
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
    console.log(`🛡️  Security: Helmet, Rate Limiting, Session Auth enabled`);
  });
}

// Export for Vercel serverless deployment
module.exports = app;
