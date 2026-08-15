const { authenticator } = require('otplib');
const QRCode = require('qrcode');

function generateSecret() {
  return authenticator.generateSecret();
}

function getOtpAuthUrl(secret, email) {
  return authenticator.keyuri(email, 'Samar Admin', secret);
}

async function getQrCodeDataUrl(otpAuthUrl) {
  return QRCode.toDataURL(otpAuthUrl);
}

function verifyToken(secret, token) {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

module.exports = { generateSecret, getOtpAuthUrl, getQrCodeDataUrl, verifyToken };
