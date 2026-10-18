const express = require('express');
const cors = require('cors');
const path = require('node:path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ========================
// SERVICES API
// ========================
app.get('/api/services', (req, res) => {
  try {
    const stmt = db.prepare('SELECT id, name, price FROM services ORDER BY id ASC');
    const rows = stmt.all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/services', (req, res) => {
  try {
    const { name, price } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Service name is required' });
    }
    const stmt = db.prepare('INSERT INTO services (name, price) VALUES (?, ?)');
    const result = stmt.run(name.trim(), Number(price || 0));
    res.json({ id: result.lastInsertRowid, name: name.trim(), price: Number(price || 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/services/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, price } = req.body;
    const stmt = db.prepare('UPDATE services SET name = ?, price = ? WHERE id = ?');
    stmt.run(name.trim(), Number(price || 0), id);
    res.json({ id: Number(id), name: name.trim(), price: Number(price || 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/services/:id', (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare('DELETE FROM services WHERE id = ?');
    stmt.run(id);
    res.json({ success: true, deletedId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/services/sync', (req, res) => {
  try {
    const { services } = req.body;
    if (!Array.isArray(services)) {
      return res.status(400).json({ error: 'Services array expected' });
    }
    db.exec('BEGIN TRANSACTION;');
    db.exec('DELETE FROM services;');
    const insertStmt = db.prepare('INSERT INTO services (name, price) VALUES (?, ?)');
    for (const s of services) {
      const name = Array.isArray(s) ? s[0] : s.name;
      const price = Array.isArray(s) ? s[1] : s.price;
      if (name && name.trim()) {
        insertStmt.run(name.trim(), Number(price || 0));
      }
    }
    db.exec('COMMIT;');
    const rows = db.prepare('SELECT id, name, price FROM services ORDER BY id ASC').all();
    res.json(rows);
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: err.message });
  }
});

// ========================
// CUSTOMERS & VISITS API
// ========================
app.get('/api/customers', (req, res) => {
  try {
    const customers = db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all();
    const visits = db.prepare('SELECT * FROM visits ORDER BY date DESC, created_at DESC').all();

    // Map visits to each customer
    const visitsByCustomer = {};
    for (const v of visits) {
      if (!visitsByCustomer[v.customer_id]) {
        visitsByCustomer[v.customer_id] = [];
      }
      visitsByCustomer[v.customer_id].push({
        id: v.id,
        date: v.date,
        time: v.time || (v.created_at ? v.created_at.slice(11, 16) : ''),
        created_at: v.created_at,
        service: v.service,
        services: JSON.parse(v.services_json || '[]'),
        bill: Number(v.bill || 0),
        paid: Number(v.paid || 0),
        due: Math.max(0, Number(v.bill || 0) - Number(v.paid || 0)),
        service_by: v.service_by || 'Vishal Maisuria (Owner)'
      });
    }

    const result = customers.map(c => {
      const cVisits = visitsByCustomer[c.id] || [];
      const totalBill = cVisits.reduce((acc, v) => acc + v.bill, 0);
      const totalPaid = cVisits.reduce((acc, v) => acc + v.paid, 0);
      const totalDue = Math.max(0, totalBill - totalPaid);
      return {
        ...c,
        visits: cVisits,
        totalBill,
        totalPaid,
        totalDue
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/customers', (req, res) => {
  try {
    const { name, mobile, birth, ann, visit } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Customer name is required' });
    }

    const customerId = uid();
    const insertCustomer = db.prepare(`
      INSERT INTO customers (id, name, mobile, birth, ann)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertCustomer.run(customerId, name.trim(), mobile ? mobile.trim() : '', birth || '', ann || '');

    let addedVisit = null;
    if (visit && (visit.services?.length || visit.bill > 0 || visit.paid > 0)) {
      const visitId = uid();
      const insertVisit = db.prepare(`
        INSERT INTO visits (id, customer_id, date, time, service, services_json, bill, paid, service_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const serviceNames = (visit.services || []).join(', ') || visit.service || 'Service';
      const serviceBy = (visit.service_by && visit.service_by.trim()) ? visit.service_by.trim() : 'Vishal Maisuria (Owner)';
      const visitTime = (visit.time && visit.time.trim()) ? visit.time.trim() : new Date().toTimeString().slice(0, 5);

      insertVisit.run(
        visitId,
        customerId,
        visit.date || today(),
        visitTime,
        serviceNames,
        JSON.stringify(visit.services || []),
        Number(visit.bill || 0),
        Number(visit.paid || 0),
        serviceBy
      );
      addedVisit = {
        id: visitId,
        customer_id: customerId,
        date: visit.date || today(),
        time: visitTime,
        service: serviceNames,
        services: visit.services || [],
        bill: Number(visit.bill || 0),
        paid: Number(visit.paid || 0),
        service_by: serviceBy
      };
    }

    res.json({
      id: customerId,
      name: name.trim(),
      mobile: mobile ? mobile.trim() : '',
      birth: birth || '',
      ann: ann || '',
      visits: addedVisit ? [addedVisit] : []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/customers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, mobile, birth, ann } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Customer name is required' });
    }
    const stmt = db.prepare(`
      UPDATE customers
      SET name = ?, mobile = ?, birth = ?, ann = ?
      WHERE id = ?
    `);
    stmt.run(name.trim(), mobile ? mobile.trim() : '', birth || '', ann || '', id);
    res.json({ id, name: name.trim(), mobile: mobile ? mobile.trim() : '', birth: birth || '', ann: ann || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/customers/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM visits WHERE customer_id = ?').run(id);
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    res.json({ success: true, deletedId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a visit to customer
app.post('/api/customers/:id/visits', (req, res) => {
  try {
    const { id } = req.params;
    const { date, time, service, services, bill, paid, service_by } = req.body;
    const visitId = uid();
    const serviceNames = (services && services.length) ? services.join(', ') : (service || 'Service');
    const serviceBy = (service_by && service_by.trim()) ? service_by.trim() : 'Vishal Maisuria (Owner)';
    const visitTime = (time && time.trim()) ? time.trim() : new Date().toTimeString().slice(0, 5);

    const stmt = db.prepare(`
      INSERT INTO visits (id, customer_id, date, time, service, services_json, bill, paid, service_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      visitId,
      id,
      date || today(),
      visitTime,
      serviceNames,
      JSON.stringify(services || []),
      Number(bill || 0),
      Number(paid || 0),
      serviceBy
    );

    res.json({
      id: visitId,
      customer_id: id,
      date: date || today(),
      time: visitTime,
      service: serviceNames,
      services: services || [],
      bill: Number(bill || 0),
      paid: Number(paid || 0),
      service_by: serviceBy
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// STAFF API
// ========================
app.get('/api/staff', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM staff ORDER BY id ASC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/staff', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Staff name is required' });
    }
    const stmt = db.prepare('INSERT OR IGNORE INTO staff (name) VALUES (?)');
    stmt.run(name.trim());
    const all = db.prepare('SELECT * FROM staff ORDER BY id ASC').all();
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/staff/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM staff WHERE id = ?').run(id);
    const all = db.prepare('SELECT * FROM staff ORDER BY id ASC').all();
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pay towards pending visit
app.post('/api/customers/:cid/visits/:vid/pay', (req, res) => {
  try {
    const { cid, vid } = req.params;
    const { amount } = req.body;
    const payment = Number(amount || 0);

    const visit = db.prepare('SELECT * FROM visits WHERE id = ? AND customer_id = ?').get(vid, cid);
    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }

    const currentPaid = Number(visit.paid || 0);
    const newPaid = currentPaid + payment;
    db.prepare('UPDATE visits SET paid = ? WHERE id = ?').run(newPaid, vid);

    res.json({
      success: true,
      visitId: vid,
      bill: Number(visit.bill),
      oldPaid: currentPaid,
      newPaid: newPaid,
      due: Math.max(0, Number(visit.bill) - newPaid)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// CASHFLOW (આવક - જાવક)
// ========================
app.get('/api/cashflows', (req, res) => {
  try {
    const { date } = req.query;
    let rawRows;
    if (date) {
      rawRows = db.prepare('SELECT * FROM cashflows WHERE date = ? ORDER BY created_at DESC').all(date);
    } else {
      rawRows = db.prepare('SELECT * FROM cashflows ORDER BY date DESC, created_at DESC').all();
    }
    const rows = rawRows.map(c => ({
      ...c,
      time: c.time || (c.created_at ? c.created_at.slice(11, 16) : '')
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cashflows', (req, res) => {
  try {
    const { date, time, type, amount, note } = req.body;
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }
    const id = uid();
    const cfTime = (time && time.trim()) ? time.trim() : new Date().toTimeString().slice(0, 5);
    const stmt = db.prepare(`
      INSERT INTO cashflows (id, date, time, type, amount, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      date || today(),
      cfTime,
      type === 'expense' ? 'expense' : 'income',
      Number(amount),
      note ? note.trim() : ''
    );
    res.json({ id, date: date || today(), time: cfTime, type, amount: Number(amount), note: note || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cashflows/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM cashflows WHERE id = ?').run(id);
    res.json({ success: true, deletedId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// STATS & DASHBOARD
// ========================
app.get('/api/stats', (req, res) => {
  try {
    const t = today();
    const custCount = db.prepare('SELECT COUNT(*) as count FROM customers').get().count;

    // Today's pending amount
    const visits = db.prepare('SELECT bill, paid FROM visits WHERE date = ?').all(t);
    const todayPending = visits.reduce((acc, v) => acc + Math.max(0, Number(v.bill || 0) - Number(v.paid || 0)), 0);

    // Reminders in upcoming 7 days
    const allCustomers = db.prepare('SELECT id, name, birth, ann FROM customers').all();
    let remindersCount = 0;
    const now = new Date();
    const currentYear = now.getFullYear();

    for (const c of allCustomers) {
      if (c.birth) {
        const parts = c.birth.split('-');
        if (parts.length >= 2) {
          const m = Number(parts[parts.length - 2]);
          const d = Number(parts[parts.length - 1]);
          let target = new Date(currentYear, m - 1, d);
          target.setHours(0, 0, 0, 0);
          now.setHours(0, 0, 0, 0);
          if (target < now) target.setFullYear(currentYear + 1);
          const days = Math.round((target - now) / 86400000);
          if (days <= 7) remindersCount++;
        }
      }
      if (c.ann) {
        const parts = c.ann.split('-');
        if (parts.length >= 2) {
          const m = Number(parts[parts.length - 2]);
          const d = Number(parts[parts.length - 1]);
          let target = new Date(currentYear, m - 1, d);
          target.setHours(0, 0, 0, 0);
          now.setHours(0, 0, 0, 0);
          if (target < now) target.setFullYear(currentYear + 1);
          const days = Math.round((target - now) / 86400000);
          if (days <= 7) remindersCount++;
        }
      }
    }

    res.json({
      customersCount: custCount,
      todayPending,
      remindersCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// BACKUP / RESTORE API
// ========================
app.get('/api/export', (req, res) => {
  try {
    const services = db.prepare('SELECT name, price FROM services').all();
    const customers = db.prepare('SELECT * FROM customers').all();
    const visits = db.prepare('SELECT * FROM visits').all();
    const cashflows = db.prepare('SELECT * FROM cashflows').all();
    const staff = db.prepare('SELECT * FROM staff').all();

    const formattedCustomers = customers.map(c => ({
      ...c,
      visits: visits.filter(v => v.customer_id === c.id).map(v => ({
        id: v.id,
        date: v.date,
        service: v.service,
        services: JSON.parse(v.services_json || '[]'),
        bill: Number(v.bill),
        paid: Number(v.paid),
        service_by: v.service_by || 'Vishal Maisuria (Owner)'
      }))
    }));

    res.json({
      services: services.map(s => [s.name, s.price]),
      customers: formattedCustomers,
      cashflows,
      staff
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/import', (req, res) => {
  try {
    const { customers, services, cashflows, staff } = req.body;
    db.exec('BEGIN TRANSACTION;');

    if (Array.isArray(services) && services.length) {
      db.exec('DELETE FROM services;');
      const insertService = db.prepare('INSERT INTO services (name, price) VALUES (?, ?)');
      for (const s of services) {
        const name = Array.isArray(s) ? s[0] : s.name;
        const price = Array.isArray(s) ? s[1] : s.price;
        if (name) insertService.run(name, Number(price || 0));
      }
    }

    if (Array.isArray(staff) && staff.length) {
      db.exec('DELETE FROM staff;');
      const insertStaff = db.prepare('INSERT INTO staff (name) VALUES (?)');
      for (const st of staff) {
        const name = typeof st === 'string' ? st : st.name;
        if (name && name.trim()) insertStaff.run(name.trim());
      }
    }

    if (Array.isArray(customers) && customers.length) {
      db.exec('DELETE FROM visits;');
      db.exec('DELETE FROM customers;');
      const insertCust = db.prepare('INSERT INTO customers (id, name, mobile, birth, ann) VALUES (?, ?, ?, ?, ?)');
      const insertVisit = db.prepare('INSERT INTO visits (id, customer_id, date, service, services_json, bill, paid, service_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

      for (const c of customers) {
        const cid = c.id || uid();
        insertCust.run(cid, c.name, c.mobile || '', c.birth || '', c.ann || '');
        if (Array.isArray(c.visits)) {
          for (const v of c.visits) {
            insertVisit.run(
              v.id || uid(),
              cid,
              v.date || today(),
              v.service || 'Service',
              JSON.stringify(v.services || []),
              Number(v.bill || 0),
              Number(v.paid || 0),
              v.service_by || 'Vishal Maisuria (Owner)'
            );
          }
        }
      }
    }

    if (Array.isArray(cashflows) && cashflows.length) {
      db.exec('DELETE FROM cashflows;');
      const insertCash = db.prepare('INSERT INTO cashflows (id, date, type, amount, note) VALUES (?, ?, ?, ?, ?)');
      for (const cf of cashflows) {
        insertCash.run(cf.id || uid(), cf.date || today(), cf.type, Number(cf.amount || 0), cf.note || '');
      }
    }

    db.exec('COMMIT;');
    res.json({ success: true, message: 'Data imported successfully' });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: err.message });
  }
});

// Fallback to index.html for SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Salon Application Server running on http://localhost:${PORT}`);
});
