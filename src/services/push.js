const fs = require('fs');
const path = require('path');

let firebaseApp = null;

/**
 * تهيئة كسولة (Lazy) لـ Firebase Admin — لا تُهيَّأ إلا عند أول استخدام
 * فعلي، حتى لا يفشل تشغيل الخادم بالكامل إن لم يُضف Service Account بعد
 * أثناء التطوير المبكر.
 */
function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;

  const admin = require('firebase-admin');
  const credentialPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!credentialPath || !fs.existsSync(path.resolve(credentialPath))) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_PATH غير معرّف أو الملف غير موجود. أضف ملف Service Account من Firebase Console لتفعيل Push.'
    );
  }

  const serviceAccount = require(path.resolve(credentialPath));
  firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return firebaseApp;
}

/**
 * يرسل إشعار Push لعدة أجهزة (Multicast) دفعة واحدة. يُستدعى من مسارات
 * الرسائل/الإعجابات/المتابعة عند إنشاء حدث يستحق إشعارًا.
 */
async function sendPushToTokens(tokens, { title, body, data = {} }) {
  if (!tokens || tokens.length === 0) return { successCount: 0, failureCount: 0 };

  const admin = require('firebase-admin');
  getFirebaseApp();

  const message = {
    tokens,
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    android: { priority: 'high', notification: { channelId: 'channel_messages' } },
  };

  const response = await admin.messaging().sendEachForMulticast(message);
  return { successCount: response.successCount, failureCount: response.failureCount };
}

module.exports = { sendPushToTokens };
