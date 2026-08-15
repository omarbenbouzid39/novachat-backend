require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * ينشئ أول حساب Super Admin من متغيرات البيئة (SUPER_ADMIN_EMAIL/PASSWORD/NAME)
 * — يُشغَّل مرة واحدة فقط بعد أول ترحيل لقاعدة البيانات:
 *   npm run seed
 */
async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const displayName = process.env.SUPER_ADMIN_NAME || 'المدير العام';

  if (!email || !password) {
    console.error('❌ SUPER_ADMIN_EMAIL و SUPER_ADMIN_PASSWORD مطلوبان في .env');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('❌ SUPER_ADMIN_PASSWORD يجب أن تكون 10 أحرف على الأقل');
    process.exit(1);
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`ℹ️  يوجد حساب إداري بالفعل بالبريد ${email} — لن يُنشأ حساب جديد.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.adminUser.create({
    data: { email, passwordHash, displayName, role: 'SUPER_ADMIN' },
  });

  console.log('✅ تم إنشاء حساب Super Admin بنجاح:');
  console.log(`   البريد: ${admin.email}`);
  console.log('   ⚠️  سجّل الدخول الآن وفعّل 2FA فورًا من لوحة التحكم (Settings → الأمان).');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
