// ============================================================
// _lib/supabase.js — เชื่อมต่อ Supabase + helper ที่ใช้ร่วมกัน
// ============================================================
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ใช้ Service Role Key (ฝั่ง server เท่านั้น — มีสิทธิ์เต็ม)
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---------- ค่าคงที่ (เหมือนระบบเดิม) ----------
export const QUOTA = {
  shared: 90,    // สูบบุหรี่ + ห้องน้ำ + กินข้าว รวมกัน
  break: 120,    // พักเบรค
  smoking: 20, toilet: 20, eat: 20,  // limit ต่อกิจกรรม
};

export const TYPE_MAP = {
  break: 'พักเบรค', smoking: 'สูบบุหรี่', toilet: 'เข้าห้องน้ำ',
  eat: 'ซื้อ/กินข้าว', assist: 'ช่วยงานบริษัท',
};

export const ROLE_LABEL = {
  superadmin: 'ผู้ดูแลสูงสุด', admin: 'ผู้ดูแล',
  monitor: 'ผู้ตรวจสอบ', employee: 'พนักงาน',
};

// ---------- เวลาไทย HH:mm:ss (Vercel รันที่ UTC จึงบวก +7 ชม.เอง) ----------
export function thaiTimeStr() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(11, 19);
}

// ---------- hash password (SHA-256 เหมือนระบบเดิม) ----------
export function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw), 'utf8').digest('hex');
}

// ---------- ตรวจ session token ----------
// รูปแบบ token: username-randomhex-timestamp (frontend ใช้ timestamp ส่วนท้ายเช็คอายุ 12 ชม.)
export function makeToken(username) {
  const rand = crypto.randomBytes(12).toString('hex');
  return `${username}-${rand}-${Date.now()}`;
}

// ---------- ตรวจสิทธิ์ ----------
export async function getUserByToken(token) {
  if (!token) return null;
  const username = String(token).split('-')[0];
  const { data } = await supabase.from('users').select('*').ilike('username', username).single();
  if (!data) return null;
  if (data.session_token !== token) return null;
  return data;
}

export function isAdminLevel(user) {
  return user && (user.role === 'admin' || user.role === 'superadmin');
}
export function isSuperAdmin(user) {
  return user && (user.role === 'superadmin' || user.username.toLowerCase() === 'admin');
}
export function isAdminOrMonitor(user) {
  return user && ['admin', 'superadmin', 'monitor'].includes(user.role);
}

// ---------- บันทึก action (กระดิ่ง) ----------
export async function logAction(actor, role, type, detail) {
  try {
    await supabase.from('activity_log').insert({
      actor, role: ROLE_LABEL[role] || 'พนักงาน', type, detail,
    });
  } catch (e) {}
}

// ---------- helper response ----------
export function json(res, data, status = 200) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}
