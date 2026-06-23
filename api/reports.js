// ============================================================
// api/reports.js — รายงานรายวัน/ช่วงวัน + รายละเอียดรายคน + ลบรายการ
// เรียก: POST /api/reports  body: { action, token, ... }
// ============================================================
import { supabase, QUOTA, getUserByToken, isAdminLevel, logAction, json } from './_lib/supabase.js';

// รวมข้อมูลเป็นรายคน (โควต้า + จำนวนครั้ง)
function aggregateByUser(rows) {
  const map = {};
  rows.forEach(r => {
    const u = (r.username || '').toLowerCase();
    if (!map[u]) {
      map[u] = {
        username: r.username, displayName: r.display_name || r.username,
        counts: { break: 0, smoking: 0, toilet: 0, eat: 0, assist: 0 },
        minutes: { break: 0, smoking: 0, toilet: 0, eat: 0, assist: 0 },
      };
    }
    const t = r.display_type || '';
    const m = parseFloat(r.minutes) || 0;
    let k = null;
    if (t.includes('พักเบรค')) k = 'break';
    else if (t.includes('สูบบุหรี่')) k = 'smoking';
    else if (t.includes('ห้องน้ำ')) k = 'toilet';
    else if (t.includes('กินข้าว')) k = 'eat';
    else if (t.includes('ช่วยงาน')) k = 'assist';
    if (k) { map[u].counts[k]++; map[u].minutes[k] = Math.round((map[u].minutes[k] + m) * 100) / 100; }
  });
  return Object.values(map).map(u => {
    const c = u.counts, mn = u.minutes;
    const totalCount = c.break + c.smoking + c.toilet + c.eat + c.assist;
    const totalMinutes = Math.round((mn.break + mn.smoking + mn.toilet + mn.eat + mn.assist) * 100) / 100;
    return { ...u, totalCount, totalMinutes };
  });
}

// รวมจำนวนครั้ง + นาทีทุกคน แยกกิจกรรม (สำหรับการ์ดสรุปรวม)
function toISODate(d) {
  if (!d) return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (String(d).includes('/')) {
    const [dd, mm, yyyy] = String(d).split('/');
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  return d;
}

function computeTotals(rows) {
  const totalCounts = { break: 0, smoking: 0, toilet: 0, eat: 0, assist: 0 };
  const totalMinutes = { break: 0, smoking: 0, toilet: 0, eat: 0, assist: 0 };
  rows.forEach(r => {
    const t = r.display_type || ''; const m = parseFloat(r.minutes) || 0;
    let k = null;
    if (t.includes('พักเบรค')) k = 'break';
    else if (t.includes('สูบบุหรี่')) k = 'smoking';
    else if (t.includes('ห้องน้ำ')) k = 'toilet';
    else if (t.includes('กินข้าว')) k = 'eat';
    else if (t.includes('ช่วยงาน')) k = 'assist';
    if (k) { totalCounts[k]++; totalMinutes[k] = Math.round((totalMinutes[k] + m) * 100) / 100; }
  });
  return { totalCounts, totalMinutes };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, { success: false, message: 'POST only' }, 405);
  const body = req.body || {};
  const user = await getUserByToken(body.token);
  if (!user) return json(res, { success: false, expired: true });
  if (!isAdminLevel(user)) return json(res, { success: false, message: 'เฉพาะผู้ดูแลระบบ' });

  try {
    // ---------- รายงานรายวัน ----------
    if (body.action === 'daily') {
      const date = toISODate(body.date);
      const { data } = await supabase.from('logs').select('*').eq('log_date', date);
      const rows = data || [];
      const users = aggregateByUser(rows);
      const { totalCounts, totalMinutes } = computeTotals(rows);
      return json(res, { success: true, users, date, userCount: users.length, totalCounts, totalMinutes });
    }

    // ---------- รายงานช่วงวัน ----------
    if (body.action === 'range') {
      const dateFrom = toISODate(body.dateFrom), dateTo = toISODate(body.dateTo);
      const { data } = await supabase.from('logs').select('*')
        .gte('log_date', dateFrom).lte('log_date', dateTo);
      const rows = data || [];
      const users = aggregateByUser(rows);
      const { totalCounts, totalMinutes } = computeTotals(rows);
      return json(res, { success: true, users, dateFrom, dateTo, userCount: users.length, totalCounts, totalMinutes });
    }

    // ---------- รายละเอียดรายคน (รายวัน) ----------
    if (body.action === 'userDetail') {
      const { targetUsername, date } = body;
      const d = toISODate(date);
      const { data } = await supabase.from('logs').select('*')
        .ilike('username', targetUsername).eq('log_date', d)
        .order('id', { ascending: false });  // ใหม่→เก่า ด้วย id (แม่นกว่า created_at)
      // ดึงประวัติการกดหยุดของ user+วันนี้ เพื่อหาว่าใครเป็นคนหยุด
      const { data: fsl } = await supabase.from('force_stop_log').select('*')
        .ilike('target_user', targetUsername).eq('log_date', d);
      const fslList = fsl || [];
      const entries = (data || []).map(r => {
        const m = fslList.find(f => f.display_type === r.display_type && f.stop_str === r.stop_str);
        const stopperLabel = m ? ('@' + m.stopper_user + ' (' + (m.stopper_role || '') + ')') : '';
        return {
          id: r.id, date: d, displayType: r.display_type,
          startStr: r.start_str || '', stopStr: r.stop_str || '',
          minutes: r.minutes, stopperLabel: stopperLabel,
        };
      });
      return json(res, { success: true, entries });
    }

    // ---------- ลบรายการ (ใช้ id — แม่นยำ ไม่มีบั๊ก match) ----------
    if (body.action === 'deleteEntry') {
      const { entryId } = body;
      if (!entryId) return json(res, { success: false, message: 'ไม่มี id' });

      // ดึงข้อมูลก่อนลบ (เพื่อ log + คืนโควต้า)
      const { data: row } = await supabase.from('logs').select('*').eq('id', entryId).single();
      if (!row) return json(res, { success: false, message: 'ไม่พบรายการ (อาจถูกลบแล้ว)' });

      await supabase.from('logs').delete().eq('id', entryId);
      await logAction(user.username, user.role, 'ลบประวัติ',
        `ลบรายการ "${row.display_type}" ของ @${row.username} (${row.minutes} นาที)`);

      // คืนโควต้า — คำนวณใหม่
      const today = new Date().toISOString().slice(0, 10);
      let quota = null;
      if (row.log_date === today) {
        const { data: logs } = await supabase.from('logs').select('display_type, minutes')
          .ilike('username', row.username).eq('log_date', today);
        let shared = 0, brk = 0;
        (logs || []).forEach(r => {
          const t = r.display_type || ''; const m = parseFloat(r.minutes) || 0;
          if (t.includes('พักเบรค')) brk += m;
          else if (t.includes('สูบบุหรี่') || t.includes('ห้องน้ำ') || t.includes('กินข้าว')) shared += m;
        });
        quota = { sharedUsed: Math.round(shared*100)/100, breakUsed: Math.round(brk*100)/100 };
      }
      return json(res, { success: true, quota });
    }

    return json(res, { success: false, message: 'unknown action' });
  } catch (e) {
    return json(res, { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message });
  }
}
