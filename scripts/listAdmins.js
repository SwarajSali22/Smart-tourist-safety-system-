/**
 * Lists all admin user emails. Run from the backend workspace so its
 * node_modules (mongoose, dotenv) resolve:
 *
 *   cd backend
 *   node ../scripts/listAdmins.js
 */

const path = require('path');
const dns = require('dns');

// Some local networks' DNS resolvers can't do the SRV lookup MongoDB Atlas's
// mongodb+srv:// URI needs (fails as `querySrv ECONNREFUSED`) — same
// workaround backend/src/server.js uses.
dns.setServers(['8.8.8.8', '1.1.1.1']);

const backendRequire = require('module').createRequire(path.join(__dirname, '../backend/package.json'));

backendRequire('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
const mongoose = backendRequire('mongoose');
const connectDB = require('../backend/src/config/db');
const { User } = require('../backend/src/models');

async function main() {
  await connectDB();
  const admins = await User.find({ role: 'admin' }).select('name email createdAt');
  if (!admins.length) {
    console.log('No admin users found.');
  } else {
    admins.forEach((a) => console.log(`${a.email}  (${a.name}, created ${a.createdAt})`));
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
