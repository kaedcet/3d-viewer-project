import express from 'express';
import helmet from 'helmet';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const PORT = process.env.PORT || 3000;
const rawKey = process.env.MASTER_KEY || '';

// ตรวจสอบความยาวของ MASTER_KEY (ต้องเป็น Hex 64 ตัวอักษร สำหรับ AES-256)
if (rawKey.length !== 64) {
  console.warn('⚠️ คำเตือน: MASTER_KEY ในไฟล์ .env ควรเป็นรหัส Hex ความยาว 64 ตัวอักษร');
}
const MASTER_KEY = Buffer.from(rawKey, 'hex');

// กำหนดชื่อโมเดลให้ตรงกับชื่อไฟล์ .enc ในโฟลเดอร์ protected_models (ไม่ต้องใส่ .enc)
const MODEL_ID = '85060a456e97'; // <--- เปลี่ยนตรงนี้ให้ตรงกับชื่อไฟล์ .enc ของคุณ

const app = express();

// ตั้งค่า Helmet แต่ปิด ContentSecurityPolicy ชั่วคราวเพื่อให้โหลดสคริปต์จาก CDN ได้ง่ายขึ้น
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static('public'));
app.use(express.json());

// ฟังก์ชันถอดรหัสไฟล์ที่เก็บไว้ (At-Rest Encryption)
function decryptAtRest(buf) {
  const d = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

// API สำหรับสร้าง Session ชั่วคราว ก่อนอนุญาตให้ดาวน์โหลดโมเดล
app.post('/api/session', (req, res) => {
  const encPath = path.join('protected_models', `${MODEL_ID}.enc`);
  if (!fs.existsSync(encPath)) {
    console.error(`❌ ไม่พบไฟล์โมเดลที่ path: ${encPath}`);
    return res.status(404).json({ error: 'ไม่พบไฟล์โมเดลในระบบ' });
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const key = crypto.randomBytes(32);
  
  // บันทึก Session ชั่วคราว (อายุการใช้งาน 30 วินาที)
  global.activeSession = { token, key, expires: Date.now() + 30000 };
  
  res.json({ token, key: key.toString('base64') });
});

// API สำหรับสตรีมและเข้ารหัสส่งให้ Client ไปถอดรหัสต่อหน้างาน
app.get('/api/stream/:token', (req, res) => {
  try {
    const s = global.activeSession;
    if (!s || s.token !== req.params.token || s.expires < Date.now()) {
      return res.status(403).json({ error: 'Session หมดอายุหรือไม่ถูกต้อง' });
    }
    // ลบ Session ทิ้งทันทีหลังใช้งาน (ใช้ได้ครั้งเดียว)
    global.activeSession = null;

    const encPath = path.join('protected_models', `${MODEL_ID}.enc`);
    const encBuf = fs.readFileSync(encPath);
    
    // 1. ถอดรหัสไฟล์จากเซิร์ฟเวอร์
    const plain = decryptAtRest(encBuf);

    // 2. เข้ารหัสใหม่ด้วย Session Key เฉพาะกิจส่งให้ Client
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', s.key, iv);
    const enc = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
    
    res.set({ 
      'Content-Type': 'application/octet-stream', 
      'Cache-Control': 'no-store' 
    });
    res.send(Buffer.concat([iv, enc]));
  } catch (err) {
    console.error('❌ Error ในการสตรีมและถอดรหัส:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// เสิร์ฟหน้าเว็บหลัก
app.get('/', (req, res) => {
  res.sendFile(path.resolve('views/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});