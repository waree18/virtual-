#!/usr/bin/env node
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database', 'data.sqlite');
const email = process.argv[2];
if (!email) { console.error('Usage: node makeAdmin.js <email>'); process.exit(1); }
const db  = new Database(DB_PATH);
const res = db.prepare("UPDATE users SET role='admin' WHERE email=?").run(email.toLowerCase());
if (res.changes === 0) console.log('No user found: ' + email);
else console.log('✅ ' + email + ' is now an admin.');
db.close();
