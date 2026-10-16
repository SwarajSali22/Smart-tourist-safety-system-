const { Server } = require('socket.io');
const env = require('../config/env');
const { verifyAccessToken } = require('../services/auth.service');

/**
 * Admin sockets join the 'admin' room (broadcast target for anything an
 * admin dashboard cares about). Tourist sockets join a room keyed to their
 * own user id, so device/geofence events can be scoped to just them.
 */
function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigin, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      const payload = verifyAccessToken(token);
      socket.data.user = { id: payload.sub, role: payload.role };
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    // Rooms are chosen here, server-side, from the verified token — clients can't join others.
    const { id, role } = socket.data.user;
    if (role === 'admin') socket.join('admin');
    if (role === 'responder') socket.join('responder');
    socket.join(`tourist:${id}`); // legacy per-tourist room (location/SOS/check-in events)
    socket.join(`user:${id}`);    // personal room: persistent notifications
  });

  return io;
}

module.exports = { initSocket };
