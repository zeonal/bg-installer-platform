const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'bg-installer-platform-2024-secure-key';

// ─── Database Setup ────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'database.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'installer',
    full_name TEXT NOT NULL,
    company TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS installer_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    sites_commissioned INTEGER DEFAULT 0,
    backup_offgrid_sites INTEGER DEFAULT 0,
    scenario_ongrid INTEGER DEFAULT 0,
    scenario_partial_backup INTEGER DEFAULT 0,
    scenario_full_backup INTEGER DEFAULT 0,
    scenario_ci INTEGER DEFAULT 0,
    total_kw_installed REAL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ─── Seed Demo Data ────────────────────────────────────────────────────────────
function seedDatabase() {
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (adminExists) return;

  const adminHash = bcrypt.hashSync('admin123', 10);
  db.prepare(
    'INSERT INTO users (username, password_hash, role, full_name, company) VALUES (?, ?, ?, ?, ?)'
  ).run('admin', adminHash, 'admin', 'BG Administrator', 'Brighten Generation');

  const installerHash = bcrypt.hashSync('installer123', 10);

  const demoInstallers = [
    {
      username: 'somchai',
      full_name: 'Somchai K.',
      company: 'SolarThai Co.',
      sites: 6, backup: 0,
      ongrid: 1, partial: 0, full: 0, ci: 0,
      kw: 42
    },
    {
      username: 'nattapong',
      full_name: 'Nattapong W.',
      company: 'BrightPower EPC',
      sites: 38, backup: 8,
      ongrid: 1, partial: 1, full: 1, ci: 0,
      kw: 487
    },
    {
      username: 'wiroj',
      full_name: 'Wiroj S.',
      company: 'SunTech Systems',
      sites: 63, backup: 20,
      ongrid: 1, partial: 1, full: 1, ci: 1,
      kw: 2140
    }
  ];

  for (const u of demoInstallers) {
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, role, full_name, company) VALUES (?, ?, ?, ?, ?)'
    ).run(u.username, installerHash, 'installer', u.full_name, u.company);

    db.prepare(`
      INSERT INTO installer_profiles
        (user_id, sites_commissioned, backup_offgrid_sites,
         scenario_ongrid, scenario_partial_backup, scenario_full_backup, scenario_ci,
         total_kw_installed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(result.lastInsertRowid, u.sites, u.backup, u.ongrid, u.partial, u.full, u.ci, u.kw);
  }

  console.log('✓ Database seeded with demo accounts');
}

seedDatabase();

// ─── Schema Migrations (safe: silently skip if column already exists) ──────────
[
  // users table
  `ALTER TABLE users ADD COLUMN email    TEXT    NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN phone    TEXT    NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN line_id  TEXT    NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN address  TEXT    NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN province TEXT    NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN bio      TEXT    NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN active   INTEGER NOT NULL DEFAULT 1`,
  // installer_profiles table — split sites into residential + C&I, add audit cols
  `ALTER TABLE installer_profiles ADD COLUMN residential_sites INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE installer_profiles ADD COLUMN ci_sites          INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE installer_profiles ADD COLUMN notes             TEXT    NOT NULL DEFAULT ''`,
  `ALTER TABLE installer_profiles ADD COLUMN updated_at        DATETIME`,
  `ALTER TABLE installer_profiles ADD COLUMN updated_by        TEXT    NOT NULL DEFAULT ''`,
].forEach(sql => { try { db.exec(sql); } catch (_) {} });

// Seed residential_sites from existing sites_commissioned for rows that haven't been split yet
db.exec(`
  UPDATE installer_profiles
  SET residential_sites = sites_commissioned
  WHERE residential_sites = 0 AND sites_commissioned > 0
`);

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}

// ─── Tier & Progress Logic ─────────────────────────────────────────────────────
function calculateTier(profile) {
  if (!profile) return 'Standard';
  const { sites_commissioned: s, backup_offgrid_sites: b,
          scenario_ongrid: og, scenario_partial_backup: pb,
          scenario_full_backup: fb, scenario_ci: ci } = profile;

  if (s >= 50 && ci)           return 'Master';
  if (s >= 30 && og && pb && fb) return 'Expert';
  if (s >= 10 && b >= 5)       return 'Advanced';
  return 'Standard';
}

function calculateProgress(profile, tier) {
  const s = profile ? profile.sites_commissioned : 0;
  switch (tier) {
    case 'Standard':
      return { percent: Math.min(100, Math.round((s / 10) * 100)), nextTier: 'Advanced', label: `${s} / 10 sites to Advanced` };
    case 'Advanced':
      return { percent: Math.min(100, Math.round((s / 30) * 100)), nextTier: 'Expert',   label: `${s} / 30 sites to Expert` };
    case 'Expert':
      return { percent: Math.min(100, Math.round((s / 50) * 100)), nextTier: 'Master',   label: `${s} / 50 sites to Master` };
    default:
      return { percent: 100, nextTier: null, label: 'You have reached the highest tier!' };
  }
}

// ─── API Routes ────────────────────────────────────────────────────────────────

// POST /api/login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required.' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Incorrect username or password.' });

  if (user.active === 0)
    return res.status(403).json({ error: 'Your account has been deactivated. Please contact Brighten Generation.' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      company: user.company,
      role: user.role
    }
  });
});

// GET /api/dashboard
app.get('/api/dashboard', authenticateToken, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, full_name, company, role FROM users WHERE id = ?'
  ).get(req.user.id);

  if (!user) return res.status(404).json({ error: 'User not found.' });

  const profile = db.prepare('SELECT * FROM installer_profiles WHERE user_id = ?').get(req.user.id);

  const emptyProfile = {
    sites_commissioned: 0,
    backup_offgrid_sites: 0,
    scenario_ongrid: 0,
    scenario_partial_backup: 0,
    scenario_full_backup: 0,
    scenario_ci: 0,
    total_kw_installed: 0
  };

  const resolvedProfile = profile || emptyProfile;
  const tier = calculateTier(resolvedProfile);
  const progress = calculateProgress(resolvedProfile, tier);

  res.json({ user, profile: resolvedProfile, tier, progress });
});

// GET /api/me — lightweight auth check used by all pages
app.get('/api/me', authenticateToken, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, full_name, company, role FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
});

// ─── Admin Middleware ──────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required.' });
  next();
}

// ─── Admin: User Management Routes ────────────────────────────────────────────

// GET /api/admin/users — list all users with profile + tier
app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.company, u.email, u.phone, u.line_id,
           u.address, u.province, u.bio, u.role, u.active, u.created_at,
           p.sites_commissioned, p.backup_offgrid_sites, p.total_kw_installed,
           p.scenario_ongrid, p.scenario_partial_backup, p.scenario_full_backup, p.scenario_ci
    FROM users u
    LEFT JOIN installer_profiles p ON p.user_id = u.id
    ORDER BY u.created_at DESC
  `).all();

  const result = users.map(u => ({ ...u, tier: calculateTier(u) }));
  res.json({ users: result });
});

// POST /api/admin/users — create a new user
app.post('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
  const { username, password, full_name, company, role, email, phone, line_id } = req.body;

  if (!username || !password || !full_name || !company)
    return res.status(400).json({ error: 'Username, password, full name, and company are required.' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const clean = username.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(clean);
  if (existing) return res.status(409).json({ error: `Username "${clean}" is already taken.` });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name, company, email, phone, line_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    clean,
    hash,
    role === 'admin' ? 'admin' : 'installer',
    full_name.trim(),
    company.trim(),
    (email   || '').trim(),
    (phone   || '').trim(),
    (line_id || '').trim()
  );

  // Create a blank installer profile so dashboard never breaks
  db.prepare('INSERT OR IGNORE INTO installer_profiles (user_id) VALUES (?)').run(result.lastInsertRowid);

  const newUser = db.prepare(
    'SELECT id, username, full_name, company, role, active, created_at FROM users WHERE id = ?'
  ).get(result.lastInsertRowid);

  res.status(201).json({ user: { ...newUser, tier: 'Standard' }, message: 'User created successfully.' });
});

// PUT /api/admin/users/:id — update profile, contact, role
app.put('/api/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { full_name, company, role, email, phone, line_id, address, province, bio } = req.body;

  if (!full_name || !company)
    return res.status(400).json({ error: 'Full name and company are required.' });
  if (id === req.user.id && role !== 'admin')
    return res.status(400).json({ error: 'You cannot change your own role.' });

  db.prepare(`
    UPDATE users
    SET full_name=?, company=?, role=?, email=?, phone=?, line_id=?, address=?, province=?, bio=?
    WHERE id=?
  `).run(
    full_name.trim(), company.trim(),
    role === 'admin' ? 'admin' : 'installer',
    (email    || '').trim(), (phone   || '').trim(), (line_id || '').trim(),
    (address  || '').trim(), (province|| '').trim(), (bio     || '').trim(),
    id
  );

  const updated = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.company, u.email, u.phone, u.line_id,
           u.address, u.province, u.bio, u.role, u.active, u.created_at,
           p.sites_commissioned, p.backup_offgrid_sites, p.total_kw_installed,
           p.scenario_ongrid, p.scenario_partial_backup, p.scenario_full_backup, p.scenario_ci
    FROM users u LEFT JOIN installer_profiles p ON p.user_id = u.id WHERE u.id = ?
  `).get(id);

  res.json({ user: { ...updated, tier: calculateTier(updated) }, message: 'User updated.' });
});

// PUT /api/admin/users/:id/password — admin resets any user's password
app.put('/api/admin/users/:id/password', authenticateToken, requireAdmin, (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ message: 'Password reset successfully.' });
});

// PUT /api/admin/users/:id/toggle — activate or deactivate
app.put('/api/admin/users/:id/toggle', authenticateToken, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id)
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });

  const user = db.prepare('SELECT active FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const newActive = user.active ? 0 : 1;
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(newActive, id);
  res.json({ active: newActive, message: newActive ? 'User activated.' : 'User deactivated.' });
});

// DELETE /api/admin/users/:id
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id)
    return res.status(400).json({ error: 'You cannot delete your own account.' });

  db.prepare('DELETE FROM installer_profiles WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ message: 'User deleted successfully.' });
});

// ─── Admin: Tier Data Management Routes ───────────────────────────────────────

// GET /api/admin/tier-data — all installers with full profile + tier
app.get('/api/admin/tier-data', authenticateToken, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.company, u.active,
           p.residential_sites, p.ci_sites, p.backup_offgrid_sites, p.total_kw_installed,
           p.scenario_ongrid, p.scenario_partial_backup, p.scenario_full_backup, p.scenario_ci,
           p.sites_commissioned, p.notes, p.updated_at, p.updated_by
    FROM users u
    LEFT JOIN installer_profiles p ON p.user_id = u.id
    WHERE u.role = 'installer'
    ORDER BY u.full_name ASC
  `).all();

  const result = rows.map(r => ({ ...r, tier: calculateTier(r) }));
  res.json({ users: result });
});

// PUT /api/admin/tier-data/:userId — update one installer's profile
app.put('/api/admin/tier-data/:userId', authenticateToken, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.userId);
  const {
    residential_sites, ci_sites, backup_offgrid_sites, total_kw_installed,
    scenario_ongrid, scenario_partial_backup, scenario_full_backup, scenario_ci,
    notes
  } = req.body;

  const res_sites  = Math.max(0, parseInt(residential_sites)    || 0);
  const ci_s       = Math.max(0, parseInt(ci_sites)             || 0);
  const bk_sites   = Math.max(0, parseInt(backup_offgrid_sites) || 0);
  const kw         = Math.max(0, parseFloat(total_kw_installed) || 0);
  const total_commissioned = res_sites + ci_s;

  // Auto-set CI scenario if installer has any CI projects
  const s_ci  = ci_s > 0 ? 1 : (parseInt(scenario_ci)             || 0);
  const s_og  = parseInt(scenario_ongrid)          || 0;
  const s_pb  = parseInt(scenario_partial_backup)  || 0;
  const s_fb  = parseInt(scenario_full_backup)     || 0;

  // Fetch admin name for audit trail
  const admin = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id);
  const updatedBy = admin ? admin.full_name : req.user.username;

  db.prepare(`
    UPDATE installer_profiles
    SET residential_sites = ?, ci_sites = ?, sites_commissioned = ?,
        backup_offgrid_sites = ?, total_kw_installed = ?,
        scenario_ongrid = ?, scenario_partial_backup = ?,
        scenario_full_backup = ?, scenario_ci = ?,
        notes = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
    WHERE user_id = ?
  `).run(
    res_sites, ci_s, total_commissioned,
    bk_sites, kw,
    s_og, s_pb, s_fb, s_ci,
    (notes || '').trim(), updatedBy,
    userId
  );

  const updated = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.company,
           p.residential_sites, p.ci_sites, p.backup_offgrid_sites, p.total_kw_installed,
           p.scenario_ongrid, p.scenario_partial_backup, p.scenario_full_backup, p.scenario_ci,
           p.sites_commissioned, p.notes, p.updated_at, p.updated_by
    FROM users u LEFT JOIN installer_profiles p ON p.user_id = u.id WHERE u.id = ?
  `).get(userId);

  res.json({ user: { ...updated, tier: calculateTier(updated) }, message: 'Tier data updated.' });
});

// POST /api/admin/tier-data/import — bulk CSV import (parsed rows sent as JSON)
app.post('/api/admin/tier-data/import', authenticateToken, requireAdmin, (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ error: 'No data rows provided.' });

  const admin = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id);
  const updatedBy = admin ? admin.full_name : req.user.username;

  let updated = 0, skipped = 0;
  const errors = [];

  const importOne = db.transaction((row) => {
    const user = db.prepare('SELECT id FROM users WHERE username = ? AND role = ?').get(
      (row.username || '').trim().toLowerCase(), 'installer'
    );
    if (!user) { skipped++; return; }

    const res_sites = Math.max(0, parseInt(row.residential_sites) || 0);
    const ci_s      = Math.max(0, parseInt(row.ci_sites)          || 0);
    const bk_sites  = Math.max(0, parseInt(row.backup_offgrid_sites) || 0);
    const kw        = Math.max(0, parseFloat(row.total_kw_installed)  || 0);
    const total     = res_sites + ci_s;
    const s_ci  = ci_s > 0 ? 1 : (parseInt(row.scenario_ci)            || 0);
    const s_og  = parseInt(row.scenario_ongrid)         || 0;
    const s_pb  = parseInt(row.scenario_partial_backup) || 0;
    const s_fb  = parseInt(row.scenario_full_backup)    || 0;

    db.prepare(`
      UPDATE installer_profiles
      SET residential_sites = ?, ci_sites = ?, sites_commissioned = ?,
          backup_offgrid_sites = ?, total_kw_installed = ?,
          scenario_ongrid = ?, scenario_partial_backup = ?,
          scenario_full_backup = ?, scenario_ci = ?,
          notes = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
      WHERE user_id = ?
    `).run(
      res_sites, ci_s, total, bk_sites, kw,
      s_og, s_pb, s_fb, s_ci,
      (row.notes || '').trim(), updatedBy,
      user.id
    );
    updated++;
  });

  for (const row of rows) {
    try { importOne(row); }
    catch (e) { errors.push(`${row.username || '?'}: ${e.message}`); }
  }

  res.json({ message: 'Import complete.', updated, skipped, errors });
});

// GET /api/settings — full profile for the settings page
app.get('/api/settings', authenticateToken, (req, res) => {
  const user = db.prepare(
    `SELECT id, username, full_name, company, email, phone, line_id,
            address, province, bio, role, created_at
     FROM users WHERE id = ?`
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
});

// PUT /api/settings/profile — update name, company, bio
app.put('/api/settings/profile', authenticateToken, (req, res) => {
  const { full_name, company, bio } = req.body;
  if (!full_name || !full_name.trim())
    return res.status(400).json({ error: 'Full name is required.' });
  if (!company || !company.trim())
    return res.status(400).json({ error: 'Company name is required.' });

  db.prepare(
    `UPDATE users SET full_name = ?, company = ?, bio = ? WHERE id = ?`
  ).run(full_name.trim(), company.trim(), (bio || '').trim(), req.user.id);

  const updated = db.prepare(
    `SELECT id, username, full_name, company, email, phone, line_id,
            address, province, bio, role FROM users WHERE id = ?`
  ).get(req.user.id);
  res.json({ user: updated, message: 'Profile updated successfully.' });
});

// PUT /api/settings/contact — update email, phone, LINE ID, address, province
app.put('/api/settings/contact', authenticateToken, (req, res) => {
  const { email, phone, line_id, address, province } = req.body;
  db.prepare(
    `UPDATE users SET email = ?, phone = ?, line_id = ?, address = ?, province = ? WHERE id = ?`
  ).run(
    (email    || '').trim(),
    (phone    || '').trim(),
    (line_id  || '').trim(),
    (address  || '').trim(),
    (province || '').trim(),
    req.user.id
  );
  res.json({ message: 'Contact details updated successfully.' });
});

// PUT /api/settings/password — change password
app.put('/api/settings/password', authenticateToken, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'Both current and new password are required.' });
  if (new_password.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash))
    return res.status(401).json({ error: 'Current password is incorrect.' });

  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);
  res.json({ message: 'Password changed successfully.' });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌞  BG Installer Platform`);
  console.log(`    Running at http://localhost:${PORT}`);
  console.log(`\n    Demo accounts:`);
  console.log(`    Admin     → username: admin      password: admin123`);
  console.log(`    Standard  → username: somchai    password: installer123`);
  console.log(`    Expert    → username: nattapong  password: installer123`);
  console.log(`    Master    → username: wiroj      password: installer123\n`);
});
