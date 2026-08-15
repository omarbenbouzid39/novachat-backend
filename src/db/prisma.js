const { PrismaClient } = require('@prisma/client');

// نسخة واحدة (Singleton) من عميل Prisma تُستخدم عبر كل مسارات الـ API.
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
