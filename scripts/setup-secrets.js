// Siapkan DASH_PASS_HASH + SESSION_SECRET untuk Vercel tanpa menampilkan nilainya.
// Pakai:  node scripts/setup-secrets.js   → ketik password (tidak terlihat) 2x → hasil tersalin ke clipboard.
const readline = require('readline');
const crypto = require('crypto');
const { execSync } = require('child_process');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let showNext = false;
rl._writeToOutput = s => { if (showNext) { rl.output.write(s); showNext = false; } }; // tampilkan prompt saja, sembunyikan ketikan
const queue = [], waiters = [];
rl.on('line', l => { const w = waiters.shift(); if (w) w(l); else queue.push(l); });
function askHidden(question) {
  showNext = true; rl.output.write(question); showNext = false;
  return new Promise(resolve => {
    const done = a => { process.stdout.write('\n'); resolve(a); };
    if (queue.length) done(queue.shift()); else waiters.push(done);
  });
}

(async () => {
  const p1 = await askHidden('Ketik password baru (min 12 karakter, tidak terlihat): ');
  if (p1.length < 12) { console.log('✗ Password kurang dari 12 karakter. Jalankan lagi.'); rl.close(); process.exit(1); }
  const p2 = await askHidden('Ketik ulang password yang sama: ');
  if (p1 !== p2) { console.log('✗ Password tidak sama. Jalankan lagi.'); rl.close(); process.exit(1); }
  rl.close();
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(p1, salt, 32);
  const text = `DASH_PASS_HASH=scrypt$${salt.toString('hex')}$${hash.toString('hex')}\nSESSION_SECRET=${crypto.randomBytes(32).toString('hex')}\n`;
  try { execSync('pbcopy', { input: text }); }
  catch { console.log('✗ Gagal menyalin ke clipboard (pbcopy tidak ada).'); process.exit(1); }
  console.log('✓ Berhasil. 2 variabel (DASH_PASS_HASH & SESSION_SECRET) sudah tersalin ke clipboard.');
  console.log('  Tempel (Cmd+V) di kolom Key pada Vercel → Environment Variables.');
})();
