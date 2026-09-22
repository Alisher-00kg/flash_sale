import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  reconnection: false,
});

socket.on('connect', () => {
  console.log('WebSocket connected:', socket.id);
});

socket.on('stock.updated', (data) => {
  console.log('stock.updated:', data);
});

socket.on('disconnect', (reason) => {
  console.log('WebSocket disconnected:', reason);
});

socket.on('connect_error', (error) => {
  console.error('WebSocket connection error:', error.message);
});
