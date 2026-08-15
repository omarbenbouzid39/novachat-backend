require('dotenv').config();

const http = require('http');
const { createApp } = require('./app');
const { attachRealtimeServer } = require('./ws/realtimeServer');

const PORT = process.env.PORT || 8080;

const app = createApp();
const server = http.createServer(app);

// ربط WebSocket بنفس خادم HTTP (نفس المنفذ، مسار /ws) وإتاحته لمسارات
// REST عبر app.locals.realtime حتى تبث الأحداث اللحظية عند إرسال رسالة.
const realtime = attachRealtimeServer(server);
app.locals.realtime = realtime;

server.listen(PORT, () => {
  console.log(`✅ NovaChat backend يعمل على المنفذ ${PORT} (${process.env.NODE_ENV || 'development'})`);
  console.log(`   REST:      http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
