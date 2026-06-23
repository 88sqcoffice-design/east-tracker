// ============================================================
// api/data.js — จัดการข้อมูล: สถิติ DB, Export, ลบ logs เก่า
// เรียก: POST /api/data  body: { action, token, ... }
// ============================================================
import { supabase, getUserByToken, isAdminLevel, isSuperAdmin, logAction, json } from './_lib/supabase.js';

export default async function handler(req, res) {
  try {
    const body = req.body || {};
    const user = await getUserByToken(body.token);
    if (!user) return json(res, { expired: true });
    if (!isAdminLevel(user)) return json(res, { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' });

    // ---------- 1. สถิติฐานข้อมูล (จำนวน records แต่ละตาราง) ----------
    if (body.action === 'dbStats') {
      const tables = ['logs', 'force_stop_log', 'users', 'running', 'activity_log'];
      const stats = {};
      for (const t of tables) {
        const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
        stats[t] = count || 0;
      }
      // วันเก่าสุด/ใหม่สุดของ logs
      const { data: oldest } = await supabase.from('logs').select('log_date').order('log_date', { ascending: true }).limit(1);
      const { data: newest } = await supabase.from('logs').select('log_date').order('log_date', { ascending: false }).limit(1);
      return json(res, {
        success: true, stats,
        oldestDate: (oldest && oldest[0]) ? oldest[0].log_date : null,
        newestDate: (newest && newest[0]) ? newest[0].log_date : null,
      });
    }

    // ---------- 2. Export logs ทั้งหมด (สำหรับ CSV) ----------
    if (body.action === 'exportAll') {
      const { data } = await supabase.from('logs').select('*')
        .order('log_date', { ascending: false }).order('id', { ascending: false });
      return json(res, { success: true, logs: data || [] });
    }

    // ---------- 3. ลบ logs เก่า (ก่อนวันที่กำหนด) — เฉพาะ superadmin ----------
    if (body.action === 'deleteOldLogs') {
      if (!isSuperAdmin(user)) return json(res, { success: false, message: 'เฉพาะผู้ดูแลสูงสุดเท่านั้น' });
      const before = body.beforeDate; // YYYY-MM-DD
      if (!before) return json(res, { success: false, message: 'กรุณาระบุวันที่' });
      // นับจำนวนก่อนลบ
      const { count: logCount } = await supabase.from('logs').select('*', { count: 'exact', head: true }).lt('log_date', before);
      const { count: fsCount } = await supabase.from('force_stop_log').select('*', { count: 'exact', head: true }).lt('log_date', before);
      // ลบ logs + force_stop_log ที่เก่ากว่า
      await supabase.from('logs').delete().lt('log_date', before);
      await supabase.from('force_stop_log').delete().lt('log_date', before);
      await logAction(user.username, user.role, 'ลบข้อมูลเก่า',
        `ลบ LOGS ก่อนวันที่ ${before} — logs ${logCount || 0} + ประวัติหยุด ${fsCount || 0} รายการ`);
      return json(res, { success: true, deletedLogs: logCount || 0, deletedForceStop: fsCount || 0 });
    }

    return json(res, { success: false, message: 'ไม่รู้จักคำสั่งนี้' });
  } catch (e) {
    return json(res, { success: false, message: 'เกิดข้อผิดพลาด: ' + (e.message || e) });
  }
}
