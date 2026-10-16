/**
 * Holds the Socket.IO server so services/hooks can push events without
 * threading `io` through every call. Set once in server.js.
 */
let io = null;

module.exports = {
  setIo(instance) { io = instance; },
  getIo() { return io; },
  /** Emit to one user's personal room (every tab/device they have open). */
  emitToUser(userId, event, payload) {
    io?.to(`user:${userId}`).emit(event, payload);
  },
};
