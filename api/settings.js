// ============================================================
// api/settings.js — ตั้งค่า Telegram + ธีม + รูปกิจกรรม
// เรียก: POST /api/settings  body: { action, token, ... }
// (Admin level เท่านั้น)
// ============================================================
import { supabase, getUserByToken, isAdminLevel, isSuperAdmin, json } from './_lib/supabase.js';

// helper อ่าน/เขียน setting
async function getSetting(key, def = '') {
  const { data } = await supabase.from('settings').select('value').eq('key', key).single();
  return data ? data.value : def;
}
async function setSetting(key, value) {
  const { error } = await supabase.from('settings').upsert({ key, value: String(value) }, { onConflict: 'key' });
  return !error;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, { success: false, message: 'POST only' }, 405);
  const body = req.body || {};
  const user = await getUserByToken(body.token);
  if (!user) return json(res, { success: false, expired: true });
  if (!isAdminLevel(user)) return json(res, { success: false, message: 'เฉพาะผู้ดูแลระบบ' });

  try {
    // ---------- ดึงค่า Telegram ----------
    if (body.action === 'getTelegram') {
      return json(res, {
        success: true,
        enabled: (await getSetting('tg_enabled', 'false')) === 'true',
        botToken: await getSetting('tg_bot_token', ''),
        chatId: await getSetting('tg_chat_id', ''),
        overtimeMinutes: await getSetting('tg_overtime_minutes', '20'),
      });
    }

    // ---------- ตั้งค่า Telegram ----------
    if (body.action === 'setTelegram') {
      const { enabled, botToken, chatId, overtimeMinutes } = body;
      let ok = await setSetting('tg_enabled', enabled ? 'true' : 'false');
      if (botToken != null) ok = (await setSetting('tg_bot_token', botToken)) && ok;
      if (chatId != null) ok = (await setSetting('tg_chat_id', chatId)) && ok;
      if (overtimeMinutes != null) ok = (await setSetting('tg_overtime_minutes', overtimeMinutes)) && ok;
      return json(res, { success: ok, message: ok ? '' : 'บันทึกไม่สำเร็จ — ตรวจสอบฐานข้อมูล' });
    }

    // ---------- ทดสอบส่ง Telegram ----------
    if (body.action === 'testTelegram') {
      const botToken = await getSetting('tg_bot_token', '');
      const chatId = await getSetting('tg_chat_id', '');
      if (!botToken || !chatId) return json(res, { success: false, message: 'ยังไม่ได้ตั้งค่า bot token หรือ chat id' });

      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: '✅ ทดสอบการแจ้งเตือน EAST TIME TRACKER', parse_mode: 'HTML' }),
      });
      const ok = r.ok;
      const enabled = await getSetting('tg_enabled', 'false');
      let msg;
      if (!ok) msg = 'ส่งไม่สำเร็จ — เช็ค token/chat id';
      else if (enabled === 'true') msg = '✅ ส่งสำเร็จ + ระบบแจ้งเตือนเปิดอยู่';
      else msg = '⚠️ ส่งทดสอบสำเร็จ แต่ระบบแจ้งเตือนยัง "ปิด"! ต้องเปิดสวิตช์ "เปิดใช้งาน" แล้วกดบันทึก';
      return json(res, { success: ok, enabled: enabled === 'true', message: msg });
    }

    // ---------- ตั้งค่าพื้นหลัง ----------
    if (body.action === 'setBackground') {
      await setSetting('default_bg_url', body.url || '');
      return json(res, { success: true });
    }

    // ---------- ตั้งธีมเริ่มต้นของระบบ (เฉพาะผู้ดูแลสูงสุด) ----------
    if (body.action === 'setDefaultTheme') {
      if (!isSuperAdmin(user)) return json(res, { success: false, message: 'เฉพาะผู้ดูแลสูงสุด' });
      await setSetting('default_theme', body.theme || 'deep');
      return json(res, { success: true });
    }

    // ---------- ตั้งค่าสีตัวอักษร ----------
    if (body.action === 'setTextColors') {
      const { main, sub, num, btn } = body;
      if (main != null) await setSetting('color_text_main', main);
      if (sub != null) await setSetting('color_text_sub', sub);
      if (num != null) await setSetting('color_text_num', num);
      if (btn != null) await setSetting('color_text_btn', btn);
      return json(res, { success: true });
    }

    // ---------- ตั้งค่ารูป popup กิจกรรม ----------
    if (body.action === 'setPopupImages') {
      const { images } = body;  // { break: url, smoking: url, ... }
      if (images) {
        for (const [act, url] of Object.entries(images)) {
          await setSetting(`popup_img_${act}`, url || '');
        }
      }
      return json(res, { success: true });
    }

    // ---------- ดึงค่าทั้งหมด (สำหรับ frontend โหลดตอนเปิด) ----------
    if (body.action === 'getAll') {
      const { data } = await supabase.from('settings').select('key, value');
      const map = {};
      (data || []).forEach(r => { map[r.key] = r.value; });
      return json(res, { success: true, settings: map });
    }

    return json(res, { success: false, message: 'unknown action' });
  } catch (e) {
    return json(res, { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message });
  }
}
