const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { generalLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const conversationsRoutes = require('./routes/conversations');
const roomsRoutes = require('./routes/rooms');
const postsRoutes = require('./routes/posts');
const mediaRoutes = require('./routes/media');
const pushRoutes = require('./routes/push');
const notificationsRoutes = require('./routes/notifications');
const searchRoutes = require('./routes/search');
const reportsRoutes = require('./routes/reports');

// ===== مسارات لوحة تحكم الإدارة (Admin Dashboard) — معزولة تمامًا =====
const adminAuthRoutes = require('./routes/admin/auth');
const adminUsersRoutes = require('./routes/admin/users');
const adminVerificationRoutes = require('./routes/admin/verification');
const adminStatsRoutes = require('./routes/admin/stats');
const adminModerationRoutes = require('./routes/admin/moderation');
const adminRoomsRoutes = require('./routes/admin/rooms');
const adminPostsRoutes = require('./routes/admin/posts');
const adminNotificationsRoutes = require('./routes/admin/notifications');
const adminAuditLogRoutes = require('./routes/admin/auditLog');
const adminAdminsRoutes = require('./routes/admin/admins');

function createApp() {
  const app = express();

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
  app.use(cors({ origin: allowedOrigins.includes('*') ? true : allowedOrigins }));
  app.use(helmet());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(generalLimiter);

  app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

  app.use('/auth', authRoutes);
  app.use('/users', usersRoutes);
  app.use('/conversations', conversationsRoutes);
  app.use('/rooms', roomsRoutes);
  app.use('/posts', postsRoutes);
  app.use('/media', mediaRoutes);
  app.use('/push', pushRoutes);
  app.use('/notifications', notificationsRoutes);
  app.use('/search', searchRoutes);
  app.use('/reports', reportsRoutes);

  // مسارات الإدارة كلها تحت بادئة واحدة واضحة /admin/*، كل منها محمي
  // بـ requireAdminAuth + requireRole بشكل مستقل تمامًا عن مصادقة المستخدمين.
  app.use('/admin/auth', adminAuthRoutes);
  app.use('/admin/users', adminUsersRoutes);
  app.use('/admin/verification', adminVerificationRoutes);
  app.use('/admin/stats', adminStatsRoutes);
  app.use('/admin/moderation', adminModerationRoutes);
  app.use('/admin/rooms', adminRoomsRoutes);
  app.use('/admin/posts', adminPostsRoutes);
  app.use('/admin/notifications', adminNotificationsRoutes);
  app.use('/admin/audit-log', adminAuditLogRoutes);
  app.use('/admin/admins', adminAdminsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
