// ============================================================
// api/live.js — Live Monitor + กดหยุดให้ + ลบกิจกรรมค้าง
// เรียก: POST /api/live  body: { action, token, ... }
// (Admin/Monitor เท่านั้น)
// ============================================================
import { supabase, QUOTA, TYPE_MAP, getUserByToken, isAdminOrMonitor, isAdminLevel, logAction, json, thaiTimeStr, sendTelegram, thaiDateStr, thaiStartDate } from './_lib/supabase.js';

const LIMIT_MAP = { break: QUOTA.break, smoking: QUOTA.smoking, toilet: QUOTA.toilet, eat: QUOTA.eat };
const ROLE_LABEL = { superadmin:'ผู้ดูแลสูงสุด', admin:'ผู้ดูแล', monitor:'ผู้ตรวจสอบ', employee:'พนักงาน' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, { success: false, message: 'POST only' }, 405);
  const body = req.body || {};
  const user = await getUserByToken(body.token);
  if (!user) return json(res, { success: false, expired: true, activities: [] });
  if (!isAdminOrMonitor(user)) return json(res, { success: false, message: 'เฉพาะผู้ดูแลระบบ', activities: [] });

  try {
    // ---------- Live Monitor: ใครกำลังทำกิจกรรม ----------
    if (body.action === 'getLive') {
      const { data } = await supabase.from('running').select('*');
      const now = Date.now();
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const midnightMs = midnight.getTime();
      const acts = (data || []).map(r => {
        const startMs = parseInt(r.start_ms) || now;
        const elapsedMin = Math.floor((now - startMs) / 60000);
        const lim = LIMIT_MAP.hasOwnProperty(r.activity_type) ? LIMIT_MAP[r.activity_type] : 0;
        const isOver = (lim > 0 && elapsedMin >= lim);
        const sd = new Date(startMs);
        return {
          username: r.username, displayName: r.display_name,
          type: r.activity_type, displayType: TYPE_MAP[r.activity_type] || r.activity_type,
          startMs, startStr: r.start_str, elapsedMin, limit: lim, isOver,
          crossDay: startMs < midnightMs,
          startDate: sd.toLocaleDateString('th-TH'),
        };
      });
      // เรียง: เกินเวลาก่อน แล้วเรียงตามเวลานานสุด
      acts.sort((a, b) => (a.isOver !== b.isOver) ? (a.isOver ? -1 : 1) : (b.elapsedMin - a.elapsedMin));
      return json(res, { success: true, activities: acts, count: acts.length, serverNow: now });
    }

    // ---------- กดหยุดให้ (admin/monitor) ----------
    if (body.action === 'forceStop') {
      const { targetUsername, targetDisplayName, activityType, startStr, startMs } = body;
      const displayType = TYPE_MAP[activityType] || activityType;
      const minutes = startMs ? Math.round(((Date.now() - parseInt(startMs)) / 60000) * 100) / 100 : null;

      // ลบ running (atomic) — ถ้าไม่มี = ถูกหยุดไปแล้ว
      const { data: deleted } = await supabase.from('running').delete()
        .ilike('username', targetUsername).eq('activity_type', activityType).select();
      if (!deleted || deleted.length === 0) {
        return json(res, { success: false, alreadyLogged: true, message: 'กิจกรรมนี้ถูกหยุดไปแล้ว' });
      }

      // บันทึก log
      const today = thaiDateStr();
      const startDate = thaiStartDate(minutes != null ? minutes * 60 : 0);  // วันเริ่ม (เวลาไทย)
      const stopStr = thaiTimeStr();
      await supabase.from('logs').insert({
        username: targetUsername, display_name: targetDisplayName,
        activity_type: activityType, display_type: displayType,
        start_str: startStr || '', stop_str: stopStr, minutes, log_date: startDate,
      });
      // บันทึก force_stop_log — ใช้ stop_str เป็น HH:mm:ss ให้ตรงกับ logs (เพื่อ match ในประวัติ)
      await supabase.from('force_stop_log').insert({
        stopper_user: user.username, stopper_role: ROLE_LABEL[user.role] || user.role,
        target_user: targetUsername, target_name: targetDisplayName,
        display_type: displayType, start_str: startStr, stop_str: stopStr, minutes, log_date: startDate,
      });

      await logAction(user.username, user.role, 'กดหยุดให้',
        `กดหยุด "${displayType}" ของ ${targetDisplayName || targetUsername} (${minutes} นาที)`);
      await sendTelegram(`🛑 <b>หยุดกิจกรรม</b>\n@${user.username} หยุด "${displayType}" ของ <b>${targetDisplayName}</b>\n⏱ ใช้ไป ${minutes} นาที`);
      return json(res, { success: true, minutes });
    }

    // ---------- ลบกิจกรรมค้าง (admin level — ไม่บันทึก log) ----------
    if (body.action === 'discard') {
      if (!isAdminLevel(user)) return json(res, { success: false, message: 'เฉพาะผู้ดูแล' });
      const { targetUsername, activityType } = body;
      await supabase.from('running').delete()
        .ilike('username', targetUsername).eq('activity_type', activityType);
      return json(res, { success: true });
    }

    return json(res, { success: false, message: 'unknown action' });
  } catch (e) {
    return json(res, { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message, activities: [] });
  }
}
