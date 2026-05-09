const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;

// sql.js singleton
let SQL = null;
const sqlReady = initSqlJs().then(s => { SQL = s; });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Active DB state
let activeDb = null;   // sql.js Database instance
let activePath = null; // file path on disk

// ── sql.js helpers ────────────────────────────────────────────────────────

function ident(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

// Execute a SELECT-style query, return array of plain objects
function dbAll(sql, params = []) {
  const stmt = activeDb.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Execute a single SELECT, return first row or null
function dbGet(sql, params = []) {
  const rows = dbAll(sql, params);
  return rows[0] ?? null;
}

// Execute a write statement, persist to disk, return {changes, lastInsertRowid}
function dbRun(sql, params = []) {
  activeDb.run(sql, params.length ? params : null);
  saveDb();
  const changes = activeDb.getRowsModified();
  const lastRow = dbGet('SELECT last_insert_rowid() as id');
  return { changes, lastInsertRowid: lastRow?.id ?? null };
}

// Run a group of writes in a transaction
function dbTransaction(fn) {
  activeDb.run('BEGIN TRANSACTION');
  try {
    fn();
    activeDb.run('COMMIT');
    saveDb();
  } catch (e) {
    try { activeDb.run('ROLLBACK'); } catch (_) {}
    throw e;
  }
}

// Load DB from disk into memory
function openDb(filePath) {
  if (activeDb) { try { activeDb.close(); } catch (_) {} }
  const fileData = fs.readFileSync(filePath);
  activeDb = new SQL.Database(fileData);
  activePath = filePath;
  // Enable WAL pragma (best-effort)
  try { activeDb.run("PRAGMA foreign_keys = ON"); } catch (_) {}
}

// Persist in-memory DB back to disk
function saveDb() {
  if (!activeDb || !activePath) return;
  const data = activeDb.export();
  fs.writeFileSync(activePath, Buffer.from(data));
}

function getDb() {
  if (!activeDb) throw new Error('No database open');
  return activeDb;
}

// Wait for sql.js to be ready
app.use(async (req, res, next) => {
  if (!SQL) await sqlReady;
  next();
});

// ── File Browser ──────────────────────────────────────────────────────────

app.get('/api/files', (req, res) => {
  let dirPath = req.query.path;
  if (!dirPath) dirPath = os.homedir();
  dirPath = path.normalize(dirPath);

  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    const showHidden = req.query.hidden === 'true';
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (e) {
      return res.status(403).json({ error: `Permission denied: ${dirPath}` });
    }

    const items = entries
      .filter(item => {
        if (!showHidden && item.name.startsWith('.')) return false;
        if (item.isDirectory()) return true;
        return /\.(db|sqlite|sqlite3|s3db|sl3)$/i.test(item.name);
      })
      .map(item => {
        const fullPath = path.join(dirPath, item.name);
        let size = null;
        try { if (item.isFile()) size = fs.statSync(fullPath).size; } catch (_) {}
        return { name: item.name, path: fullPath, isDir: item.isDirectory(), size };
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const root = path.parse(dirPath).root;
    const parent = dirPath === root ? null : path.dirname(dirPath);
    res.json({ path: dirPath, parent, root, items });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/drives', (req, res) => {
  const drives = [];
  if (process.platform === 'win32') {
    for (let i = 65; i <= 90; i++) {
      const d = `${String.fromCharCode(i)}:\\`;
      try { fs.statSync(d); drives.push({ name: d, path: d }); } catch (_) {}
    }
  } else {
    drives.push({ name: 'Root (/)', path: '/' });
    drives.push({ name: 'Home', path: os.homedir() });
    ['/Volumes', '/mnt', '/media'].forEach(m => {
      try {
        fs.readdirSync(m, { withFileTypes: true }).forEach(e => {
          if (e.isDirectory()) drives.push({ name: e.name, path: path.join(m, e.name) });
        });
      } catch (_) {}
    });
  }
  res.json(drives);
});

// ── Database Open ─────────────────────────────────────────────────────────

app.post('/api/open', (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Path required' });
  try {
    openDb(filePath);
    res.json({ success: true, path: filePath, name: path.basename(filePath) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    openDb(req.file.path);
    res.json({ success: true, path: req.file.path, name: req.file.originalname });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/db', (req, res) => {
  try {
    getDb();
    const allTables = dbAll(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const tables = allTables.map(r => {
      let count = null;
      try { count = dbGet(`SELECT COUNT(*) as c FROM ${ident(r.name)}`)?.c ?? null; } catch (_) {}
      return { name: r.name, count };
    });
    const views = dbAll("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name").map(r => r.name);
    res.json({ path: activePath, name: path.basename(activePath), tables, views });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/db', (req, res) => {
  try {
    if (activeDb) { try { activeDb.close(); } catch (_) {} }
    activeDb = null;
    activePath = null;
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Table Data ────────────────────────────────────────────────────────────

app.get('/api/table/:name', (req, res) => {
  try {
    getDb();
    const table = req.params.name;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || '';
    const sortDir = req.query.sortDir === 'desc' ? 'DESC' : 'ASC';

    const schema = dbAll(`PRAGMA table_info(${ident(table)})`);
    const totalRow = dbGet(`SELECT COUNT(*) as c FROM ${ident(table)}`);
    const total = totalRow?.c ?? 0;

    let sql = `SELECT rowid as __rowid__, * FROM ${ident(table)}`;
    if (sortBy && schema.find(c => c.name === sortBy)) {
      sql += ` ORDER BY ${ident(sortBy)} ${sortDir}`;
    }
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    const rows = dbAll(sql);
    res.json({ rows, total, page, limit, schema, name: table });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Insert row
app.post('/api/table/:name/rows', (req, res) => {
  try {
    getDb();
    const table = req.params.name;
    const { data } = req.body;
    const keys = Object.keys(data);
    if (!keys.length) return res.status(400).json({ error: 'No data provided' });
    const cols = keys.map(ident).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const vals = Object.values(data);
    const result = dbRun(`INSERT INTO ${ident(table)} (${cols}) VALUES (${placeholders})`, vals);
    res.json({ success: true, rowid: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Update row by rowid
app.put('/api/table/:name/rows/:rowid', (req, res) => {
  try {
    getDb();
    const table = req.params.name;
    const rowid = parseInt(req.params.rowid);
    const { data } = req.body;
    const keys = Object.keys(data);
    if (!keys.length) return res.json({ success: true });
    const setClauses = keys.map(k => `${ident(k)} = ?`).join(', ');
    const vals = [...Object.values(data), rowid];
    dbRun(`UPDATE ${ident(table)} SET ${setClauses} WHERE rowid = ?`, vals);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Delete rows by rowids
app.delete('/api/table/:name/rows', (req, res) => {
  try {
    getDb();
    const table = req.params.name;
    const { rowids } = req.body;
    if (!rowids?.length) return res.status(400).json({ error: 'No rowids provided' });
    const placeholders = rowids.map(() => '?').join(', ');
    dbRun(`DELETE FROM ${ident(table)} WHERE rowid IN (${placeholders})`, rowids);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Schema ────────────────────────────────────────────────────────────────

app.get('/api/schema/:name', (req, res) => {
  try {
    getDb();
    const name = req.params.name;
    const columns = dbAll(`PRAGMA table_info(${ident(name)})`);
    const indexList = dbAll(`PRAGMA index_list(${ident(name)})`);
    const indices = indexList.map(idx => ({
      ...idx,
      columns: dbAll(`PRAGMA index_info(${ident(idx.name)})`),
    }));
    const foreignKeys = dbAll(`PRAGMA foreign_key_list(${ident(name)})`);
    const ddlRow = dbGet(`SELECT sql FROM sqlite_master WHERE name = ?`, [name]);
    res.json({ columns, indices, foreignKeys, ddl: ddlRow?.sql });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Add column
app.post('/api/schema/:name/columns', (req, res) => {
  try {
    getDb();
    const table = req.params.name;
    const { name, type, notNull, defaultValue } = req.body;
    let sql = `ALTER TABLE ${ident(table)} ADD COLUMN ${ident(name)} ${type || 'TEXT'}`;
    if (notNull && defaultValue !== undefined && defaultValue !== null && defaultValue !== '') {
      const defVal = typeof defaultValue === 'string'
        ? `'${defaultValue.replace(/'/g, "''")}'`
        : defaultValue;
      sql += ` NOT NULL DEFAULT ${defVal}`;
    }
    dbRun(sql);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Rename column
app.patch('/api/schema/:name/columns/:col', (req, res) => {
  try {
    getDb();
    const table = req.params.name;
    const oldCol = req.params.col;
    const { newName } = req.body;
    dbRun(`ALTER TABLE ${ident(table)} RENAME COLUMN ${ident(oldCol)} TO ${ident(newName)}`);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Drop column — try native first, fall back to table recreation
app.delete('/api/schema/:name/columns/:col', (req, res) => {
  try {
    getDb();
    const table = req.params.name;
    const col = req.params.col;

    let dropped = false;
    try {
      dbRun(`ALTER TABLE ${ident(table)} DROP COLUMN ${ident(col)}`);
      dropped = true;
    } catch (_) {}

    if (!dropped) {
      // Recreate table without the column
      const columns = dbAll(`PRAGMA table_info(${ident(table)})`);
      const remaining = columns.filter(c => c.name !== col);
      if (!remaining.length) throw new Error('Cannot remove all columns');

      const pkCols = remaining.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk);
      const colDefs = remaining.map(c => {
        let def = `${ident(c.name)} ${c.type || 'TEXT'}`;
        if (c.notnull) def += ' NOT NULL';
        if (c.dflt_value !== null) def += ` DEFAULT ${c.dflt_value}`;
        if (c.pk && pkCols.length === 1) def += ' PRIMARY KEY';
        return def;
      });
      if (pkCols.length > 1) {
        colDefs.push(`PRIMARY KEY (${pkCols.map(c => ident(c.name)).join(', ')})`);
      }

      const tmp = `__tmp_drop_${Date.now()}`;
      const colNames = remaining.map(c => ident(c.name)).join(', ');

      dbTransaction(() => {
        activeDb.run(`CREATE TABLE ${ident(tmp)} (${colDefs.join(', ')})`);
        activeDb.run(`INSERT INTO ${ident(tmp)} (${colNames}) SELECT ${colNames} FROM ${ident(table)}`);
        activeDb.run(`DROP TABLE ${ident(table)}`);
        activeDb.run(`ALTER TABLE ${ident(tmp)} RENAME TO ${ident(table)}`);
      });
    }

    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Rename table
app.patch('/api/schema/:name', (req, res) => {
  try {
    getDb();
    const oldName = req.params.name;
    const { newName } = req.body;
    dbRun(`ALTER TABLE ${ident(oldName)} RENAME TO ${ident(newName)}`);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Drop table
app.delete('/api/table/:name', (req, res) => {
  try {
    getDb();
    dbRun(`DROP TABLE IF EXISTS ${ident(req.params.name)}`);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Create table
app.post('/api/tables', (req, res) => {
  try {
    getDb();
    const { sql } = req.body;
    dbRun(sql);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── SQL Query ─────────────────────────────────────────────────────────────

app.post('/api/query', (req, res) => {
  try {
    getDb();
    const { sql } = req.body;
    const trimmed = sql.trim();
    const isSelect = /^(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(trimmed);

    if (isSelect) {
      const rows = dbAll(trimmed);
      res.json({ rows, type: 'select', count: rows.length });
    } else {
      dbRun(trimmed);
      const changes = activeDb.getRowsModified();
      const lastRow = dbGet('SELECT last_insert_rowid() as id');
      res.json({ type: 'run', changes, lastInsertRowid: lastRow?.id ?? null });
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Export CSV ────────────────────────────────────────────────────────────

app.get('/api/table/:name/export.csv', (req, res) => {
  try {
    getDb();
    const table = req.params.name;
    const rows = dbAll(`SELECT * FROM ${ident(table)}`);
    if (!rows.length) {
      res.setHeader('Content-Disposition', `attachment; filename="${table}.csv"`);
      return res.type('text/csv').send('');
    }
    const headers = Object.keys(rows[0]);
    const escape = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = [
      headers.map(escape).join(','),
      ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
    ].join('\n');
    res.setHeader('Content-Disposition', `attachment; filename="${table}.csv"`);
    res.type('text/csv').send(csv);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  SQLite Viewer  →  http://localhost:${PORT}\n`);
});
