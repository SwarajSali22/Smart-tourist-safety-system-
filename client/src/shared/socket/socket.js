import { io } from 'socket.io-client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');

let socket = null;

export function connectSocket(accessToken) {
  if (socket) return socket;
  socket = io(SOCKET_URL, { auth: { token: accessToken } });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export function getSocket() {
  return socket;
}
