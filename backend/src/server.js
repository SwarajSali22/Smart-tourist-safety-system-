require('dotenv').config();

const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);
const http = require('http');
const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/db');
const env = require('./config/env');
const { initSocket } = require('./sockets');
const { setIo } = require('./services/realtime');
const { reconcileSosState } = require('./services/sos/reconcile');
const { startSafetyCheckScheduler } = require('./jobs/safetyCheckScheduler');

async function start() {
  await connectDB();
  if (mongoose.connection.readyState === 1) try {
    const fixed = await reconcileSosState();
    if (fixed) console.log(`[sos] reconciled ${fixed} SOS event(s) with resolved incidents`);
  } catch (err) {
    console.error('[sos] reconcile failed:', err.message);
  }

  const httpServer = http.createServer(app);
  const io = initSocket(httpServer);
  app.set('io', io);
  setIo(io);
  startSafetyCheckScheduler(io);

  httpServer.listen(env.port, () => {
    console.log(
      `[server] Smart Tourist Safety backend running on port ${env.port} (${env.nodeEnv})`
    );
  });
}

start();
