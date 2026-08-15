# NovaChat Backend

خادم Production حقيقي لتطبيق NovaChat: REST API + WebSocket Realtime +
توقيع رفع Cloudinary + Push عبر Firebase Cloud Messaging، مبني بـ
Node.js/Express وPrisma ORM فوق PostgreSQL.

## 1. التشغيل محليًا (خطوة بخطوة)

```bash
# 1) شغّل قاعدة بيانات PostgreSQL محليًا عبر Docker (أو استخدم قاعدة بيانات سحابية جاهزة)
docker compose up -d          # من المجلد الجذري للمشروع (وليس backend/)

# 2) داخل مجلد backend
cd backend
cp .env.example .env          # ثم عدّل القيم داخل .env (خصوصًا JWT secrets)
npm install
npm run prisma:migrate:dev    # ينشئ الجداول في قاعدة البيانات
npm run dev                   # يشغّل الخادم على http://localhost:8080
```

تحقق من عمل الخادم: `curl http://localhost:8080/health`

## 2. توليد أسرار JWT قوية

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

نفّذها مرتين وضع الناتج في `JWT_ACCESS_SECRET` و`JWT_REFRESH_SECRET` — **لا
تستخدم نفس القيمة للاثنين، ولا تستخدم القيم الافتراضية في `.env.example`
في أي بيئة إنتاج حقيقية.**

## 3. ربط Cloudinary (رفع الوسائط)

1. أنشئ حسابًا مجانيًا على [cloudinary.com](https://cloudinary.com)
2. من الـ Dashboard انسخ: `Cloud Name`, `API Key`, `API Secret`
3. ضعها في `.env` (`CLOUDINARY_*`)

التطبيق يرفع الوسائط مباشرة من جهاز المستخدم إلى Cloudinary (توقيع آمن من
هذا الخادم عبر `/media/sign`)، والخادم لا يخزّن أي ملف وسائط بنفسه.

## 4. ربط Firebase Cloud Messaging (Push)

1. أنشئ مشروع Firebase على [console.firebase.google.com](https://console.firebase.google.com)
2. Project Settings > Service Accounts > Generate New Private Key
3. احفظ الملف الناتج باسم `firebase-service-account.json` داخل مجلد `backend/`
   (هذا الملف **لا يُرفع لأي مستودع Git عام** — مضاف في `.gitignore`)
4. حمّل نفس مشروع Firebase على تطبيق Android (`google-services.json`)

## 5. النشر على بيئة إنتاج حقيقية

خيارات جاهزة وسريعة (تدعم Node.js + PostgreSQL مُدارة):

- **Railway** / **Render**: اربط المستودع، أضف متغيرات البيئة من `.env.example`،
  فعّل قاعدة بيانات PostgreSQL المُدارة من نفس المنصة، ثم شغّل
  `npm run prisma:migrate deploy` كخطوة Build/Release.
- **Docker على أي VPS**: `docker build -t novachat-backend .` ثم شغّله خلف
  Nginx/Caddy مع شهادة TLS (Let's Encrypt) — **إلزامي** لأن تطبيق Android
  يرفض الاتصال غير المشفّر افتراضيًا (`network_security_config.xml`).
- **Supabase/Neon/RDS** لقاعدة البيانات إن لم ترغب بإدارتها بنفسك.

بعد النشر، حدّث في تطبيق Android (`local.properties`):

```
NOVACHAT_BASE_URL=https://api.yourdomain.com/
NOVACHAT_WS_URL=wss://api.yourdomain.com/ws
```

## 6. الأمان المُطبّق افتراضيًا

- كلمات المرور مُشفّرة عبر `bcrypt` (12 rounds)
- JWT قصير العمر (Access 15 دقيقة) + Refresh Token طويل مع **تدوير كامل**
  (كل تحديث يُبطل التوكن القديم ويصدر جديدًا) ومخزّن في قاعدة البيانات
  ليمكن إبطاله فوريًا (Logout all devices)
- `helmet` لهيدرز أمان HTTP القياسية
- Rate limiting عام + أشد صرامة على مسارات المصادقة (منع Brute-force)
- توقيع Cloudinary مؤقت الصلاحية بدل كشف الـ API Secret للعميل
- كل مدخلات المصادقة تُتحقق منها عبر `zod` قبل الوصول لقاعدة البيانات

## 7. البنية

```
backend/
├── prisma/schema.prisma   # مخطط قاعدة البيانات الكامل
├── src/
│   ├── app.js               # تجميع Express + Middlewares + Routes
│   ├── server.js            # نقطة التشغيل (HTTP + WebSocket)
│   ├── db/prisma.js         # عميل Prisma (Singleton)
│   ├── middleware/          # auth, errorHandler, rateLimiter
│   ├── routes/               # auth, users, conversations, rooms, posts, media, push, notifications, search
│   ├── services/             # cloudinary, push (Firebase Admin)
│   └── ws/realtimeServer.js  # خادم WebSocket (بروتوكول JSON خفيف)
├── Dockerfile
└── .env.example
```
