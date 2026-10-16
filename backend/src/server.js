require('dotenv').config();

const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);
const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const env = require('./config/env');
const { initSocket } = require('./sockets');
const { startSafetyCheckScheduler } = require('./jobs/safetyCheckScheduler');

async function start() {
  await connectDB();

  const httpServer = http.createServer(app);
  const io = initSocket(httpServer);
  app.set('io', io);
  startSafetyCheckScheduler(io);

  httpServer.listen(env.port, () => {
    console.log(
      `[server] Smart Tourist Safety backend running on port ${env.port} (${env.nodeEnv})`
    );
  });
}

start();
