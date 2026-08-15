const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * يولّد توقيعًا (Signature) مؤقتًا وآمنًا للرفع المباشر من تطبيق Android
 * إلى Cloudinary، دون أن يمر الملف عبر خادمنا (أسرع وأقل استهلاكًا
 * للـ Bandwidth)، ودون كشف الـ API Secret للعميل مطلقًا.
 *
 * يطبّق Cloudinary تلقائيًا عند الرفع بهذه الخيارات: ضغط ذكي (quality:auto)،
 * تحويل صيغة تلقائي (fetch_format:auto -> WebP/AVIF)، وتنظيف الميتاداتا.
 */
function generateUploadSignature({ folder, resourceType }) {
  const timestamp = Math.round(Date.now() / 1000);

  const paramsToSign = {
    timestamp,
    folder: folder || 'novachat',
    quality: 'auto',
    fetch_format: 'auto',
  };

  const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);

  return {
    timestamp,
    signature,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    folder: paramsToSign.folder,
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/${resourceType || 'auto'}/upload`,
  };
}

module.exports = { generateUploadSignature };
