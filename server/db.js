const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'salon.db');
const db = new DatabaseSync(dbPath);

// Enable foreign keys and WAL mode
db.exec('PRAGMA foreign_keys = ON;');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mobile TEXT DEFAULT '',
    birth TEXT DEFAULT '',
    ann TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS visits (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    date TEXT NOT NULL,
    service TEXT NOT NULL,
    services_json TEXT DEFAULT '[]',
    bill REAL NOT NULL DEFAULT 0,
    paid REAL NOT NULL DEFAULT 0,
    service_by TEXT DEFAULT 'Vishal Maisuria (Owner)',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cashflows (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration for existing databases that might not have service_by column
try {
  db.exec("ALTER TABLE visits ADD COLUMN service_by TEXT DEFAULT 'Vishal Maisuria (Owner)';");
} catch (e) {
  // Column already exists
}

// Migration for time column in visits and cashflows
try {
  db.exec("ALTER TABLE visits ADD COLUMN time TEXT DEFAULT '';");
} catch (e) {
  // Column already exists
}

try {
  db.exec("ALTER TABLE cashflows ADD COLUMN time TEXT DEFAULT '';");
} catch (e) {
  // Column already exists
}

// Seed default staff
const staffCountStmt = db.prepare('SELECT COUNT(*) as count FROM staff');
const { count: staffCount } = staffCountStmt.get();
if (staffCount === 0) {
  const insertStaff = db.prepare('INSERT OR IGNORE INTO staff (name) VALUES (?)');
  insertStaff.run('Vishal Maisuria (Owner)');
}

// Default salon services list
const defaultServices = [
  ["Shaving", 50], ["Haircut", 120], ["Hair Wax Set", 50],
  ["Hair Wash", 200], ["Hair Cut Women", 400], ["Blow Dry Style", 250],
  ["Blow Dry Style (Long)", 300], ["T-Straightening", 400], ["T-Curls", 500],
  ["Matrix (Men Colour)", 300], ["Loreal (Men Colour)", 400], ["Highlights (Men)", 600],
  ["Matrix Root Touch up", 600], ["Loreal Root Touch up", 700], ["Matrix Global", 900],
  ["Loreal Global", 1000], ["Highlights (Women)", 2000],
  ["Keratin", 1200], ["Keratin (Long)", 2000], ["Straightening", 1500], ["Straightening (Long)", 2500],
  ["D-Tan", 200], ["Clean Up", 300], ["Beardo Facial", 900], ["Le Bonheur", 1000],
  ["Netursh Facial", 1200], ["Lotus Facial", 1500], ["O3+ Facial", 1800], ["Real Aroma Kit", 800],
  ["Advanced GOLD kit", 1000], ["PRO + Lacto-Protein Kit", 1200], ["PRO + VITA-C Derma Kit", 1200],
  ["GWANG GL Pulp Kit", 1400], ["Oil Massage", 150], ["Oil Massage (Long)", 250],
  ["Matrix Spa", 400], ["Matrix Spa (Long)", 600], ["Loreal Spa", 500], ["Loreal Spa (Long)", 700],
  ["Wella Spa", 600], ["Wella Spa (Long)", 900], ["Hair Growth Spa", 700]
];

// Seed services if table is empty
const countStmt = db.prepare('SELECT COUNT(*) as count FROM services');
const { count } = countStmt.get();
if (count === 0) {
  const insertService = db.prepare('INSERT INTO services (name, price) VALUES (?, ?)');
  for (const [name, price] of defaultServices) {
    insertService.run(name, price);
  }
}

module.exports = db;

