// Buat nilai DASH_PASS_HASH:  node scripts/hash-password.js 'password-baru'
const crypto = require('crypto');
const pass = process.argv[2];
if (!pass || pass.length < 12) { console.error('Pakai password minimal 12 karakter.'); process.exit(1); }
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(pass, salt, 32);
console.log(`scrypt$${salt.toString('hex')}$${hash.toString('hex')}`);
