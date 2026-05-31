const express = require('express');
const nodemailer = require('nodemailer');
const http = require('http');
const https = require('https');

const app = express();

// baca body req, coba parse json dulu, kalau gagal coba urlencoded
app.use((req, res, next) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try { req.body = JSON.parse(raw); }
    catch (e) {
      try { req.body = Object.fromEntries(new URLSearchParams(raw).entries()); }
      catch (e2) { req.body = {}; }
    }
    next();
  });
});

// config utama, ganti kalau perlu
const CONFIG = {
  EMAIL_USER: 'xrcivxofficial@gmail.com',
  EMAIL_PASS: 'wcxr nzfe ojed cqtn',
  PORT: process.env.PORT || 3000,
  API_KEYS: ['xrcivxofficial22'],
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
};

// allow semua origin biar bisa dipanggil dari luar
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// kode warna terminal biar log keliatan rapi
const c = {
  reset:'\x1b[0m',dim:'\x1b[2m',bold:'\x1b[1m',
  green:'\x1b[32m',red:'\x1b[31m',yellow:'\x1b[33m',
  cyan:'\x1b[36m',gray:'\x1b[90m',white:'\x1b[97m',
};

// ambil waktu sekarang buat prefix log
function ts() { return new Date().toISOString().replace('T',' ').split('.')[0]; }

// cetak log ke console dengan level dan data opsional
function log(level, msg, data=null) {
  const prefix = {
    info:`${c.cyan}${c.bold}  INFO ${c.reset}`,
    ok:`${c.green}${c.bold}    OK ${c.reset}`,
    error:`${c.red}${c.bold} ERROR ${c.reset}`,
    warn:`${c.yellow}${c.bold}  WARN ${c.reset}`,
    req:`${c.gray}${c.bold}   REQ ${c.reset}`,
  }[level];
  console.log(`${c.dim}${ts()}${c.reset} ${prefix} ${msg}`);
  if (data) JSON.stringify(data,null,2).split('\n').forEach(l=>console.log(`         ${c.gray}│${c.reset}  ${l}`));
}

// log tiap request masuk, catat method, path, status, durasi
app.use((req,res,next)=>{
  const start=Date.now();
  res.on('finish',()=>{
    const sc=res.statusCode<400?c.green:c.red;
    log('req',`${c.bold}${req.method}${c.reset} ${req.path} → ${sc}${res.statusCode}${c.reset} ${c.dim}(${Date.now()-start}ms)${c.reset}`);
  });
  next();
});

// cek api key dari header atau query, tolak kalau gak ada
function auth(req,res,next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key||!CONFIG.API_KEYS.includes(key)) {
    log('warn',`Unauthorized from ${req.ip}`);
    return res.status(401).json({success:false,error:'Unauthorized'});
  }
  next();
}

// setup smtp gmail pakai nodemailer
const transporter = nodemailer.createTransport({
  host:'smtp.gmail.com',port:587,secure:false,
  auth:{user:CONFIG.EMAIL_USER,pass:CONFIG.EMAIL_PASS},
  tls:{rejectUnauthorized:false},
});

// helper buat GET request biasa, otomatis pilih http/https
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve(raw));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// kirim email, butuh to dan message
app.post('/api/send', auth, async (req,res) => {
  const { to, subject='Pesan dari xrcivxofficial', message } = req.body || {};
  if (!to) return res.status(400).json({success:false,error:'Field "to" wajib diisi'});
  if (!message) return res.status(400).json({success:false,error:'Field "message" wajib diisi'});
  log('info',`Sending to ${c.white}${to}${c.reset}`);
  try {
    const info = await transporter.sendMail({
      from:`"xrcivxofficial" <${CONFIG.EMAIL_USER}>`,
      to, subject, text: message,
    });
    const payload = {success:true,messageId:info.messageId,to,subject};
    log('ok',`Delivered → ${info.messageId}`,payload);
    res.json(payload);
  } catch(err) {
    const payload = {success:false,error:err.message};
    log('error',err.message,payload);
    res.status(500).json(payload);
  }
});

// generate QR code dari teks atau url, return base64 + url gambar
app.get('/api/qr', async (req, res) => {
  const { text, size = 200 } = req.query;
  if (!text) return res.status(400).json({ success: false, error: 'Parameter "text" wajib diisi' });

  // clamp ukuran biar gak kegedean atau kekecilan
  const safeSize = Math.min(Math.max(parseInt(size) || 200, 100), 500);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${safeSize}x${safeSize}&data=${encodeURIComponent(text)}&format=png`;

  try {
    // download gambar dari qrserver terus konvert ke base64
    const imageBuffer = await new Promise((resolve, reject) => {
      https.get(qrUrl, (response) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      }).on('error', reject);
    });

    log('ok', `QR generated for: ${text.substring(0, 40)}`);
    res.json({
      success: true,
      text,
      size: safeSize,
      format: 'png',
      base64: `data:image/png;base64,${imageBuffer.toString('base64')}`,
      url: qrUrl,
    });
  } catch (err) {
    log('error', `QR failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// return IP caller + info lokasi, fallback ke ip publik kalau lokal
app.get('/api/ip', async (req, res) => {
  const rawIp =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket.remoteAddress ||
    '0.0.0.0';

  let ip = rawIp.replace('::ffff:', '');

  // deteksi kalau IP-nya private/loopback
  const isPrivate = (addr) =>
    addr === '127.0.0.1' || addr === '::1' || addr === 'localhost' ||
    addr.startsWith('10.') || addr.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(addr);

  try {
    // kalau lokal, resolve dulu ke ip publik via ipify
    if (isPrivate(ip)) {
      try {
        const pub = JSON.parse(await httpGet('https://api.ipify.org?format=json'));
        if (pub.ip) ip = pub.ip;
      } catch (_) {}
    }

    // lookup lokasi pakai ipapi.co
    let geo = {};
    try {
      geo = JSON.parse(await httpGet(`https://ipapi.co/${ip}/json/`));
    } catch (_) {}

    // kalau ipapi.co kena rate limit atau gagal, pakai ip-api.com
    if (!geo.city && !geo.country_name) {
      try {
        const fb = JSON.parse(await httpGet(`http://ip-api.com/json/${ip}`));
        if (fb.status === 'success') {
          geo = {
            city: fb.city,
            region: fb.regionName,
            country_name: fb.country,
            country_code: fb.countryCode,
            timezone: fb.timezone,
            org: fb.isp,
            latitude: fb.lat,
            longitude: fb.lon,
          };
        }
      } catch (_) {}
    }

    log('ok', `IP lookup: ${ip} → ${geo.country_name || 'unknown'}`);
    res.json({
      success: true,
      ip,
      city: geo.city || null,
      region: geo.region || null,
      country: geo.country_name || null,
      country_code: geo.country_code || null,
      timezone: geo.timezone || null,
      isp: geo.org || null,
      latitude: geo.latitude || null,
      longitude: geo.longitude || null,
    });
  } catch (err) {
    log('error', `IP lookup failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message, ip });
  }
});

// cek server hidup atau tidak, butuh auth
app.get('/api/status', auth, (req,res) => {
  res.json({success:true,status:'online',uptime:`${Math.floor(process.uptime())}s`,timestamp:new Date().toISOString()});
});

// root endpoint, kasih info singkat tentang API ini
app.get('/', (req, res) => {
  res.json({
    success: true,
    name: 'xrcivxofficial REST API',
    version: '1.0.0',
    endpoints: [
      'POST /api/send   — kirim email (auth)',
      'GET  /api/qr     — generate QR code',
      'GET  /api/ip     — cek IP caller',
      'GET  /api/status — status server (auth)',
    ],
    note: 'Frontend ada di index.html. Ganti BASE_URL di sana dengan URL deploy ini.',
  });
});

app.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log('');
  console.log(`  ${c.bold}${c.white}╔══════════════════════════════════════╗${c.reset}`);
  console.log(`  ${c.bold}${c.white}║     XRCIVXOFFICIAL  REST API          ║${c.reset}`);
  console.log(`  ${c.bold}${c.white}╚══════════════════════════════════════╝${c.reset}`);
  console.log('');
  console.log(`  ${c.gray}►${c.reset} Sender   ${c.white}${CONFIG.EMAIL_USER}${c.reset}`);
  console.log(`  ${c.gray}►${c.reset} Port     ${c.white}${CONFIG.PORT}${c.reset}`);
  console.log(`  ${c.gray}►${c.reset} API      ${c.cyan}http://localhost:${CONFIG.PORT}${c.reset}`);
  console.log('');
  console.log(`  ${c.dim}── Endpoints ──────────────────────────${c.reset}`);
  console.log(`  ${c.green}GET ${c.reset}   /api/status`);
  console.log(`  ${c.green}GET ${c.reset}   /api/qr?text=hello`);
  console.log(`  ${c.green}GET ${c.reset}   /api/ip`);
  console.log(`  ${c.blue}POST${c.reset}   /api/send`);
  console.log('');
  console.log(`  ${c.green}●${c.reset} Ready — ${c.dim}waiting for requests...${c.reset}`);
  console.log('');
});
