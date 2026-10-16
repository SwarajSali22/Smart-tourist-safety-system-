/**
 * One-off script to create an admin user. Run from the backend workspace so
 * its node_modules (mongoose, bcryptjs, dotenv) resolve:
 *
 *   cd backend
 *   node ../scripts/seedAdmin.js --name "Admin Name" --email admin@example.com --password "..."
 */

const path = require('path');
const dns = require('dns');

// Some local networks' DNS resolvers can't do the SRV lookup MongoDB Atlas's
// mongodb+srv:// URI needs (fails as `querySrv ECONNREFUSED`) — same
// workaround backend/src/server.js uses.
dns.setServers(['8.8.8.8', '1.1.1.1']);

// scripts/ has no node_modules of its own — resolve dependencies through
// backend/'s, since that's where dotenv/mongoose/bcryptjs are installed.
const backendRequire = require('module').createRequire(path.join(__dirname, '../backend/package.json'));

backendRequire('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
const mongoose = backendRequire('mongoose');
const connectDB = require('../backend/src/config/db');
const { User } = require('../backend/src/models');
const { hashPassword } = require('../backend/src/services/auth.service');

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  return args;
}

async function main() {
  const { name, email, password } = parseArgs();
  if (!name || !email || !password) {
    console.error('Usage: node scripts/seedAdmin.js --name "..." --email "..." --password "..."');
    process.exit(1);
  }

  await connectDB();

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    console.error(`User with email ${email} already exists (role: ${existing.role}).`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const admin = await User.create({ name, email, passwordHash, role: 'admin' });

  console.log(`Admin created: ${admin.email} (${admin._id})`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
