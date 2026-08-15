require('dotenv').config();

const http = require('http');
const { createApp } = require('./app');
const { attachRealtimeServer } = require('./ws/realtimeServer');

const PORT = process.env.PORT || 8080;

const app = createApp();
const server = http.createServer(app);

// ربط WebSocket
attachRealtimeServer(server);

// تشغيل HTTP Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`NovaChat backend running on port ${PORT}`);
});
