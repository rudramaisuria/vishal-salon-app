const API_URL = '/api';
const LOCAL_STORAGE_KEY = 'vpsalon_v2';

let state = {
  customers: [],
  services: [],
  cashflows: [],
  staff: [],
  stats: { customersCount: 0, todayPending: 0, remindersCount: 0 },
  activeTab: 'home',
  serverOnline: false
};

// Utilities
function money(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}

function fmt(d) {
  if (!d) return '-';
  const parts = d.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return d;
}

function fmtSlash(d) {
  if (!d) return '-';
  const parts = d.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return d;
}

function currentTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function fmtTime(t, createdAt = '') {
  let timeStr = t;
  if (!timeStr && createdAt) {
    const match = String(createdAt).match(/(\d{2}):(\d{2})/);
    if (match) timeStr = `${match[1]}:${match[2]}`;
  }
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return timeStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function daysUntil(md) {
  if (!md) return 999;
  const now = new Date();
  const y = now.getFullYear();
  const [m, d] = md.split('-').slice(-2).map(Number);
  let target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  if (target < now) target.setFullYear(y + 1);
  return Math.round((target - now) / 86400000);
}

// ========================
// API CLIENT
// ========================
async function api(path, options = {}) {
  try {
    options.headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const res = await fetch(`${API_URL}${path}`, options);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Server request failed');
    }
    updateConnectionStatus(true);
    return await res.json();
  } catch (err) {
    console.error('API Error:', err);
    updateConnectionStatus(false);
    throw err;
  }
}

function updateConnectionStatus(isOnline) {
  state.serverOnline = isOnline;
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (dot && text) {
    if (isOnline) {
      dot.style.background = '#22c55e';
      text.textContent = 'Server Connected';
    } else {
      dot.style.background = '#ef4444';
      text.textContent = 'Offline';
    }
  }
}

// ========================
// INIT & DATA SYNC
// ========================
async function init() {
  await loadAllData();
  setupEventListeners();
  renderAll();
  checkLegacyDataMigration();
}

async function loadAllData() {
  try {
    const [services, customers, cashflows, stats, staff] = await Promise.all([
      api('/services'),
      api('/customers'),
      api('/cashflows'),
      api('/stats'),
      api('/staff').catch(() => [{ id: 1, name: 'Vishal Maisuria (Owner)' }])
    ]);
    state.services = services;
    state.customers = customers;
    state.cashflows = cashflows;
    state.stats = stats;
    state.staff = staff || [{ id: 1, name: 'Vishal Maisuria (Owner)' }];
  } catch (e) {
    console.warn('Could not load from backend, attempting localStorage fallback...', e);
    const local = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || 'null');
    if (local) {
      state.services = local.services || [];
      state.customers = local.customers || [];
      state.cashflows = local.cashflows || [];
      state.staff = local.staff || [{ id: 1, name: 'Vishal Maisuria (Owner)' }];
    }
  }
}

async function checkLegacyDataMigration() {
  const legacy = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy);
      if (parsed && (parsed.customers?.length || parsed.cashflows?.length)) {
        const shouldMigrate = confirm(
          'તમારા બ્રાઉઝરમાં જૂનો Salon Data મળ્યો છે. શું તેને Database માં સેવ (Import) કરવો છે?'
        );
        if (shouldMigrate) {
          await api('/import', {
            method: 'POST',
            body: JSON.stringify(parsed)
          });
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          alert('ડેટા સફળતાપૂર્વક Database માં migrate થઈ ગયો છે!');
          await loadAllData();
          renderAll();
        }
      }
    } catch (e) {
      console.error('Legacy migration check failed:', e);
    }
  }
}

function setupEventListeners() {
  const cBill = document.getElementById('cBill');
  const cPaid = document.getElementById('cPaid');
  if (cBill) cBill.addEventListener('input', updateCustomerPaymentPreview);
  if (cPaid) cPaid.addEventListener('input', updateCustomerPaymentPreview);

  const searchInput = document.getElementById('search');
  if (searchInput) {
    searchInput.addEventListener('input', () => renderCustomers());
  }

  const cfDate = document.getElementById('cfDate');
  if (cfDate && !cfDate.value) cfDate.value = today();

  const cfTime = document.getElementById('cfTime');
  if (cfTime && !cfTime.value) cfTime.value = currentTime();

  const cfFilterDate = document.getElementById('cfFilterDate');
  if (cfFilterDate) cfFilterDate.value = '';
}

// ========================
// TAB NAVIGATION
// ========================
function showTab(id) {
  state.activeTab = id;
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.bottom-nav button').forEach(btn => btn.classList.remove('active'));

  const activeSec = document.getElementById(id);
  const activeBtn = document.getElementById('tab-' + id);
  if (activeSec) activeSec.classList.add('active');
  if (activeBtn) activeBtn.classList.add('active');

  renderAll();
}

// ========================
// MODAL CONTROLLER
// ========================
function openModal(html) {
  const body = document.getElementById('modalBody');
  const modal = document.getElementById('modal');
  if (body && modal) {
    body.innerHTML = html;
    modal.classList.add('show');
  }
}

function closeModal() {
  const modal = document.getElementById('modal');
  if (modal) modal.classList.remove('show');
}

// ========================
// SERVICE SELECTION SYSTEM
// ========================
function serviceOptionsHTML() {
  if (!state.services.length) return '<option value="">No services available</option>';
  return '<option value="">+ Select Service</option>' + state.services.map((s, i) => {
    const sName = s.name || s[0];
    const sPrice = s.price !== undefined ? s.price : s[1];
    return `<option value="${i}">${esc(sName)} - ${money(sPrice)}</option>`;
  }).join('');
}

function selectedServiceIndexes(prefix) {
  const listId = prefix + 'SelectedServiceList';
  const box = document.getElementById(listId);
  if (!box) return [];
  return [...box.querySelectorAll('.selected-service')]
    .map(el => Number(el.dataset.index))
    .filter(i => state.services[i]);
}

function chooseService(prefix, val) {
  if (val === '') return;
  const index = Number(val);
  const service = state.services[index];
  if (!service) return;

  const current = selectedServiceIndexes(prefix);
  if (current.includes(index)) return;

  const listId = prefix + 'SelectedServiceList';
  const box = document.getElementById(listId);
  if (!box) return;

  const sName = service.name || service[0];
  const sPrice = service.price !== undefined ? service.price : service[1];

  const row = document.createElement('div');
  row.className = 'multi-service-item selected-service';
  row.dataset.index = index;
  row.innerHTML = `
    <span><b>${esc(sName)}</b> <span class="item-sub">${money(sPrice)}</span></span>
    <button type="button" class="btn-danger" style="padding:4px 8px;font-size:12px" onclick="removeSelectedService('${prefix}', ${index})">✕</button>
  `;
  box.appendChild(row);

  const selectEl = document.getElementById(prefix + 'ServiceSelect');
  if (selectEl) selectEl.value = '';

  updateSelectedSummary(prefix);
}

function removeSelectedService(prefix, index) {
  const listId = prefix + 'SelectedServiceList';
  const box = document.getElementById(listId);
  if (!box) return;

  const row = [...box.querySelectorAll('.selected-service')].find(el => Number(el.dataset.index) === Number(index));
  if (row) row.remove();

  updateSelectedSummary(prefix);
}

function clearSelectedServices(prefix) {
  const listId = prefix + 'SelectedServiceList';
  const box = document.getElementById(listId);
  if (!box) return;
  box.innerHTML = '';
  updateSelectedSummary(prefix);
}

function updateSelectedSummary(prefix) {
  const indexes = selectedServiceIndexes(prefix);
  const total = indexes.reduce((acc, i) => {
    const s = state.services[i];
    const priceVal = s.price !== undefined ? s.price : s[1];
    return acc + Number(priceVal || 0);
  }, 0);

  const billInput = document.getElementById(prefix + 'Bill');
  if (billInput) billInput.value = total;

  const summaryEl = document.getElementById(prefix + 'SelectedSummary');
  if (summaryEl) {
    summaryEl.innerHTML = indexes.length
      ? `<b>${indexes.length} Service(s) selected</b> • Total: ${money(total)}`
      : 'કોઈ service select નથી.';
  }

  if (prefix === 'c') updateCustomerPaymentPreview();
  if (prefix === 'm') updateModalPaymentPreview();
  if (prefix === 'v') updateVisitPaymentPreview();
}

function updateCustomerPaymentPreview() {
  const bill = Number(document.getElementById('cBill')?.value || 0);
  const paid = Number(document.getElementById('cPaid')?.value || 0);
  const due = Math.max(0, bill - paid);
  const advance = Math.max(0, paid - bill);

  const dueEl = document.getElementById('cDue');
  const advEl = document.getElementById('cAdvance');
  if (dueEl) dueEl.textContent = money(due);
  if (advEl) advEl.textContent = money(advance);
}

function updateModalPaymentPreview() {
  const bill = Number(document.getElementById('mBill')?.value || 0);
  const paid = Number(document.getElementById('mPaid')?.value || 0);
  const due = Math.max(0, bill - paid);
  const advance = Math.max(0, paid - bill);

  const dueEl = document.getElementById('mDue');
  const advEl = document.getElementById('mAdvance');
  if (dueEl) dueEl.textContent = money(due);
  if (advEl) advEl.textContent = money(advance);
}

function updateVisitPaymentPreview() {
  const bill = Number(document.getElementById('vBill')?.value || 0);
  const paid = Number(document.getElementById('vPaid')?.value || 0);
  const due = Math.max(0, bill - paid);

  const dueEl = document.getElementById('vDue');
  if (dueEl) dueEl.textContent = money(due);
}

// ========================
// CUSTOMER MANAGEMENT
// ========================
async function saveCustomer() {
  const name = document.getElementById('cName')?.value.trim();
  if (!name) return alert('Customer name લખો');

  const mobile = document.getElementById('cMobile')?.value.trim() || '';
  const birth = document.getElementById('cBirth')?.value || '';
  const ann = document.getElementById('cAnn')?.value || '';
  const bill = Number(document.getElementById('cBill')?.value || 0);
  const paid = Number(document.getElementById('cPaid')?.value || 0);

  if (paid < 0) return alert('Paid amount ખોટી છે');

  const selectedNames = selectedServiceIndexes('c').map(i => state.services[i].name || state.services[i][0]);
  const visit = (selectedNames.length || bill > 0 || paid > 0) ? {
    date: today(),
    service: selectedNames.join(', ') || 'Service',
    services: selectedNames,
    bill,
    paid
  } : null;

  try {
    await api('/customers', {
      method: 'POST',
      body: JSON.stringify({ name, mobile, birth, ann, visit })
    });

    // Reset Form
    document.getElementById('cName').value = '';
    document.getElementById('cMobile').value = '';
    document.getElementById('cBill').value = '';
    document.getElementById('cPaid').value = '0';
    document.getElementById('cBirth').value = '';
    document.getElementById('cAnn').value = '';
    clearSelectedServices('c');
    updateCustomerPaymentPreview();

    alert('Customer સફળતાપૂર્વક સાચવવામાં આવ્યો!');
    await loadAllData();
    renderAll();
  } catch (err) {
    alert('Customer save કરતાં ભૂલ આવી: ' + err.message);
  }
}

// ========================
// STAFF HELPER FUNCTIONS
// ========================
function staffOptionsHTML(selectedName = 'Vishal Maisuria (Owner)') {
  const isOwnerSelected = selectedName === 'Vishal Maisuria (Owner)' ? 'selected' : '';
  let opts = `<option value="Vishal Maisuria (Owner)" ${isOwnerSelected}>👑 Vishal Maisuria (Owner)</option>`;

  const staffMembers = (state.staff || []).filter(s => !s.name.toLowerCase().includes('owner') && !s.name.toLowerCase().includes('vishal'));
  staffMembers.forEach(s => {
    const isSelected = s.name === selectedName ? 'selected' : '';
    opts += `<option value="${esc(s.name)}" ${isSelected}>👤 ${esc(s.name)}</option>`;
  });
  opts += `<option value="__custom__">➕ + Type other staff name...</option>`;
  return opts;
}

function toggleCustomStaffInput(prefix, val) {
  const customInput = document.getElementById(prefix + 'CustomStaff');
  if (customInput) {
    if (val === '__custom__') {
      customInput.style.display = 'block';
      customInput.focus();
    } else {
      customInput.style.display = 'none';
      customInput.value = '';
    }
  }
}

function getSelectedStaff(prefix) {
  const sel = document.getElementById(prefix + 'ServiceBy');
  if (!sel) return 'Vishal Maisuria (Owner)';
  if (sel.value === '__custom__') {
    const custom = document.getElementById(prefix + 'CustomStaff')?.value.trim();
    return custom || 'Vishal Maisuria (Owner)';
  }
  return sel.value || 'Vishal Maisuria (Owner)';
}

async function ensureStaffExists(name) {
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  const exists = (state.staff || []).some(s => s.name.toLowerCase() === trimmed.toLowerCase());
  if (!exists) {
    try {
      const updated = await api('/staff', {
        method: 'POST',
        body: JSON.stringify({ name: trimmed })
      });
      state.staff = updated;
    } catch (e) {
      console.warn('Could not add staff automatically:', e);
    }
  }
}

function openCustomerModal(id = '') {
  const c = state.customers.find(x => x.id === id);

  openModal(`
    <div class="modal-header">
      <h2 style="font-size:18px">${c ? 'Customer Profile' : '➕ Add Customer'}</h2>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="grid">
      <div>
        <label>Name</label>
        <input id="mName" value="${esc(c?.name || '')}" placeholder="Customer name">
      </div>
      <div>
        <label>Mobile</label>
        <input id="mMobile" value="${esc(c?.mobile || '')}" placeholder="Mobile number">
      </div>
      ${!c ? `
      <div>
        <label>Visit Date (તારીખ)</label>
        <input id="mDate" type="date" value="${today()}">
      </div>
      <div>
        <label>Visit Time (સમય)</label>
        <input id="mTime" type="time" value="${currentTime()}">
      </div>
      <div style="grid-column: 1 / -1">
        <label>Services (એક પછી એક પસંદ કરો)</label>
        <select id="mServiceSelect" onchange="chooseService('m', this.value)"></select>
        <div id="mSelectedServiceList" class="multi-service-list"></div>
        <div id="mSelectedSummary" class="selected-service-box">કોઈ service select નથી.</div>
      </div>
      <div>
        <label>Total Bill Amount</label>
        <input id="mBill" type="number" placeholder="Total Bill" oninput="updateModalPaymentPreview()">
      </div>
      <div>
        <label>Paid Amount</label>
        <input id="mPaid" type="number" value="0" placeholder="કેટલું ચૂકવ્યું?" oninput="updateModalPaymentPreview()">
      </div>
      <div style="grid-column: 1 / -1">
        <label>Service Given By (કોના દ્વારા સર્વિસ આપી?)</label>
        <div style="display:flex; flex-direction:column; gap:6px">
          <select id="mServiceBy" onchange="toggleCustomStaffInput('m', this.value)">
            ${staffOptionsHTML('Vishal Maisuria (Owner)')}
          </select>
          <input id="mCustomStaff" placeholder="✍️ Type staff member name..." style="display:none">
        </div>
      </div>
      ` : ''}
      <div>
        <label>Birthday</label>
        <input id="mBirth" type="date" value="${c?.birth || ''}">
      </div>
      <div>
        <label>Anniversary</label>
        <input id="mAnn" type="date" value="${c?.ann || ''}">
      </div>
    </div>

    ${!c ? `
    <div class="grid" style="margin-top:10px">
      <div class="stat"><span class="stat-label">💰 બાકી</span><b id="mDue">₹0</b></div>
      <div class="stat"><span class="stat-label">🟢 જમા</span><b id="mAdvance">₹0</b></div>
    </div>
    ` : ''}

    <br>
    <button class="btn-primary" style="width:100%" onclick="saveModalCustomer('${id}')">Save Details</button>

    ${c ? `
      <hr style="margin:20px 0; border:0; border-top:1px solid #eee">
      <h3>➕ Add Visit / Bill</h3>
      <div class="grid">
        <div>
          <label>Visit Date (તારીખ)</label>
          <input id="vDate" type="date" value="${today()}">
        </div>
        <div>
          <label>Visit Time (સમય)</label>
          <input id="vTime" type="time" value="${currentTime()}">
        </div>
      </div>
      <label>Services (એક પછી એક select કરો)</label>
      <select id="vServiceSelect" onchange="chooseService('v', this.value)"></select>
      <div id="vSelectedServiceList" class="multi-service-list"></div>
      <div id="vSelectedSummary" class="selected-service-box">કોઈ service select નથી.</div>

      <div class="grid" style="margin-top:8px">
        <div>
          <label>Bill Amount</label>
          <input id="vBill" type="number" placeholder="Bill" oninput="updateVisitPaymentPreview()">
        </div>
        <div>
          <label>Paid Amount</label>
          <input id="vPaid" type="number" value="0" placeholder="Paid" oninput="updateVisitPaymentPreview()">
        </div>
      </div>
      <div style="margin-top:8px">
        <label>Service Given By (કોના દ્વારા સર્વિસ આપી?)</label>
        <div style="display:flex; flex-direction:column; gap:6px">
          <select id="vServiceBy" onchange="toggleCustomStaffInput('v', this.value)">
            ${staffOptionsHTML('Vishal Maisuria (Owner)')}
          </select>
          <input id="vCustomStaff" placeholder="✍️ Type staff member name..." style="display:none">
        </div>
      </div>
      <div class="stat" style="margin-top:10px">
        <span class="stat-label">💰 આ Visit ની બાકી રકમ</span><b id="vDue">₹0</b>
      </div>
      <br>
      <button class="btn-gold" style="width:100%" onclick="addVisit('${c.id}')">+ Add Visit / Save Bill</button>

      <hr style="margin:20px 0; border:0; border-top:1px solid #eee">
      <h3>📜 Visit History</h3>
      <div>${renderHistoryHTML(c)}</div>
      <br>
      <button class="btn-danger" style="width:100%" onclick="deleteCustomer('${c.id}')">Delete Customer Profile</button>
    ` : ''}
  `);

  if (c) {
    const el = document.getElementById('vServiceSelect');
    if (el) el.innerHTML = serviceOptionsHTML();
    updateSelectedSummary('v');
  } else {
    const el = document.getElementById('mServiceSelect');
    if (el) el.innerHTML = serviceOptionsHTML();
    updateSelectedSummary('m');
  }
}

async function saveModalCustomer(id) {
  const name = document.getElementById('mName')?.value.trim();
  if (!name) return alert('Customer name લખો');

  const mobile = document.getElementById('mMobile')?.value.trim() || '';
  const birth = document.getElementById('mBirth')?.value || '';
  const ann = document.getElementById('mAnn')?.value || '';

  try {
    if (id) {
      await api(`/customers/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, mobile, birth, ann })
      });
      alert('Customer updated!');
    } else {
      const bill = Number(document.getElementById('mBill')?.value || 0);
      const paid = Number(document.getElementById('mPaid')?.value || 0);
      const selectedNames = selectedServiceIndexes('m').map(i => state.services[i].name || state.services[i][0]);
      const serviceBy = getSelectedStaff('m');
      await ensureStaffExists(serviceBy);

      const vDate = document.getElementById('mDate')?.value || today();
      const vTime = document.getElementById('mTime')?.value || currentTime();
      const visit = (selectedNames.length || bill > 0 || paid > 0) ? {
        date: vDate,
        time: vTime,
        service: selectedNames.join(', ') || 'Service',
        services: selectedNames,
        bill,
        paid,
        service_by: serviceBy
      } : null;

      await api('/customers', {
        method: 'POST',
        body: JSON.stringify({ name, mobile, birth, ann, visit })
      });
      alert('Customer added!');
    }

    closeModal();
    await loadAllData();
    renderAll();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function addVisit(customerId) {
  const date = document.getElementById('vDate')?.value || today();
  const time = document.getElementById('vTime')?.value || currentTime();
  const selectedNames = selectedServiceIndexes('v').map(i => state.services[i].name || state.services[i][0]);
  const bill = Number(document.getElementById('vBill')?.value || 0);
  const paid = Number(document.getElementById('vPaid')?.value || 0);
  const serviceBy = getSelectedStaff('v');
  await ensureStaffExists(serviceBy);

  if (!selectedNames.length && bill <= 0) {
    return alert('ઓછામાં ઓછી 1 service select કરો અથવા Bill amount લખો');
  }
  if (paid < 0 || paid > bill) {
    return alert('Paid amount bill કરતાં વધારે ન હોઈ શકે');
  }

  try {
    await api(`/customers/${customerId}/visits`, {
      method: 'POST',
      body: JSON.stringify({
        date,
        time,
        service: selectedNames.join(', ') || 'Service',
        services: selectedNames,
        bill,
        paid,
        service_by: serviceBy
      })
    });
    alert('Visit save થઈ ગઈ!');
    await loadAllData();
    renderAll();
    openCustomerModal(customerId);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function renderHistoryHTML(c) {
  if (!c.visits || !c.visits.length) {
    return '<div class="empty">હજુ કોઈ visit નથી</div>';
  }
  return c.visits.map(v => {
    const due = Math.max(0, Number(v.bill || 0) - Number(v.paid || 0));
    return `
      <div class="item">
        <div class="item-header">
          <div>
            <b>📅 ${fmtSlash(v.date)}${fmtTime(v.time, v.created_at) ? ' • 🕒 ' + fmtTime(v.time, v.created_at) : ''}</b>
            <div style="font-size:14px; font-weight:600; margin-top:2px">${esc(v.service)}</div>
            <div style="margin-top:4px">
              <span class="staff-badge ${(v.service_by || '').toLowerCase().includes('owner') ? 'owner' : 'member'}">
                ${(v.service_by || '').toLowerCase().includes('owner') ? '👑 ' : '👤 '}Served by: <b>${esc(v.service_by || 'Vishal Maisuria (Owner)')}</b>
              </span>
            </div>
          </div>
          <span class="badge ${due > 0 ? 'badge-pending' : 'badge-paid'}">
            ${due > 0 ? 'બાકી ' + money(due) : 'Paid'}
          </span>
        </div>
        <div class="item-sub">
          Bill: ${money(v.bill)} • Paid: ${money(v.paid)} ${due > 0 ? '• બાકી: ' + money(due) : ''}
        </div>
        ${due > 0 ? `
          <button class="btn-gold" style="margin-top:8px; padding:6px 12px; font-size:12px"
            onclick="payVisit('${c.id}', '${v.id}')">💰 Pay Remaining (${money(due)})</button>
        ` : ''}
      </div>
    `;
  }).join('');
}

async function payVisit(customerId, visitId) {
  const customer = state.customers.find(c => c.id === customerId);
  const visit = customer?.visits?.find(v => v.id === visitId);
  if (!visit) return;

  const due = Math.max(0, Number(visit.bill) - Number(visit.paid));
  const entered = prompt(`આ Visit ની બાકી રકમ ${money(due)} છે. કેટલું ચૂકવ્યું?`, due);
  if (entered === null) return;

  const amount = Number(entered);
  if (isNaN(amount) || amount <= 0 || amount > due) {
    return alert('ચુકવણીની રકમ ખોટી છે');
  }

  try {
    await api(`/customers/${customerId}/visits/${visitId}/pay`, {
      method: 'POST',
      body: JSON.stringify({ amount })
    });
    alert('Payment save થઈ ગયું!');
    await loadAllData();
    renderAll();
    // Refresh modal if still open
    if (document.getElementById('modal').classList.contains('show')) {
      openCustomerModal(customerId);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function saveDirectPayment(customerId, visitId) {
  const inputEl = document.getElementById(`payInput_${visitId}`);
  if (!inputEl) return;

  const customer = state.customers.find(c => c.id === customerId);
  const visit = customer?.visits?.find(v => v.id === visitId);
  if (!visit) return;

  const due = Math.max(0, Number(visit.bill) - Number(visit.paid));
  const amount = Number(inputEl.value);

  if (isNaN(amount) || amount <= 0) {
    return alert('યોગ્ય ચુકવણીની રકમ લખો');
  }
  if (amount > due) {
    return alert(`ચુકવણી રકમ બાકી ${money(due)} કરતાં વધારે ન હોઈ શકે`);
  }

  try {
    await api(`/customers/${customerId}/visits/${visitId}/pay`, {
      method: 'POST',
      body: JSON.stringify({ amount })
    });
    alert(`₹${amount} ની ચુકવણી સફળતાપૂર્વક Save થઈ ગઈ!`);
    await loadAllData();
    renderAll();
    // Refresh modal if history modal is open
    if (document.getElementById('modal').classList.contains('show')) {
      openCustomerHistoryModal(customerId);
    }
  } catch (err) {
    alert('Payment save કરતાં ભૂલ આવી: ' + err.message);
  }
}

async function deleteCustomer(id) {
  if (!confirm('આ Customer અને તેની તમામ Visits કાયમ માટે Delete કરવી છે?')) return;
  try {
    await api(`/customers/${id}`, { method: 'DELETE' });
    closeModal();
    alert('Customer delete થઈ ગયો!');
    await loadAllData();
    renderAll();
  } catch (err) {
    alert('Delete કરતાં ભૂલ: ' + err.message);
  }
}

// ========================
// RENDERING FUNCTIONS
// ========================
function renderCustomers() {
  const query = (document.getElementById('search')?.value || '').toLowerCase().trim();
  const filtered = state.customers.filter(c =>
    (c.name || '').toLowerCase().includes(query) ||
    (c.mobile || '').includes(query)
  );

  const homeListEl = document.getElementById('customerList');
  const allListEl = document.getElementById('allCustomers');

  const html = filtered.length
    ? filtered.map(customerCard).join('')
    : '<div class="empty">કોઈ Customer મળ્યો નથી</div>';

  if (homeListEl) homeListEl.innerHTML = html;
  if (allListEl) allListEl.innerHTML = html;
}

function getInitials(name) {
  if (!name) return '✂️';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

function renderCustomerServicesLines(c) {
  if (!c.visits || !c.visits.length) {
    return '<div style="font-size:12px; color:#888; font-style:italic; padding:4px 0">કોઈ service history નથી</div>';
  }

  const rows = [];
  for (const v of c.visits) {
    const vDate = fmtSlash(v.date);
    const vTime = fmtTime(v.time, v.created_at);
    const dateTimeStr = vTime ? `${vDate} at ${vTime}` : vDate;
    const serviceList = (v.services && v.services.length) ? v.services : [v.service || 'Service'];

    for (const sName of serviceList) {
      if (!sName) continue;
      const found = state.services.find(s => (s.name || s[0])?.toLowerCase() === sName.toLowerCase());
      let price = found ? (found.price !== undefined ? found.price : found[1]) : null;
      if (price === null || price === undefined) {
        price = serviceList.length === 1 ? v.bill : Math.round(v.bill / serviceList.length);
      }
      rows.push(`
        <div class="service-item-row">
          <div class="service-item-left">
            ✂️ <b>${esc(sName)}</b> - ${money(price)} - ${dateTimeStr}
          </div>
        </div>
      `);
    }
  }

  return `<div class="services-list-vertical">${rows.join('')}</div>`;
}

function customerCard(c) {
  const totalBill = c.totalBill || 0;
  const totalPaid = c.totalPaid || 0;
  const totalDue = c.totalDue || 0;
  const initials = getInitials(c.name);

  const cleanPhone = (c.mobile || '').replace(/\D/g, '');
  const phoneActions = cleanPhone ? `
    <a href="tel:${cleanPhone}" class="quick-action-pill phone-pill" title="Call Customer">📞 Call</a>
    <a href="https://wa.me/91${cleanPhone.length === 10 ? cleanPhone : cleanPhone.slice(-10)}" target="_blank" class="quick-action-pill wa-pill" title="WhatsApp Message">💬 WhatsApp</a>
  ` : '';

  // Today Celebration Badges
  const birthDays = c.birth ? daysUntil(c.birth) : 999;
  const annDays = c.ann ? daysUntil(c.ann) : 999;

  let todayBadgesHTML = '';
  if (birthDays === 0) {
    todayBadgesHTML += `
      <div class="today-celebration-badge birthday">
        🎉 <b>Birthday Today!</b> <span>(આજે જન્મદિવસ છે! 🎂)</span>
      </div>
    `;
  }
  if (annDays === 0) {
    todayBadgesHTML += `
      <div class="today-celebration-badge anniversary">
        💍 <b>Anniversary Today!</b> <span>(આજે એનિવર્સરી છે! 🥂)</span>
      </div>
    `;
  }

  // Vertical Service List with Price and Date (Each new service on new line)
  const serviceRowsHTML = renderCustomerServicesLines(c);

  // Occasions (when not today, show upcoming chips)
  let occasionHTML = '';
  if (c.birth && birthDays !== 0) {
    occasionHTML += `
      <span class="occasion-chip ${birthDays <= 7 ? 'upcoming' : ''}">
        🎂 Birthday: ${fmtSlash(c.birth)} ${birthDays <= 7 ? `<b>(${birthDays}d)</b>` : ''}
      </span>
    `;
  }
  if (c.ann && annDays !== 0) {
    occasionHTML += `
      <span class="occasion-chip ${annDays <= 7 ? 'upcoming' : ''}">
        💍 Anniversary: ${fmtSlash(c.ann)} ${annDays <= 7 ? `<b>(${annDays}d)</b>` : ''}
      </span>
    `;
  }

  return `
    <div class="customer-card">
      ${todayBadgesHTML}

      <div class="customer-card-top">
        <div class="customer-profile-cluster">
          <div class="customer-avatar">${initials}</div>
          <div class="customer-meta">
            <span class="customer-name">${esc(c.name)}</span>
            <div class="customer-contact-row">
              <span class="customer-phone">${esc(c.mobile || 'No Mobile')}</span>
              ${phoneActions}
            </div>
          </div>
        </div>

        <div>
          ${totalDue > 0
            ? `<span class="status-badge-pending">⚠️ ${money(totalDue)} બાકી</span>`
            : `<span class="status-badge-clear">✓ Clear</span>`
          }
        </div>
      </div>

      ${serviceRowsHTML}

      <div class="financial-strip">
        <div class="financial-col">
          <span class="financial-label">Total Bill</span>
          <span class="financial-value">${money(totalBill)}</span>
        </div>
        <div class="financial-col">
          <span class="financial-label">Paid</span>
          <span class="financial-value paid-val">${money(totalPaid)}</span>
        </div>
        <div class="financial-col">
          <span class="financial-label">બાકી (Due)</span>
          <span class="financial-value ${totalDue > 0 ? 'due-val' : ''}">${money(totalDue)}</span>
        </div>
      </div>

      ${occasionHTML ? `<div class="occasions-row">${occasionHTML}</div>` : ''}

      <div class="customer-card-actions">
        <button class="btn-yellow-edit" onclick="openEditCustomerModal('${c.id}')">
          ✏️ Edit Customer
        </button>
        <button class="btn-open-history" onclick="openCustomerHistoryModal('${c.id}')">
          📜 View History & Billing →
        </button>
      </div>
    </div>
  `;
}

function openCustomerHistoryModal(id) {
  const c = state.customers.find(x => x.id === id);
  if (!c) return;

  const totalBill = c.totalBill || 0;
  const totalPaid = c.totalPaid || 0;
  const totalDue = c.totalDue || 0;

  const historyListHTML = (c.visits && c.visits.length) ? c.visits.map(v => {
    const due = Math.max(0, Number(v.bill || 0) - Number(v.paid || 0));
    const serviceList = (v.services && v.services.length) ? v.services : [v.service || 'Service'];
    const vTime = fmtTime(v.time, v.created_at);
    const serviceBreakdown = serviceList.map(sName => {
      const found = state.services.find(s => (s.name || s[0])?.toLowerCase() === sName.toLowerCase());
      const p = found ? (found.price !== undefined ? found.price : found[1]) : (serviceList.length === 1 ? v.bill : Math.round(v.bill / serviceList.length));
      return `<div style="padding:2px 0">✂️ <b>${esc(sName)}</b> - ${money(p)} - ${fmtSlash(v.date)}${vTime ? ' at ' + vTime : ''}</div>`;
    }).join('');

    return `
      <div class="item" style="padding:14px 0">
        <div class="item-header">
          <div>
            <b style="font-size:15px">📅 Visit: ${fmtSlash(v.date)}${vTime ? ' • 🕒 ' + vTime : ''}</b>
            <div style="margin-top:4px">
              <span class="staff-badge ${(v.service_by || '').toLowerCase().includes('owner') ? 'owner' : 'member'}">
                ${(v.service_by || '').toLowerCase().includes('owner') ? '👑 ' : '👤 '}Served by: <b>${esc(v.service_by || 'Vishal Maisuria (Owner)')}</b>
              </span>
            </div>
            <div style="margin-top:6px; font-size:13px; color:#333; line-height:1.6">
              ${serviceBreakdown}
            </div>
          </div>
          <span class="badge ${due > 0 ? 'badge-pending' : 'badge-paid'}">
            ${due > 0 ? 'બાકી ' + money(due) : '✓ Paid'}
          </span>
        </div>
        <div class="item-sub" style="margin-top:8px; font-size:13px; font-weight:600">
          Total Bill: ${money(v.bill)} • Paid: ${money(v.paid)} ${due > 0 ? '• <span style="color:var(--danger)">બાકી: ' + money(due) + '</span>' : ''}
        ${due > 0 ? `
          <div class="payment-inline-row">
            <div class="pay-box remaining-box">
              <span class="pay-box-title">Total Remaining</span>
              <b class="pay-box-val">${money(due)}</b>
            </div>
            <div class="pay-box input-box">
              <span class="pay-box-title">Pay Amount</span>
              <input type="number" id="payInput_${v.id}" class="pay-input" value="${due}" min="1" max="${due}" placeholder="Pay ₹">
            </div>
            <button class="pay-box save-box-btn" onclick="saveDirectPayment('${c.id}', '${v.id}')">
              💾 Save
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('') : '<div class="empty">આ Customer ની કોઈ Visit History નથી.</div>';

  openModal(`
    <div class="modal-header">
      <div>
        <h2 style="font-size:18px; margin:0">📜 Visit History & Billing</h2>
        <div style="font-size:13px; color:#666; margin-top:2px">👤 ${esc(c.name)} ${c.mobile ? '• 📱 ' + esc(c.mobile) : ''}</div>
      </div>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>

    <div class="financial-strip" style="margin:12px 0 16px">
      <div class="financial-col">
        <span class="financial-label">Total Billed</span>
        <span class="financial-value">${money(totalBill)}</span>
      </div>
      <div class="financial-col">
        <span class="financial-label">Total Paid</span>
        <span class="financial-value paid-val">${money(totalPaid)}</span>
      </div>
      <div class="financial-col">
        <span class="financial-label">Total બાકી</span>
        <span class="financial-value ${totalDue > 0 ? 'due-val' : ''}">${money(totalDue)}</span>
      </div>
    </div>

    <div style="max-height:55vh; overflow-y:auto">
      ${historyListHTML}
    </div>

    <button class="btn-muted" style="width:100%; margin-top:16px" onclick="closeModal()">Close</button>
  `);
}

function openEditCustomerModal(id) {
  const c = state.customers.find(x => x.id === id);
  if (!c) return;

  openModal(`
    <div class="modal-header">
      <h2 style="font-size:18px; margin:0">✏️ Edit Customer Profile</h2>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>

    <div class="grid">
      <div>
        <label>1. 👤 Name</label>
        <input id="editName" value="${esc(c.name)}" placeholder="Customer name">
      </div>
      <div>
        <label>2. 📱 Mobile</label>
        <input id="editMobile" inputmode="tel" value="${esc(c.mobile || '')}" placeholder="Mobile number">
      </div>
      <div>
        <label>3. 🎂 Birthday</label>
        <input id="editBirth" type="date" value="${c.birth || ''}">
      </div>
      <div>
        <label>4. 💍 Anniversary</label>
        <input id="editAnn" type="date" value="${c.ann || ''}">
      </div>
    </div>

    <button class="btn-yellow-edit" style="margin-top:16px" onclick="saveCustomerProfile('${c.id}')">
      💾 Save Changes
    </button>

    <hr style="margin:20px 0; border:0; border-top:1px solid #eee">

    <h3 style="font-size:15px; margin-bottom:10px">➕ Add New Visit / Bill for this Customer</h3>
    <div class="grid">
      <div>
        <label>Visit Date (તારીખ)</label>
        <input id="vDate" type="date" value="${today()}">
      </div>
      <div>
        <label>Visit Time (સમય)</label>
        <input id="vTime" type="time" value="${currentTime()}">
      </div>
    </div>

    <label>Services (એક પછી એક પસંદ કરો)</label>
    <select id="vServiceSelect" onchange="chooseService('v', this.value)"></select>
    <div id="vSelectedServiceList" class="multi-service-list"></div>
    <div id="vSelectedSummary" class="selected-service-box">કોઈ service select નથી.</div>

    <div class="grid" style="margin-top:8px">
      <div>
        <label>Bill Amount</label>
        <input id="vBill" type="number" placeholder="Bill" oninput="updateVisitPaymentPreview()">
      </div>
      <div>
        <label>Paid Amount</label>
        <input id="vPaid" type="number" value="0" placeholder="Paid" oninput="updateVisitPaymentPreview()">
      </div>
    </div>
    <div style="margin-top:8px">
      <label>Service Given By (કોના દ્વારા સર્વિસ આપી?)</label>
      <div style="display:flex; flex-direction:column; gap:6px">
        <select id="vServiceBy" onchange="toggleCustomStaffInput('v', this.value)">
          ${staffOptionsHTML('Vishal Maisuria (Owner)')}
        </select>
        <input id="vCustomStaff" placeholder="✍️ Type staff member name..." style="display:none">
      </div>
    </div>
    <div class="stat" style="margin-top:10px">
      <span class="stat-label">💰 આ Visit ની બાકી રકમ</span><b id="vDue">₹0</b>
    </div>

    <button class="btn-primary" style="width:100%; margin-top:12px" onclick="addVisit('${c.id}')">
      + Save Visit
    </button>

    <hr style="margin:20px 0; border:0; border-top:1px solid #eee">

    <button class="btn-danger" style="width:100%" onclick="deleteCustomer('${c.id}')">
      🗑️ Delete Customer Profile
    </button>
  `);

  const el = document.getElementById('vServiceSelect');
  if (el) el.innerHTML = serviceOptionsHTML();
  updateSelectedSummary('v');
}

async function saveCustomerProfile(id) {
  const name = document.getElementById('editName')?.value.trim();
  if (!name) return alert('Customer name લખો');

  const mobile = document.getElementById('editMobile')?.value.trim() || '';
  const birth = document.getElementById('editBirth')?.value || '';
  const ann = document.getElementById('editAnn')?.value || '';

  try {
    await api(`/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, mobile, birth, ann })
    });
    closeModal();
    alert('Customer વિગતો સફળતાપૂર્વક Update થઈ ગઈ!');
    await loadAllData();
    renderAll();
  } catch (err) {
    alert('Update કરતાં ભૂલ આવી: ' + err.message);
  }
}

function renderPending() {
  const filterDate = document.getElementById('pendingDate')?.value || today();
  const listEl = document.getElementById('pendingList');
  if (!listEl) return;

  const pendingItems = [];
  for (const c of state.customers) {
    for (const v of c.visits || []) {
      const due = Math.max(0, Number(v.bill || 0) - Number(v.paid || 0));
      if (v.date === filterDate && due > 0) {
        pendingItems.push({ c, v, due });
      }
    }
  }

  if (!pendingItems.length) {
    listEl.innerHTML = `<div class="empty">આ તારીખે (${fmt(filterDate)}) કોઈ બાકી Payment નથી.</div>`;
    return;
  }

  listEl.innerHTML = pendingItems.map(({ c, v, due }) => `
    <div class="item">
      <div class="item-header">
        <div>
          <b>👤 ${esc(c.name)}</b>
          <div class="item-sub">📱 ${esc(c.mobile || '-')}</div>
        </div>
        <span class="badge badge-pending">${money(due)} બાકી</span>
      </div>
      <div style="font-size:13px; margin: 6px 0;">
        ${esc(v.service)} • Bill ${money(v.bill)} • Paid ${money(v.paid)}
      <div class="payment-inline-row">
        <div class="pay-box remaining-box">
          <span class="pay-box-title">Total Remaining</span>
          <b class="pay-box-val">${money(due)}</b>
        </div>
        <div class="pay-box input-box">
          <span class="pay-box-title">Pay Amount</span>
          <input type="number" id="payInput_${v.id}" class="pay-input" value="${due}" min="1" max="${due}" placeholder="Pay ₹">
        </div>
        <button class="pay-box save-box-btn" onclick="saveDirectPayment('${c.id}', '${v.id}')">
          💾 Save
        </button>
      </div>
    </div>
  `).join('');
}

function renderReminders() {
  const listEl = document.getElementById('reminderList');
  if (!listEl) return;

  const reminders = [];
  for (const c of state.customers) {
    if (c.birth) {
      const d = daysUntil(c.birth);
      if (d <= 7) reminders.push({ c, type: '🎂 Birthday', isBirthday: true, days: d, date: c.birth });
    }
    if (c.ann) {
      const d = daysUntil(c.ann);
      if (d <= 7) reminders.push({ c, type: '💍 Anniversary', isBirthday: false, days: d, date: c.ann });
    }
  }

  reminders.sort((a, b) => a.days - b.days);

  if (!reminders.length) {
    listEl.innerHTML = '<div class="empty">આગામી 7 દિવસમાં કોઈ Birthday કે Anniversary નથી.</div>';
    return;
  }

  listEl.innerHTML = reminders.map(r => {
    const isToday = r.days === 0;
    const isBirthday = r.isBirthday;
    const initials = getInitials(r.c.name);
    const cleanPhone = (r.c.mobile || '').replace(/\D/g, '');

    // WhatsApp Greeting link with personalized message
    const wishMessage = encodeURIComponent(
      `Hello ${r.c.name}! Wishing you a very Happy ${isBirthday ? 'Birthday 🎂' : 'Wedding Anniversary 💍'} from V Professional Unisex Salon! Have a wonderful day filled with joy! 🎉`
    );
    const waLink = cleanPhone ? `https://wa.me/91${cleanPhone.length === 10 ? cleanPhone : cleanPhone.slice(-10)}?text=${wishMessage}` : '';

    const phoneHtml = cleanPhone ? `
      <a href="tel:${cleanPhone}" class="quick-action-pill phone-pill" title="Call">📞 Call</a>
      ${waLink ? `<a href="${waLink}" target="_blank" class="quick-action-pill wa-pill" title="Send WhatsApp">💬 WhatsApp</a>` : ''}
    ` : '';

    const headerPill = isToday
      ? `<div class="reminder-header-pill today-badge ${!isBirthday ? 'anniversary-badge' : ''}">
          <span>${isBirthday ? '🎉 🎂 BIRTHDAY TODAY!' : '🥂 💍 ANNIVERSARY TODAY!'}</span>
          <span style="font-size:11px">આજે છે! ⭐</span>
         </div>`
      : `<div class="reminder-header-pill upcoming-badge">
          <span>${isBirthday ? '🎂 Birthday Coming' : '💍 Anniversary Coming'}</span>
          <span>⏳ ${r.days} દિવસમાં</span>
         </div>`;

    return `
      <div class="reminder-card ${isToday ? 'is-today' : ''} ${!isBirthday ? 'is-anniversary' : ''}">
        ${headerPill}

        <div class="reminder-profile-row">
          <div class="customer-profile-cluster">
            <div class="customer-avatar">${initials}</div>
            <div class="customer-meta">
              <span class="customer-name">${esc(r.c.name)}</span>
              <div class="customer-contact-row">
                <span class="customer-phone">${esc(r.c.mobile || 'No Mobile')}</span>
                ${phoneHtml}
              </div>
            </div>
          </div>
        </div>

        <div class="reminder-date-info">
          <div>
            <b>${r.type}</b>
          </div>
          <div>
            📅 <b>${fmtSlash(r.date)}</b>
          </div>
        </div>

        <div class="reminder-actions-row">
          <button class="btn-reminder-profile" onclick="openEditCustomerModal('${r.c.id}')">
            <span>✏️</span> Customer Profile ખોલો
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ========================
// CASHFLOW (આવક - જાવક)
// ========================
async function addCashflow() {
  const date = document.getElementById('cfDate')?.value || today();
  const time = document.getElementById('cfTime')?.value || currentTime();
  const type = document.getElementById('cfType')?.value;
  const amount = Number(document.getElementById('cfAmount')?.value || 0);
  const note = document.getElementById('cfNote')?.value.trim() || '';

  if (amount <= 0) return alert('યોગ્ય Amount (રકમ) લખો');

  try {
    await api('/cashflows', {
      method: 'POST',
      body: JSON.stringify({ date, time, type, amount, note })
    });
    document.getElementById('cfAmount').value = '';
    document.getElementById('cfNote').value = '';
    const cfTimeEl = document.getElementById('cfTime');
    if (cfTimeEl) cfTimeEl.value = currentTime();
    
    // Clear filter so the new entry is immediately visible
    const filterEl = document.getElementById('cfFilterDate');
    if (filterEl) filterEl.value = '';

    alert('Entry સફળતાપૂર્વક Save થઈ ગઈ!');
    await loadAllData();
    renderAll();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function clearCashflowFilter() {
  const filterEl = document.getElementById('cfFilterDate');
  if (filterEl) filterEl.value = '';
  renderCashflow();
}

async function deleteCashflow(id) {
  if (!confirm('આ Entry delete કરવી છે?')) return;
  try {
    await api(`/cashflows/${id}`, { method: 'DELETE' });
    await loadAllData();
    renderAll();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function renderCashflow() {
  const filter = document.getElementById('cfFilterDate')?.value || '';
  const listEl = document.getElementById('cashflowList');
  if (!listEl) return;

  const filtered = state.cashflows.filter(x => !filter || x.date === filter);
  const income = filtered.filter(x => x.type === 'income').reduce((a, x) => a + Number(x.amount || 0), 0);
  const expense = filtered.filter(x => x.type === 'expense').reduce((a, x) => a + Number(x.amount || 0), 0);
  const net = income - expense;

  const filterBanner = filter
    ? `<div style="font-size:12px; color:#555; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
        <span>📅 Filtered by: <b>${fmtSlash(filter)}</b> (${filtered.length} entries)</span>
        <a href="javascript:void(0)" onclick="clearCashflowFilter()" style="color:#2563eb; font-weight:700">Clear Filter</a>
       </div>`
    : `<div style="font-size:12px; color:#666; margin-bottom:8px">
        📋 Showing <b>all ${filtered.length} entries</b>
       </div>`;

  listEl.innerHTML = `
    <div class="grid3" style="margin-bottom:14px">
      <div class="stat"><span class="stat-label">🟢 આવક</span><b style="color:var(--success)">${money(income)}</b></div>
      <div class="stat"><span class="stat-label">🔴 જાવક</span><b style="color:var(--danger)">${money(expense)}</b></div>
      <div class="stat"><span class="stat-label">💵 બેલેન્સ</span><b>${money(net)}</b></div>
    </div>
    ${filterBanner}
  ` + (filtered.length ? filtered.map(item => {
    const isIncome = item.type === 'income';
    const cfTime = fmtTime(item.time, item.created_at);
    return `
      <div class="cashflow-card ${isIncome ? 'is-income' : 'is-expense'}">
        <div class="cashflow-card-header">
          <div class="cashflow-type-badge ${isIncome ? 'income-badge' : 'expense-badge'}">
            <span>${isIncome ? '🟢 આવક (Income)' : '🔴 જાવક (Expense)'}</span>
          </div>
          <div class="cashflow-amount ${isIncome ? 'income-amount' : 'expense-amount'}">
            ${isIncome ? '+' : '-'}${money(item.amount)}
          </div>
        </div>

        <div class="cashflow-body">
          <div class="cashflow-meta-row">
            <span class="cashflow-date-badge">
              📅 ${fmtSlash(item.date)}${cfTime ? ' • 🕒 ' + cfTime : ''}
            </span>
            ${item.note ? `
              <span class="cashflow-note-text">
                📝 <b>${esc(item.note)}</b>
              </span>
            ` : '<span class="cashflow-note-text" style="color:#a8a29e; font-style:italic">કોઈ નોંધ નથી</span>'}
          </div>
          <button class="btn-delete-cashflow" title="Delete Entry" onclick="deleteCashflow('${item.id}')">
            🗑️ Delete
          </button>
        </div>
      </div>
    `;
  }).join('') : '<div class="empty">આ તારીખ માટે કોઈ Entry નથી.</div>');
}

// ========================
// SERVICES & PRICES
// ========================
function renderServices() {
  const listEl = document.getElementById('servicesList');
  if (!listEl) return;

  const searchInput = document.getElementById('serviceSearch');
  const q = (searchInput?.value || '').toLowerCase().trim();
  const clearBtn = document.getElementById('clearServiceSearchBtn');
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

  const statusEl = document.getElementById('serviceSearchStatus');

  const indexed = (state.services || []).map((s, idx) => ({
    name: s.name || s[0] || '',
    price: s.price !== undefined ? s.price : s[1],
    origIdx: idx
  }));

  const filtered = q
    ? indexed.filter(x => x.name.toLowerCase().includes(q))
    : indexed;

  if (statusEl) {
    if (q) {
      if (filtered.length > 0) {
        statusEl.innerHTML = `<span style="color:#22c55e">✅ Service "${esc(searchInput.value.trim())}" મળી ગઈ (${filtered.length} found)</span>`;
      } else {
        statusEl.innerHTML = `<span style="color:#ef4444">❌ Service "${esc(searchInput.value.trim())}" ઉમેરેલી નથી (Not Added)</span>`;
      }
    } else {
      statusEl.innerHTML = `<span style="color:var(--text-muted)">કુલ ${state.services.length} services catalog માં છે</span>`;
    }
  }

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="empty" style="padding:16px; text-align:center; background:rgba(255,255,255,0.03); border:1px dashed #3f3f46; border-radius:10px; margin-bottom:12px">
        <div style="font-size:22px; margin-bottom:6px">🔍</div>
        <div style="color:var(--text-muted); font-size:13px; margin-bottom:10px">
          "<b>${esc(searchInput.value.trim())}</b>" નામની કોઈ Service Catalog માં નથી.
        </div>
        <button class="btn-gold" style="font-size:13px; padding:7px 14px" onclick="addNewSearchedService()">+ Add "${esc(searchInput.value.trim())}" Service Now</button>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(item => {
    const i = item.origIdx;
    const sName = item.name;
    const sPrice = item.price;
    return `
      <div class="service-edit" id="srv-row-${i}">
        <input id="sn${i}" value="${esc(sName)}" placeholder="Service name" oninput="if(state.services[${i}]) state.services[${i}].name = this.value">
        <input id="sp${i}" type="number" value="${sPrice}" placeholder="₹ Price" oninput="if(state.services[${i}]) state.services[${i}].price = Number(this.value)">
        <button class="btn-danger" onclick="removeService(${i})">✕</button>
      </div>
    `;
  }).join('');
}

function clearServiceSearch() {
  const searchInput = document.getElementById('serviceSearch');
  if (searchInput) searchInput.value = '';
  renderServices();
}

function addNewSearchedService() {
  const searchInput = document.getElementById('serviceSearch');
  const name = searchInput ? searchInput.value.trim() : '';
  state.services.push({ name: name || 'New Service', price: 0 });
  if (searchInput) searchInput.value = '';
  renderServices();
}

function addServiceRow() {
  const searchInput = document.getElementById('serviceSearch');
  if (searchInput) searchInput.value = '';
  state.services.push({ name: 'New Service', price: 0 });
  renderServices();
}

function removeService(index) {
  if (confirm('આ Service delete કરવી છે?')) {
    state.services.splice(index, 1);
    renderServices();
  }
}

async function saveServices() {
  // Sync visible DOM inputs to state.services
  state.services.forEach((s, i) => {
    const n = document.getElementById('sn' + i);
    const p = document.getElementById('sp' + i);
    if (n) s.name = n.value.trim();
    if (p) s.price = Number(p.value || 0);
  });

  const updated = state.services.map(s => ({
    name: (s.name || s[0] || '').trim(),
    price: Number(s.price !== undefined ? s.price : s[1] || 0)
  })).filter(s => s.name);

  try {
    const saved = await api('/services/sync', {
      method: 'POST',
      body: JSON.stringify({ services: updated })
    });
    state.services = saved;
    alert('તમામ Services અને Prices Save થઈ ગયા!');
    await loadAllData();
    renderAll();
  } catch (err) {
    alert('Save કરતાં ભૂલ આવી: ' + err.message);
  }
}

// ========================
// PAYMENT CALENDAR
// ========================
function openCalendarModal() {
  renderCalendarView(today());
}

function renderCalendarView(selectedDate) {
  const d = new Date(selectedDate + 'T00:00:00');
  const y = d.getFullYear();
  const m = d.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const lastDay = new Date(y, m + 1, 0).getDate();

  // Find due marks per date
  const pendingByDate = {};
  for (const c of state.customers) {
    for (const v of c.visits || []) {
      const due = Math.max(0, Number(v.bill || 0) - Number(v.paid || 0));
      if (due > 0) {
        pendingByDate[v.date] = (pendingByDate[v.date] || 0) + due;
      }
    }
  }

  const dayNames = ['રવિ', 'સોમ', 'મંગળ', 'બુધ', 'ગુરુ', 'શુક્ર', 'શનિ'];
  let cells = dayNames.map(x => `<div class="day head">${x}</div>`).join('');

  for (let i = 0; i < firstDay; i++) cells += '<div></div>';

  for (let day = 1; day <= lastDay; day++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const hasDue = pendingByDate[ds];
    const isSel = ds === selectedDate;

    cells += `
      <div class="day ${hasDue ? 'mark' : ''} ${isSel ? 'selected' : ''}" onclick="renderCalendarView('${ds}')">
        <b>${day}</b>
        ${hasDue ? `<br><span style="font-size:10px; color:var(--danger)">${money(hasDue)}</span>` : ''}
      </div>
    `;
  }

  openModal(`
    <div class="modal-header">
      <h2 style="font-size:18px">📅 Payment Calendar</h2>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
      <button class="btn-muted" onclick="shiftCalendarMonth(-1, '${selectedDate}')">‹ Prev</button>
      <b style="font-size:16px">${d.toLocaleString('en', { month: 'long' })} ${y}</b>
      <button class="btn-muted" onclick="shiftCalendarMonth(1, '${selectedDate}')">Next ›</button>
    </div>
    <div class="calendar">${cells}</div>
    <hr style="margin:16px 0; border:0; border-top:1px solid #eee">
    <div id="calendarDetails"></div>
  `);

  showCalendarDetails(selectedDate);
}

function shiftCalendarMonth(step, selectedDate) {
  const d = new Date(selectedDate + 'T00:00:00');
  d.setMonth(d.getMonth() + step);
  renderCalendarView(d.toISOString().slice(0, 10));
}

function showCalendarDetails(ds) {
  const detailsEl = document.getElementById('calendarDetails');
  if (!detailsEl) return;

  const items = [];
  for (const c of state.customers) {
    for (const v of c.visits || []) {
      const due = Math.max(0, Number(v.bill || 0) - Number(v.paid || 0));
      if (v.date === ds && due > 0) items.push({ c, v, due });
    }
  }

  detailsEl.innerHTML = `
    <h3 style="font-size:15px; margin-bottom:8px">${fmt(ds)} - Pending Payments</h3>
    ${items.length ? items.map(({ c, v, due }) => `
      <div class="item">
        <div class="item-header">
          <div><b>${esc(c.name)}</b> <span class="item-sub">(${esc(v.service)})</span></div>
          <b style="color:var(--danger)">${money(due)}</b>
        </div>
        <button class="btn-gold" style="padding:5px 12px; font-size:12px; margin-top:4px" onclick="payVisit('${c.id}','${v.id}')">
          💰 Pay
        </button>
      </div>
    `).join('') : '<div class="empty">આ તારીખે કોઈ બાકી રકમ નથી.</div>'}
  `;
}

// ========================
// BACKUP / EXPORT / IMPORT
// ========================
async function exportDataBackup() {
  try {
    const data = await api('/export');
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vishal_salon_backup_${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Export error: ' + err.message);
  }
}

async function importDataBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!confirm('આ Backup File Import કરવાથી વર્તમાન Data Update થશે. શું આગળ વધવું છે?')) return;
      await api('/import', {
        method: 'POST',
        body: JSON.stringify(parsed)
      });
      alert('Backup સફળતાપૂર્વક Restore થઈ ગયું!');
      await loadAllData();
      renderAll();
    } catch (err) {
      alert('Import કરતાં ભૂલ આવી: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ========================
// STAFF & SERVICE REPORT
// ========================
function toggleStaffCustomDate(val) {
  const wrap = document.getElementById('staffCustomDateWrap');
  if (wrap) wrap.style.display = (val === 'custom') ? 'block' : 'none';
  renderStaffReport();
}

function setStaffFilter(staffName) {
  const sel = document.getElementById('staffReportSelect');
  if (sel) {
    sel.value = staffName;
    renderStaffReport();
  }
}

function renderStaffReport() {
  const listEl = document.getElementById('staffReportList');
  if (!listEl) return;

  const staffSelect = document.getElementById('staffReportSelect');
  const selectedStaff = staffSelect?.value || 'Vishal Maisuria (Owner)';
  const dateFilter = document.getElementById('staffReportDateFilter')?.value || 'all';
  const customDate = document.getElementById('staffCustomDate')?.value || '';
  const searchQ = (document.getElementById('staffSearchInput')?.value || '').toLowerCase().trim();

  // Populate staff select if needed
  if (staffSelect) {
    const existingVal = staffSelect.value || 'Vishal Maisuria (Owner)';
    let opts = `
      <option value="Vishal Maisuria (Owner)">👑 Vishal Maisuria (Owner)</option>
    `;

    // Add actual staff members (excluding owner)
    const staffMembers = (state.staff || []).filter(s => !s.name.toLowerCase().includes('owner') && !s.name.toLowerCase().includes('vishal'));
    staffMembers.forEach(st => {
      opts += `<option value="${esc(st.name)}">👤 ${esc(st.name)}</option>`;
    });

    // Add any other staff found in visits
    const extraStaffNames = new Set();
    state.customers.forEach(c => (c.visits || []).forEach(v => {
      const sBy = v.service_by || 'Vishal Maisuria (Owner)';
      if (!sBy.toLowerCase().includes('owner') && !sBy.toLowerCase().includes('vishal') && !staffMembers.some(s => s.name === sBy)) {
        extraStaffNames.add(sBy);
      }
    }));
    extraStaffNames.forEach(name => {
      opts += `<option value="${esc(name)}">👤 ${esc(name)}</option>`;
    });

    opts += `<option value="combine">🤝 Combine</option>`;

    staffSelect.innerHTML = opts;
    if (Array.from(staffSelect.options).some(o => o.value === existingVal)) {
      staffSelect.value = existingVal;
    } else {
      staffSelect.value = 'Vishal Maisuria (Owner)';
    }
  }

  // Flatten all customer visits
  const allRecords = [];
  state.customers.forEach(c => {
    (c.visits || []).forEach(v => {
      allRecords.push({
        customer: c,
        visit: v,
        service_by: v.service_by || 'Vishal Maisuria (Owner)'
      });
    });
  });

  // Sort descending by date
  allRecords.sort((a, b) => (b.visit.date || '').localeCompare(a.visit.date || ''));

  const todayStr = today();
  const todayDate = new Date(todayStr + 'T00:00:00');

  // Filter records
  const filtered = allRecords.filter(item => {
    const v = item.visit;
    const c = item.customer;
    const sBy = item.service_by;

    // 1. Staff / Person Filter
    if (selectedStaff !== 'combine' && sBy !== selectedStaff) {
      return false;
    }

    // 2. Date Filter
    if (dateFilter === 'today') {
      if (v.date !== todayStr) return false;
    } else if (dateFilter === 'week') {
      const vDate = new Date(v.date + 'T00:00:00');
      const diffDays = (todayDate - vDate) / (1000 * 60 * 60 * 24);
      if (diffDays < 0 || diffDays > 7) return false;
    } else if (dateFilter === 'month') {
      if (!v.date || v.date.slice(0, 7) !== todayStr.slice(0, 7)) return false;
    } else if (dateFilter === 'custom') {
      if (customDate && v.date !== customDate) return false;
    }

    // 3. Search query
    if (searchQ) {
      const matchName = (c.name || '').toLowerCase().includes(searchQ);
      const matchMobile = (c.mobile || '').includes(searchQ);
      const matchService = (v.service || '').toLowerCase().includes(searchQ);
      const matchStaff = sBy.toLowerCase().includes(searchQ);
      if (!matchName && !matchMobile && !matchService && !matchStaff) return false;
    }

    return true;
  });

  // Calculate Summary Metrics
  const totalRevenue = filtered.reduce((sum, item) => sum + Number(item.visit.bill || 0), 0);
  const totalServices = filtered.reduce((sum, item) => {
    const sCount = (item.visit.services && item.visit.services.length) ? item.visit.services.length : 1;
    return sum + sCount;
  }, 0);
  const uniqueCustomerIds = new Set(filtered.map(item => item.customer.id));

  // Update Stats UI
  const statServ = document.getElementById('staffStatServices');
  const statRev = document.getElementById('staffStatRevenue');
  const statCust = document.getElementById('staffStatCustomers');
  const badgeCount = document.getElementById('staffServicesCountBadge');

  if (statServ) statServ.textContent = totalServices;
  if (statRev) statRev.textContent = money(totalRevenue);
  if (statCust) statCust.textContent = uniqueCustomerIds.size;
  if (badgeCount) badgeCount.textContent = `${filtered.length} Entries`;

  // Render Overview Banner for selected staff/owner
  const overviewEl = document.getElementById('staffMembersOverview');
  if (overviewEl) {
    const isCombine = selectedStaff === 'combine';
    const isOwner = selectedStaff.toLowerCase().includes('owner');
    overviewEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#f4f4f5; padding:10px 14px; border-radius:10px; margin-bottom:12px">
        <div>
          <span style="font-size:12px; color:var(--text-muted)">Viewing Services Given By:</span>
          <div style="font-size:15px; font-weight:700; margin-top:2px">
            ${isCombine ? '🤝 Combine (Owner & Staff)' : (isOwner ? '👑' : '👤') + ' ' + esc(selectedStaff)}
          </div>
        </div>
        <div style="font-size:12px; font-weight:700; color:var(--gold)">
          ${isCombine ? 'All Services' : (isOwner ? 'Salon Owner' : 'Staff Member')}
        </div>
      </div>
    `;
  }

  // Render Records List
  if (filtered.length === 0) {
    let emptyTitle = 'કોઈ Service Record મળ્યો નથી';
    const isCombine = selectedStaff === 'combine';
    let emptyMsg = searchQ 
      ? `"${esc(searchQ)}" માટે કોઈ પરિણામ નથી.` 
      : (isCombine ? 'કોઈપણ Staff કે Owner દ્વારા હજુ સુધી કોઈ Service આપવામાં આવી નથી.' : `"${esc(selectedStaff)}" દ્વારા કોઈ Service આપવામાં આવી નથી.`);

    listEl.innerHTML = `
      <div class="empty" style="padding:32px 16px; text-align:center">
        <div style="font-size:32px; margin-bottom:8px">✂️</div>
        <div style="font-weight:700; font-size:15px; color:#111">${emptyTitle}</div>
        <div style="font-size:13px; color:var(--text-muted); margin-top:6px; line-height:1.5">
          ${emptyMsg}
        </div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(item => {
    const v = item.visit;
    const c = item.customer;
    const sBy = item.service_by;
    const isOwner = sBy.toLowerCase().includes('owner');
    const due = Math.max(0, Number(v.bill || 0) - Number(v.paid || 0));

    const serviceList = (v.services && v.services.length) ? v.services : [v.service || 'Service'];
    const serviceBreakdown = serviceList.map(sName => {
      const found = state.services.find(s => (s.name || s[0])?.toLowerCase() === sName.toLowerCase());
      const p = found ? (found.price !== undefined ? found.price : found[1]) : (serviceList.length === 1 ? v.bill : Math.round(v.bill / serviceList.length));
      return `<div style="font-size:13px; font-weight:600; color:#222; padding:2px 0">✂️ ${esc(sName)} <span style="color:#666; font-weight:400; font-size:12px">(${money(p)})</span></div>`;
    }).join('');

    const vTime = fmtTime(v.time, v.created_at);
    return `
      <div class="staff-record-card">
        <div class="staff-record-top">
          <span class="staff-badge ${isOwner ? 'owner' : 'member'}">
            ${isOwner ? '👑' : '👤'} Served by: <b>${esc(sBy)}</b>
          </span>
          <span style="font-size:12px; font-weight:700; color:#555">
            📅 ${fmtSlash(v.date)}${vTime ? ' • 🕒 ' + vTime : ''}
          </span>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px">
          <div>
            <div style="font-size:15px; font-weight:700; color:#111">${esc(c.name)}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px">
              ${c.mobile ? `<a href="tel:${c.mobile}" style="color:var(--text-muted); text-decoration:none">📞 ${c.mobile}</a>` : 'No Mobile'}
            </div>
          </div>
          <div>
            ${due > 0
              ? `<span class="badge badge-pending" style="font-size:11px">⚠️ બાકી ${money(due)}</span>`
              : `<span class="badge badge-paid" style="font-size:11px">✓ Paid</span>`
            }
          </div>
        </div>

        <div style="background:#f9fafb; border-radius:8px; padding:8px 10px; margin-bottom:10px">
          ${serviceBreakdown}
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#555; border-top:1px solid #f0f0f0; padding-top:8px">
          <div>
            Bill: <b>${money(v.bill)}</b> • Paid: <b style="color:#16a34a">${money(v.paid)}</b>
          </div>
          <button class="btn-outline" style="padding:4px 10px; font-size:11px; font-weight:700" onclick="openCustomerHistoryModal('${c.id}')">
            📜 Customer History →
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ========================
// STAFF SETTINGS & MODALS
// ========================
function renderStaffSettings() {
  const listEl = document.getElementById('staffListSettings');
  if (!listEl) return;

  const staff = state.staff || [];
  if (staff.length === 0) {
    listEl.innerHTML = '<div class="empty">કોઈ Staff ઉમેરેલ નથી.</div>';
    return;
  }

  listEl.innerHTML = staff.map(s => {
    const isOwner = s.name.toLowerCase().includes('owner');
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:#f9fafb; border:1px solid #e4e4e7; border-radius:10px; margin-bottom:8px">
        <div style="display:flex; align-items:center; gap:8px">
          <span style="font-size:18px">${isOwner ? '👑' : '👤'}</span>
          <b style="font-size:14px">${esc(s.name)}</b>
        </div>
        ${!isOwner ? `
          <button class="btn-danger" style="padding:4px 10px; font-size:12px" onclick="deleteStaffMember(${s.id}, '${esc(s.name)}')">✕ Delete</button>
        ` : `<span style="font-size:11px; color:var(--text-muted); font-weight:700">Salon Owner</span>`}
      </div>
    `;
  }).join('');
}

function openStaffManageModal() {
  openModal(`
    <div class="modal-header">
      <h2 style="font-size:18px">👥 Manage Salon Staff</h2>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div style="margin-bottom:14px">
      <label>નવો Staff Member ઉમેરો (Add New Staff Name)</label>
      <div style="display:flex; gap:8px; margin-top:6px">
        <input id="newStaffNameInput" placeholder="Staff Name (e.g. Ramesh, Priya)..." style="flex:1">
        <button class="btn-gold" style="white-space:nowrap" onclick="submitNewStaff()">+ Add Staff</button>
      </div>
    </div>
    <hr style="margin:16px 0; border:0; border-top:1px solid #eee">
    <h3 style="font-size:14px; margin-bottom:10px">હાલના Staff Members</h3>
    <div id="modalStaffList">
      ${(state.staff || []).map(s => {
        const isOwner = s.name.toLowerCase().includes('owner');
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:#f9fafb; border:1px solid #e4e4e7; border-radius:8px; margin-bottom:6px">
            <div>
              <span style="font-size:16px">${isOwner ? '👑' : '👤'}</span>
              <b>${esc(s.name)}</b>
            </div>
            ${!isOwner ? `
              <button class="btn-danger" style="padding:4px 8px; font-size:11px" onclick="deleteStaffMember(${s.id}, '${esc(s.name)}')">✕ Delete</button>
            ` : '<span style="font-size:11px; color:#888">Owner</span>'}
          </div>
        `;
      }).join('')}
    </div>
  `);
}

async function submitNewStaff() {
  const input = document.getElementById('newStaffNameInput');
  const name = input ? input.value.trim() : '';
  if (!name) return alert('Staff member નું નામ લખો');

  try {
    const updated = await api('/staff', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    state.staff = updated;
    closeModal();
    renderAll();
    alert(`Staff "${name}" સફળતાપૂર્વક ઉમેરાઈ ગયો!`);
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteStaffMember(id, name) {
  if (!confirm(`શું "${name}" ને staff લિસ્ટમાંથી delete કરવા છે?`)) return;

  try {
    const updated = await api(`/staff/${id}`, {
      method: 'DELETE'
    });
    state.staff = updated;
    closeModal();
    renderAll();
    alert(`Staff "${name}" delete થઈ ગયો!`);
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ========================
// RENDER ALL
// ========================
function renderAll() {
  renderCustomers();
  renderPending();
  renderReminders();
  renderServices();
  renderCashflow();
  renderStaffReport();
  renderStaffSettings();

  // Populate Add Customer form dropdown
  const cSelect = document.getElementById('cServiceSelect');
  if (cSelect) cSelect.innerHTML = serviceOptionsHTML();

  // Update Stats
  const statCust = document.getElementById('statCustomers');
  if (statCust) statCust.textContent = state.customers.length;

  const todayVisits = state.customers.flatMap(c => c.visits || []).filter(v => v.date === today());
  const todayDue = todayVisits.reduce((sum, v) => sum + Math.max(0, Number(v.bill || 0) - Number(v.paid || 0)), 0);
  const statPending = document.getElementById('statPending');
  if (statPending) statPending.textContent = money(todayDue);

  let reminderCount = 0;
  let todayOccasionCount = 0;
  for (const c of state.customers) {
    if (c.birth) {
      const d = daysUntil(c.birth);
      if (d <= 7) {
        reminderCount++;
        if (d === 0) todayOccasionCount++;
      }
    }
    if (c.ann) {
      const d = daysUntil(c.ann);
      if (d <= 7) {
        reminderCount++;
        if (d === 0) todayOccasionCount++;
      }
    }
  }
  const statReminders = document.getElementById('statReminders');
  if (statReminders) statReminders.textContent = reminderCount;

  const navBadge = document.getElementById('navReminderBadge');
  if (navBadge) {
    if (reminderCount > 0) {
      navBadge.style.display = 'inline-block';
      navBadge.textContent = reminderCount;
      if (todayOccasionCount > 0) {
        navBadge.style.background = '#dc2626';
        navBadge.title = `${todayOccasionCount} occasion(s) today!`;
      } else {
        navBadge.style.background = '#eab308';
      }
    } else {
      navBadge.style.display = 'none';
    }
  }
}

// Kickoff
window.addEventListener('DOMContentLoaded', init);
