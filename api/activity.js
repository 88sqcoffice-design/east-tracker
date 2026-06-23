// ============================================================
// api/activity.js — เริ่ม/หยุดกิจกรรม + โควต้า + ประวัติ
// เรียก: POST /api/activity  body: { action, token, ... }
// ============================================================
import { supabase, QUOTA, TYPE_MAP, getUserByToken, logAction, json } from './_lib/supabase.js';

// คำนวณโควต้าจาก logs วันนี้ (SQL SUM — เร็วมาก)
async function getQuota(username) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('logs')
    .select('display_type, minutes')
    .ilike('username', username)
    .eq('log_date', today);

  let shared = 0, brk = 0;
  (data || []).forEach(r => {
    const t = r.display_type || '';
    const m = parseFloat(r.minutes) || 0;
    if (t.includes('พักเบรค')) brk += m;
    else if (t.includes('สูบบุหรี่') || t.includes('ห้องน้ำ') || t.includes('กินข้าว')) shared += m;
  });
  shared = Math.round(shared * 100) / 100;
  brk = Math.round(brk * 100) / 100;
  return {
    sharedUsed: shared, breakUsed: brk,
    sharedQuota: QUOTA.shared, breakQuota: QUOTA.break,
    sharedRemain: Math.round((QUOTA.shared - shared) * 100) / 100,
    breakRemain: Math.round((QUOTA.break - brk) * 100) / 100,
    limitSmoking: QUOTA.smoking, limitToilet: QUOTA.toilet, limitEat: QUOTA.eat,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, { success: false, message: 'POST only' }, 405);
  const body = req.body || {};
  const user = await getUserByToken(body.token);
  if (!user) return json(res, { success: false, expired: true, message: 'เซสชันหมดอายุ' });

  const uname = user.username;
  const dname = user.display_name;

  try {
    // ---------- เริ่มกิจกรรม ----------
    if (body.action === 'start') {
      const { activityType, startStr } = body;
      // ลบ running เก่าก่อน แล้ว insert ใหม่ (ใช้ delete+insert แทน upsert
      // เพราะ unique index เป็น functional lower(username) — onConflict ระบุไม่ได้)
      await supabase.from('running').delete().ilike('username', uname).eq('activity_type', activityType);
      const { error: insErr } = await supabase.from('running').insert({
        username: uname, display_name: dname, activity_type: activityType,
        start_ms: Date.now(), start_str: startStr,
      });
      if (insErr) return json(res, { success: false, message: insErr.message });

      await logAction(uname, user.role, 'เริ่มกิจกรรม', `${dname} เริ่ม "${TYPE_MAP[activityType] || activityType}"`);
      return json(res, { success: true });
    }

    // ---------- หยุดกิจกรรม ⭐ (จุดกันซ้ำ) ----------
    if (body.action === 'stop') {
      const { activityType, startStr, durationSec } = body;
      const displayType = TYPE_MAP[activityType] || activityType;
      const minutes = (durationSec != null && durationSec >= 0)
        ? Math.round((durationSec / 60) * 100) / 100 : null;

      // กันซ้ำ: ลบ running ก่อน (atomic) — ถ้าไม่มี running แล้ว = ถูกหยุดไปแล้ว
      const { data: deleted } = await supabase
        .from('running')
        .delete()
        .ilike('username', uname)
        .eq('activity_type', activityType)
        .select();

      if (!deleted || deleted.length === 0) {
        // ไม่มี running = หยุดไปแล้ว (กดซ้ำ/รีเฟรชแล้วกดใหม่)
        return json(res, { success: false, alreadyLogged: true, message: 'กิจกรรมนี้ถูกบันทึกไปแล้ว' });
      }

      // มี running จริง → บันทึก log
      const nowStr = new Date().toTimeString().slice(0, 8);  // HH:mm:ss
      await supabase.from('logs').insert({
        username: uname, display_name: dname,
        activity_type: activityType, display_type: displayType,
        start_str: startStr || '', stop_str: nowStr,
        minutes, log_date: new Date().toISOString().slice(0, 10),
      });

      await logAction(uname, user.role, 'หยุดกิจกรรม', `${dname} หยุด "${displayType}" (${minutes} นาที)`);

      const quota = await getQuota(uname);
      return json(res, { success: true, minutes, quota });
    }

    // ---------- โควต้า ----------
    if (body.action === 'quota') {
      return json(res, { success: true, ...(await getQuota(uname)) });
    }

    // ---------- ประวัติวันนี้ ----------
    if (body.action === 'todayLogs') {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('logs').select('*')
        .ilike('username', uname).eq('log_date', today)
        .order('created_at', { ascending: false });
      // แปลง field ให้ตรงกับที่ frontend ใช้ (type/displayType/startStr/stopStr)
      const logs = (data || []).map(r => ({
        type: r.activity_type, displayType: r.display_type,
        startStr: r.start_str || '', stopStr: r.stop_str || '',
        minutes: r.minutes,
      }));
      return json(res, { success: true, logs });
    }

    // ---------- กิจกรรมค้าง (ของตัวเอง) ----------
    if (body.action === 'running') {
      const { data } = await supabase.from('running').select('*').ilike('username', uname);
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const midnightMs = midnight.getTime();
      const activities = (data || []).map(r => {
        const startMs = parseInt(r.start_ms) || Date.now();
        const sd = new Date(startMs);
        return {
          type: r.activity_type, startMs, startStr: r.start_str || '',
          crossDay: startMs < midnightMs,
          startDate: sd.toLocaleDateString('th-TH'),
        };
      });
      return json(res, { success: true, activities });
    }

    // ---------- สรุปจำนวนครั้งวันนี้ ----------
    if (body.action === 'summary') {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase.from('logs').select('display_type')
        .ilike('username', uname).eq('log_date', today);
      const counts = { break: 0, smoking: 0, toilet: 0, assist: 0, eat: 0 };
      (data || []).forEach(r => {
        const t = r.display_type || '';
        if (t.includes('พักเบรค')) counts.break++;
        else if (t.includes('สูบบุหรี่')) counts.smoking++;
        else if (t.includes('ห้องน้ำ')) counts.toilet++;
        else if (t.includes('กินข้าว')) counts.eat++;
        else if (t.includes('ช่วยงาน')) counts.assist++;
      });
      return json(res, { success: true, counts });
    }

    // ---------- บันทึกแบบ batch (offline sync) ----------
    if (body.action === 'batch') {
      const { queue } = body;  // [{ type, startStr, durationSec }, ...]
      if (!queue || !queue.length) return json(res, { success: true, saved: 0 });
      const today = new Date().toISOString().slice(0, 10);
      let saved = 0;
      for (const item of queue) {
        const displayType = TYPE_MAP[item.type] || item.type;
        const minutes = (item.durationSec != null) ? Math.round((item.durationSec / 60) * 100) / 100 : null;
        // กันซ้ำ: เช็คว่ามี log เดียวกันแล้วไหม (ตาม start_str + type + วันนี้)
        const { data: exist } = await supabase.from('logs').select('id')
          .ilike('username', uname).eq('display_type', displayType).eq('log_date', today)
          .limit(1);
        if (exist && exist.length) continue;  // มีแล้ว ข้าม
        const nowStrB = new Date().toTimeString().slice(0, 8);
        await supabase.from('logs').insert({
          username: uname, display_name: dname,
          activity_type: item.type, display_type: displayType,
          start_str: item.startStr || '', stop_str: nowStrB, minutes, log_date: today,
        });
        // ลบ running ถ้ามี
        await supabase.from('running').delete().ilike('username', uname).eq('activity_type', item.type);
        saved++;
      }
      const quota = await getQuota(uname);
      return json(res, { success: true, saved, quota });
    }

    return json(res, { success: false, message: 'unknown action' });
  } catch (e) {
    return json(res, { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message });
  }
}
