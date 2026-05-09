// ── State ──────────────────────────────────────────────────────────────────
const S = {
  dbOpen: false,
  dbName: '',
  tables: [],
  views: [],
  currentTable: null,
  schema: [],
  page: 1,
  limit: 50,
  total: 0,
  sortBy: '',
  sortDir: 'asc',
  selectedRowids: new Set(),
  currentEditRowid: null,
  browserPath: null,
  showHidden: false,
};

// ── API ────────────────────────────────────────────────────────────────────
const api = {
  async req(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({ error: 'Invalid server response' }));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  },
  get: (url) => api.req('GET', url),
  post: (url, body) => api.req('POST', url, body),
  put: (url, body) => api.req('PUT', url, body),
  patch: (url, body) => api.req('PATCH', url, body),
  delete: (url, body) => api.req('DELETE', url, body),
};

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ── Modal helpers ──────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-close]');
  if (btn) closeModal(btn.dataset.close);
  // close backdrop click
  if (e.target.classList.contains('modal-backdrop')) closeModal(e.target.id);
});

// ── App open/close ─────────────────────────────────────────────────────────
function showLanding() {
  document.getElementById('landing').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('headerDbName').textContent = 'No database open';
  S.dbOpen = false;
}

async function openDatabase(filePath, name) {
  try {
    await api.post('/api/open', { path: filePath });
    await afterOpen(name || filePath.split('/').pop());
  } catch (e) {
    toast(`Failed to open: ${e.message}`, 'error');
  }
}

async function afterOpen(name) {
  S.dbOpen = true;
  S.dbName = name;
  document.getElementById('landing').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('headerDbName').textContent = name;
  document.getElementById('sidebarDbName').textContent = name;
  document.title = `${name} – SQLite Viewer`;
  await refreshSidebar();
  closeSidebar();
}

async function closeDatabase() {
  if (!confirm('Close this database?')) return;
  try {
    await api.delete('/api/db');
    S.currentTable = null;
    showLanding();
    document.title = 'SQLite Viewer';
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Sidebar ────────────────────────────────────────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

async function refreshSidebar() {
  try {
    const data = await api.get('/api/db');
    S.tables = data.tables;
    S.views = data.views || [];
    renderSidebar();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderSidebar() {
  const list = document.getElementById('tableList');
  list.innerHTML = S.tables.map(t => `
    <div class="table-item${S.currentTable === t.name ? ' active' : ''}" data-table="${esc(t.name)}">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.6">
        <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
      </svg>
      <span class="table-item-name" title="${esc(t.name)}">${esc(t.name)}</span>
      ${t.count !== null ? `<span class="table-item-count">${fmtNum(t.count)}</span>` : ''}
    </div>
  `).join('');

  const viewsSection = document.getElementById('viewsSection');
  if (S.views.length) {
    viewsSection.style.display = '';
    document.getElementById('viewList').innerHTML = S.views.map(v => `
      <div class="table-item${S.currentTable === v ? ' active' : ''}" data-table="${esc(v)}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.6">
          <circle cx="12" cy="12" r="2"/><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/>
        </svg>
        <span class="table-item-name">${esc(v)}</span>
      </div>
    `).join('');
  } else {
    viewsSection.style.display = 'none';
  }

  list.querySelectorAll('.table-item').forEach(el => {
    el.addEventListener('click', () => selectTable(el.dataset.table));
  });
  document.getElementById('viewList').querySelectorAll('.table-item').forEach(el => {
    el.addEventListener('click', () => selectTable(el.dataset.table));
  });
}

// ── Table Select ───────────────────────────────────────────────────────────
async function selectTable(name) {
  S.currentTable = name;
  S.page = 1;
  S.sortBy = '';
  S.sortDir = 'asc';
  S.selectedRowids.clear();
  renderSidebar();
  closeSidebar();

  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('tableView').classList.remove('hidden');
  document.getElementById('tableName').textContent = name;

  // Switch to data tab
  switchTab('data');
  await loadTableData();
}

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-pane').forEach(p => {
    const active = p.id === `pane-${tabName}`;
    p.classList.toggle('active', active);
    p.classList.toggle('hidden', !active);
  });
  if (tabName === 'schema') loadSchema();
}

// ── Data Loading ───────────────────────────────────────────────────────────
async function loadTableData() {
  if (!S.currentTable) return;
  const loading = document.getElementById('tableLoading');
  loading.classList.remove('hidden');

  try {
    const params = new URLSearchParams({
      page: S.page,
      limit: S.limit,
      ...(S.sortBy ? { sortBy: S.sortBy, sortDir: S.sortDir } : {}),
    });
    const data = await api.get(`/api/table/${encodeURIComponent(S.currentTable)}?${params}`);
    S.schema = data.schema;
    S.total = data.total;
    renderDataTable(data.rows, data.schema);
    renderPagination();
    document.getElementById('rowCount').textContent = `${fmtNum(data.total)} rows`;
    document.getElementById('addRowForm').innerHTML = buildRowForm(data.schema);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading.classList.add('hidden');
  }
}

function renderDataTable(rows, schema) {
  const head = document.getElementById('dataHead');
  const body = document.getElementById('dataBody');

  // Header
  head.innerHTML = `<tr>
    <th class="check-cell sticky-left"><input type="checkbox" id="checkAll"></th>
    ${schema.map(c => `
      <th data-col="${esc(c.name)}" class="${S.sortBy === c.name ? 'sorted' : ''}">
        ${esc(c.name)}
        <span class="sort-arrow">${S.sortBy === c.name ? (S.sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </th>
    `).join('')}
    <th class="actions-th sticky-right">Actions</th>
  </tr>`;

  // Sort click
  head.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (S.sortBy === col) S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc';
      else { S.sortBy = col; S.sortDir = 'asc'; }
      S.page = 1;
      loadTableData();
    });
  });

  // Select all
  document.getElementById('checkAll').addEventListener('change', e => {
    const checked = e.target.checked;
    body.querySelectorAll('.row-check').forEach(cb => {
      cb.checked = checked;
      const rowid = parseInt(cb.dataset.rowid);
      if (checked) S.selectedRowids.add(rowid);
      else S.selectedRowids.delete(rowid);
    });
    updateDeleteBtn();
  });

  // Search filter
  const search = document.getElementById('searchInput').value.toLowerCase().trim();

  // Body
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${schema.length + 2}" style="text-align:center;padding:32px;color:var(--text3);">No rows found</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(row => {
    const rowid = row.__rowid__;
    const selected = S.selectedRowids.has(rowid);
    const cells = schema.map(c => {
      const val = row[c.name];
      const isNull = val === null;
      const isNum = typeof val === 'number';
      return `<td class="${isNull ? 'null-val' : isNum ? 'num-val' : ''}" title="${isNull ? 'NULL' : esc(String(val))}">${isNull ? 'NULL' : esc(String(val))}</td>`;
    });
    return `<tr class="${selected ? 'selected' : ''}" data-rowid="${rowid}">
      <td class="check-cell sticky-left"><input type="checkbox" class="row-check" data-rowid="${rowid}" ${selected ? 'checked' : ''}></td>
      ${cells.join('')}
      <td class="actions-cell sticky-right">
        <button class="row-action-btn edit-row" data-rowid="${rowid}" title="Edit row">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
        <button class="row-action-btn del del-row" data-rowid="${rowid}" title="Delete row">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');

  // Events
  body.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', e => {
      const rowid = parseInt(cb.dataset.rowid);
      if (e.target.checked) S.selectedRowids.add(rowid);
      else S.selectedRowids.delete(rowid);
      cb.closest('tr').classList.toggle('selected', e.target.checked);
      updateDeleteBtn();
    });
  });

  body.querySelectorAll('.edit-row').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const rowid = parseInt(btn.dataset.rowid);
      const row = rows.find(r => r.__rowid__ === rowid);
      openEditRowModal(rowid, row);
    });
  });

  body.querySelectorAll('.del-row').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Delete this row?')) return;
      await deleteRows([parseInt(btn.dataset.rowid)]);
    });
  });
}

function updateDeleteBtn() {
  const count = S.selectedRowids.size;
  const btn = document.getElementById('btnDeleteRows');
  btn.classList.toggle('hidden', count === 0);
  document.getElementById('deleteCount').textContent = count;
}

// ── Pagination ─────────────────────────────────────────────────────────────
function renderPagination() {
  const total = S.total;
  const limit = S.limit;
  const page = S.page;
  const pages = Math.ceil(total / limit) || 1;
  const el = document.getElementById('pagination');

  if (pages <= 1) { el.innerHTML = ''; return; }

  const pageNums = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 2) pageNums.push(i);
    else if (pageNums[pageNums.length - 1] !== '…') pageNums.push('…');
  }

  el.innerHTML = `
    <button class="page-btn" ${page === 1 ? 'disabled' : ''} data-page="${page - 1}">‹ Prev</button>
    ${pageNums.map(p => p === '…'
      ? `<span style="color:var(--text3);padding:0 4px">…</span>`
      : `<button class="page-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`
    ).join('')}
    <button class="page-btn" ${page === pages ? 'disabled' : ''} data-page="${page + 1}">Next ›</button>
    <span class="page-info">${fmtNum((page - 1) * limit + 1)}–${fmtNum(Math.min(page * limit, total))} of ${fmtNum(total)}</span>
  `;

  el.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.page = parseInt(btn.dataset.page);
      loadTableData();
    });
  });
}

// ── Row CRUD ───────────────────────────────────────────────────────────────
function useTextarea(type, val) {
  if (/^(TEXT|BLOB|JSON|CLOB|VARCHAR|CHAR|NCHAR|NVARCHAR|CHARACTER|LONGTEXT|MEDIUMTEXT|STRING)/i.test(type || '')) return true;
  if (val !== null && val !== undefined && String(val).length > 80) return true;
  return false;
}

function buildRowForm(schema, data = {}) {
  return schema.map(c => {
    const val = data[c.name] !== undefined ? data[c.name] : '';
    const isNull = val === null;
    const strVal = isNull ? '' : String(val);
    const placeholder = isNull ? 'NULL' : c.dflt_value !== null ? `default: ${c.dflt_value}` : '';
    const label = `${esc(c.name)} <span style="color:var(--text3);font-weight:400">${esc(c.type || '')}</span>${c.pk ? ' <span class="col-badge badge-pk">PK</span>' : ''}`;
    const field = useTextarea(c.type, strVal)
      ? `<textarea class="form-input row-field field-textarea" name="${esc(c.name)}" placeholder="${esc(placeholder)}">${esc(strVal)}</textarea>`
      : `<input class="form-input row-field" name="${esc(c.name)}" value="${esc(strVal)}" placeholder="${esc(placeholder)}">`;
    return `<div class="form-row"><label class="form-label">${label}</label>${field}</div>`;
  }).join('');
}

function initTextareas(container) {
  container.querySelectorAll('.field-textarea').forEach(ta => {
    const resize = () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 320) + 'px';
    };
    resize();
    ta.addEventListener('input', resize);
  });
}

function getFormData(formId) {
  const form = document.getElementById(formId);
  const data = {};
  form.querySelectorAll('.row-field').forEach(input => {
    data[input.name] = input.value === '' ? null : input.value;
  });
  return data;
}

async function insertRow() {
  const data = getFormData('addRowForm');
  try {
    await api.post(`/api/table/${encodeURIComponent(S.currentTable)}/rows`, { data });
    closeModal('modalAddRow');
    toast('Row inserted', 'success');
    S.page = Math.ceil((S.total + 1) / S.limit);
    await loadTableData();
    await refreshSidebar();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function openEditRowModal(rowid, row) {
  S.currentEditRowid = rowid;
  const form = document.getElementById('editRowForm');
  form.innerHTML = buildRowForm(S.schema, row);
  openModal('modalEditRow');
  initTextareas(form);
}

async function updateRow() {
  const data = getFormData('editRowForm');
  try {
    await api.put(`/api/table/${encodeURIComponent(S.currentTable)}/rows/${S.currentEditRowid}`, { data });
    closeModal('modalEditRow');
    toast('Row updated', 'success');
    await loadTableData();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteRows(rowids) {
  try {
    await api.delete(`/api/table/${encodeURIComponent(S.currentTable)}/rows`, { rowids });
    rowids.forEach(r => S.selectedRowids.delete(r));
    updateDeleteBtn();
    toast(`${rowids.length} row(s) deleted`, 'success');
    if (S.page > 1 && (S.total - rowids.length) <= (S.page - 1) * S.limit) S.page--;
    await loadTableData();
    await refreshSidebar();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Schema Tab ─────────────────────────────────────────────────────────────
async function loadSchema() {
  if (!S.currentTable) return;
  try {
    const data = await api.get(`/api/schema/${encodeURIComponent(S.currentTable)}`);
    renderSchema(data);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderSchema(data) {
  const { columns, indices, foreignKeys, ddl } = data;
  const container = document.getElementById('schemaView');

  container.innerHTML = `
    <!-- Rename table -->
    <div class="schema-section">
      <div class="schema-section-header">
        <h4>Table: ${esc(S.currentTable)}</h4>
        <button class="btn btn-sm btn-danger" id="btnDropTable">Drop Table</button>
      </div>
      <div class="rename-inline">
        <label style="font-size:.8125rem;color:var(--text2);white-space:nowrap">Rename to:</label>
        <input type="text" id="renameTableInput" class="form-input" value="${esc(S.currentTable)}" style="max-width:240px">
        <button class="btn btn-sm btn-primary" id="btnRenameTable">Rename</button>
      </div>
    </div>

    <!-- Columns -->
    <div class="schema-section">
      <div class="schema-section-header">
        <h4>Columns (${columns.length})</h4>
        <button class="btn btn-sm btn-success" id="btnAddColumn">+ Add Column</button>
      </div>
      <table class="schema-table">
        <thead><tr>
          <th>#</th><th>Name</th><th>Type</th><th>Flags</th><th>Default</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${columns.map(c => `
            <tr>
              <td style="color:var(--text3)">${c.cid}</td>
              <td><strong>${esc(c.name)}</strong></td>
              <td><span class="col-type">${esc(c.type || '—')}</span></td>
              <td style="display:flex;gap:4px;flex-wrap:wrap;padding:8px 12px">
                ${c.pk ? '<span class="col-badge badge-pk">PK</span>' : ''}
                ${c.notnull ? '<span class="col-badge badge-nn">NOT NULL</span>' : ''}
                ${c.pk && c.type === 'INTEGER' ? '<span class="col-badge badge-ai">ROWID</span>' : ''}
              </td>
              <td style="color:var(--text2);font-family:monospace;font-size:.8rem">${c.dflt_value !== null ? esc(c.dflt_value) : '<span style="color:var(--text3)">—</span>'}</td>
              <td>
                <div style="display:flex;gap:4px">
                  <button class="row-action-btn rename-col" data-col="${esc(c.name)}">Rename</button>
                  ${c.pk ? '' : `<button class="row-action-btn del drop-col" data-col="${esc(c.name)}">Drop</button>`}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- Indices -->
    ${indices.length ? `
    <div class="schema-section">
      <div class="schema-section-header"><h4>Indices (${indices.length})</h4></div>
      <table class="schema-table">
        <thead><tr><th>Name</th><th>Unique</th><th>Columns</th></tr></thead>
        <tbody>${indices.map(idx => `
          <tr>
            <td><code>${esc(idx.name)}</code></td>
            <td>${idx.unique ? '<span class="col-badge badge-uniq">UNIQUE</span>' : '—'}</td>
            <td>${idx.columns.map(c => esc(c.name)).join(', ')}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    </div>` : ''}

    <!-- Foreign Keys -->
    ${foreignKeys.length ? `
    <div class="schema-section">
      <div class="schema-section-header"><h4>Foreign Keys (${foreignKeys.length})</h4></div>
      <table class="schema-table">
        <thead><tr><th>From</th><th>Table</th><th>To</th><th>On Delete</th></tr></thead>
        <tbody>${foreignKeys.map(fk => `
          <tr>
            <td>${esc(fk.from)}</td>
            <td><strong>${esc(fk.table)}</strong></td>
            <td>${esc(fk.to)}</td>
            <td>${esc(fk.on_delete || '—')}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    </div>` : ''}

    <!-- DDL -->
    <div class="schema-section">
      <div class="schema-section-header"><h4>CREATE Statement</h4></div>
      <div class="schema-ddl">${esc(ddl || '—')}</div>
    </div>
  `;

  // Events
  document.getElementById('btnDropTable').addEventListener('click', async () => {
    if (!confirm(`Drop table "${S.currentTable}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/table/${encodeURIComponent(S.currentTable)}`);
      toast('Table dropped', 'success');
      S.currentTable = null;
      document.getElementById('tableView').classList.add('hidden');
      document.getElementById('emptyState').classList.remove('hidden');
      await refreshSidebar();
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('btnRenameTable').addEventListener('click', async () => {
    const newName = document.getElementById('renameTableInput').value.trim();
    if (!newName || newName === S.currentTable) return;
    try {
      await api.patch(`/api/schema/${encodeURIComponent(S.currentTable)}`, { newName });
      toast('Table renamed', 'success');
      S.currentTable = newName;
      document.getElementById('tableName').textContent = newName;
      await refreshSidebar();
      await loadSchema();
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('btnAddColumn').addEventListener('click', () => openModal('modalAddColumn'));

  container.querySelectorAll('.rename-col').forEach(btn => {
    btn.addEventListener('click', async () => {
      const col = btn.dataset.col;
      const newName = prompt(`Rename column "${col}" to:`, col);
      if (!newName || newName === col) return;
      try {
        await api.patch(`/api/schema/${encodeURIComponent(S.currentTable)}/columns/${encodeURIComponent(col)}`, { newName });
        toast('Column renamed', 'success');
        await loadSchema();
        await loadTableData();
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  container.querySelectorAll('.drop-col').forEach(btn => {
    btn.addEventListener('click', async () => {
      const col = btn.dataset.col;
      if (!confirm(`Drop column "${col}"? This cannot be undone.`)) return;
      try {
        await api.delete(`/api/schema/${encodeURIComponent(S.currentTable)}/columns/${encodeURIComponent(col)}`);
        toast('Column dropped', 'success');
        await loadSchema();
        await loadTableData();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

// ── SQL Tab ────────────────────────────────────────────────────────────────
async function runSql() {
  const sql = document.getElementById('sqlEditor').value.trim();
  if (!sql) return;
  const resultsEl = document.getElementById('sqlResults');
  resultsEl.innerHTML = '<div class="spinner" style="margin:20px auto"></div>';

  try {
    const data = await api.post('/api/query', { sql });
    if (data.type === 'select') {
      if (!data.rows.length) {
        resultsEl.innerHTML = '<div class="sql-info">Query returned 0 rows.</div>';
        return;
      }
      const cols = Object.keys(data.rows[0]);
      resultsEl.innerHTML = `
        <div class="sql-info">${data.count} row(s) returned</div>
        <div style="overflow:auto">
          <table class="sql-result-table">
            <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>${data.rows.map(row =>
              `<tr>${cols.map(c => `<td title="${esc(row[c] !== null ? String(row[c]) : 'NULL')}">${row[c] === null ? '<em style="color:var(--text3)">NULL</em>' : esc(String(row[c]))}</td>`).join('')}</tr>`
            ).join('')}</tbody>
          </table>
        </div>`;
    } else {
      resultsEl.innerHTML = `<div class="sql-info">Query executed. ${data.changes} row(s) affected. Last insert rowid: ${data.lastInsertRowid ?? '—'}</div>`;
      await refreshSidebar();
      if (S.currentTable) await loadTableData();
    }
  } catch (e) {
    resultsEl.innerHTML = `<div class="sql-error">Error: ${esc(e.message)}</div>`;
  }
}

// ── File Browser ───────────────────────────────────────────────────────────
async function openBrowser(startPath) {
  openModal('modalFileBrowser');
  await navigateBrowser(startPath || S.browserPath || null);

  // Load drives into dropdown
  try {
    const drives = await api.get('/api/drives');
    const dd = document.getElementById('drivesDropdown');
    dd.innerHTML = drives.map(d => `<div class="drive-item" data-path="${esc(d.path)}">💾 ${esc(d.name)}</div>`).join('');
    dd.querySelectorAll('.drive-item').forEach(el => {
      el.addEventListener('click', () => {
        dd.classList.add('hidden');
        navigateBrowser(el.dataset.path);
      });
    });
  } catch (_) {}
}

async function navigateBrowser(dirPath) {
  const listEl = document.getElementById('browserList');
  const crumb = document.getElementById('browserBreadcrumb');
  listEl.innerHTML = '<div class="browser-empty"><div class="spinner" style="margin:0 auto"></div></div>';

  try {
    const params = new URLSearchParams();
    if (dirPath) params.set('path', dirPath);
    if (S.showHidden) params.set('hidden', 'true');
    const data = await api.get(`/api/files?${params}`);
    S.browserPath = data.path;
    crumb.textContent = data.path;
    document.getElementById('browserUp').disabled = !data.parent;
    document.getElementById('browserUp').onclick = () => data.parent && navigateBrowser(data.parent);

    if (!data.items.length) {
      listEl.innerHTML = '<div class="browser-empty">No SQLite files or folders found here</div>';
      return;
    }

    listEl.innerHTML = data.items.map(item => `
      <div class="browser-item ${item.isDir ? 'is-dir' : 'is-file'}" data-path="${esc(item.path)}" data-isdir="${item.isDir}">
        <span class="browser-item-icon">${item.isDir ? '📁' : '🗄️'}</span>
        <span class="browser-item-name" title="${esc(item.name)}">${esc(item.name)}</span>
        ${item.size !== null ? `<span class="browser-item-size">${fmtSize(item.size)}</span>` : ''}
      </div>
    `).join('');

    listEl.querySelectorAll('.browser-item').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.isdir === 'true') {
          navigateBrowser(el.dataset.path);
        } else {
          closeModal('modalFileBrowser');
          openDatabase(el.dataset.path);
        }
      });
    });
  } catch (e) {
    listEl.innerHTML = `<div class="browser-empty" style="color:var(--danger)">${esc(e.message)}</div>`;
  }
}

// ── Add Column ─────────────────────────────────────────────────────────────
document.getElementById('newColNotNull').addEventListener('change', e => {
  document.getElementById('defaultValueRow').style.display = e.target.checked ? '' : 'none';
});

document.getElementById('btnSaveColumn').addEventListener('click', async () => {
  const name = document.getElementById('newColName').value.trim();
  const type = document.getElementById('newColType').value;
  const notNull = document.getElementById('newColNotNull').checked;
  const defaultValue = document.getElementById('newColDefault').value;
  if (!name) { toast('Column name required', 'error'); return; }

  try {
    await api.post(`/api/schema/${encodeURIComponent(S.currentTable)}/columns`, { name, type, notNull, defaultValue });
    toast(`Column "${name}" added`, 'success');
    closeModal('modalAddColumn');
    document.getElementById('newColName').value = '';
    document.getElementById('newColNotNull').checked = false;
    document.getElementById('newColDefault').value = '';
    document.getElementById('defaultValueRow').style.display = 'none';
    await loadSchema();
    await loadTableData();
  } catch (e) {
    toast(e.message, 'error');
  }
});

// ── New Table ──────────────────────────────────────────────────────────────
document.getElementById('btnCreateTable').addEventListener('click', async () => {
  const sql = document.getElementById('newTableSql').value.trim();
  if (!sql) { toast('SQL required', 'error'); return; }
  try {
    await api.post('/api/tables', { sql });
    toast('Table created', 'success');
    closeModal('modalNewTable');
    document.getElementById('newTableSql').value = '';
    await refreshSidebar();
  } catch (e) {
    toast(e.message, 'error');
  }
});

// ── Upload ─────────────────────────────────────────────────────────────────
async function handleUpload(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['db', 'sqlite', 'sqlite3', 's3db', 'sl3'].includes(ext)) {
    toast('Please select a SQLite file (.db, .sqlite, .sqlite3)', 'error');
    return;
  }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await afterOpen(data.name || file.name);
  } catch (e) {
    toast(`Upload failed: ${e.message}`, 'error');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtNum(n) { return Number(n).toLocaleString(); }
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Event Wiring ───────────────────────────────────────────────────────────
// Header
document.getElementById('sidebarToggle').addEventListener('click', () => {
  const open = document.getElementById('sidebar').classList.contains('open');
  if (open) closeSidebar(); else openSidebar();
});
document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
document.getElementById('btnBrowse').addEventListener('click', () => openBrowser());
document.getElementById('sidebarBrowse').addEventListener('click', () => openBrowser());
document.getElementById('btnUpload').addEventListener('click', () => document.getElementById('fileInput').click());
document.getElementById('fileInput').addEventListener('change', e => handleUpload(e.target.files[0]));

// Landing
document.getElementById('landingBrowse').addEventListener('click', () => openBrowser());
document.getElementById('landingUpload').addEventListener('click', () => document.getElementById('fileInput').click());

// Sidebar
document.getElementById('btnCloseDb').addEventListener('click', closeDatabase);
document.getElementById('btnNewTable').addEventListener('click', () => openModal('modalNewTable'));

// Content header
document.getElementById('btnAddRow').addEventListener('click', () => {
  openModal('modalAddRow');
  initTextareas(document.getElementById('addRowForm'));
});
document.getElementById('btnSaveRow').addEventListener('click', insertRow);
document.getElementById('btnUpdateRow').addEventListener('click', updateRow);
document.getElementById('btnDeleteRows').addEventListener('click', async () => {
  if (!confirm(`Delete ${S.selectedRowids.size} row(s)?`)) return;
  await deleteRows([...S.selectedRowids]);
});
document.getElementById('btnExport').addEventListener('click', () => {
  if (S.currentTable) window.open(`/api/table/${encodeURIComponent(S.currentTable)}/export.csv`);
});

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// SQL
document.getElementById('btnRunSql').addEventListener('click', runSql);
document.getElementById('sqlEditor').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runSql(); }
});

// Search
let searchTimer;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { S.page = 1; loadTableData(); }, 300);
});

// Limit
document.getElementById('limitSelect').addEventListener('change', e => {
  S.limit = parseInt(e.target.value);
  S.page = 1;
  loadTableData();
});

// File browser
document.getElementById('showHidden').addEventListener('change', e => {
  S.showHidden = e.target.checked;
  navigateBrowser(S.browserPath);
});
document.getElementById('browserDrivesBtn').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('drivesDropdown').classList.toggle('hidden');
});
document.addEventListener('click', e => {
  if (!e.target.closest('.browser-drives-btn')) {
    document.getElementById('drivesDropdown').classList.add('hidden');
  }
});

// Drag & drop
const dropZone = document.getElementById('dropZone');
['dragenter', 'dragover'].forEach(ev => {
  dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
});
['dragleave', 'drop'].forEach(ev => {
  dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
});
dropZone.addEventListener('drop', e => {
  const file = e.dataTransfer.files[0];
  if (file) handleUpload(file);
});

// Global drag & drop (when app is open)
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) handleUpload(file);
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(m => m.classList.add('hidden'));
    closeSidebar();
  }
});
