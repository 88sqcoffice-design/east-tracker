// ============================================================
// api/staff.js — จัดการพนักงาน (superadmin เท่านั้น)
// เรียก: POST /api/staff  body: { action, token, ... }
// ============================================================
import { supabase, TYPE_MAP, getUserByToken, isSuperAdmin, hashPassword, logAction, json, thaiTimeStr } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, { success: false, message: 'POST only' }, 405);
  const body = req.body || {};
  const user = await getUserByToken(body.token);
  if (!user) return json(res, { success: false, expired: true });
  if (!isSuperAdmin(user)) return json(res, { success: false, message: 'เฉพาะผู้ดูแลสูงสุด' });

  try {
    // ---------- รายชื่อพนักงาน ----------
    if (body.action === 'list') {
      const { data } = await supabase.from('users').select('username, display_name, role, created_at');
      // เรียง: สิทธิ์สูง→ต่ำ (superadmin>admin>monitor>employee) แล้วตามตัวอักษร username
      const roleRank = { superadmin: 0, admin: 1, monitor: 2, employee: 3 };
      const staff = (data || []).map(u => ({
        username: u.username, displayName: u.display_name,
        role: u.role || 'employee', createdAt: u.created_at,
        isMainAdmin: u.username.toLowerCase() === 'admin',
      })).sort((a, b) => {
        const ra = roleRank[a.role] != null ? roleRank[a.role] : 3;
        const rb = roleRank[b.role] != null ? roleRank[b.role] : 3;
        if (ra !== rb) return ra - rb;                          // สิทธิ์สูงก่อน
        return a.username.toLowerCase().localeCompare(b.username.toLowerCase());  // ตามตัวอักษร
      });
      return json(res, { success: true, staff });
    }

    // ---------- เปลี่ยนสิทธิ์ ----------
    if (body.action === 'setRole') {
      const { targetUsername, role } = body;
      let r = String(role || '').toLowerCase().trim();
      if (!['monitor', 'admin', 'superadmin'].includes(r)) r = 'employee';
      const { error } = await supabase.from('users').update({ role: r }).ilike('username', targetUsername);
      if (error) return json(res, { success: false, message: error.message });

      const label = { superadmin:'ผู้ดูแลสูงสุด', admin:'ผู้ดูแล', monitor:'ผู้ตรวจสอบ', employee:'พนักงาน' }[r];
      await logAction(user.username, user.role, 'เปลี่ยนสิทธิ์', `เปลี่ยนสิทธิ์ @${targetUsername} → ${label}`);
      return json(res, { success: true });
    }

    // ---------- ลบบัญชี ----------
    if (body.action === 'deleteUser') {
      const { targetUsername } = body;
      const { data: u } = await supabase.from('users').select('display_name').ilike('username', targetUsername).single();
      const delName = u ? u.display_name : targetUsername;

      await supabase.from('users').delete().ilike('username', targetUsername);
      // เคลียร์ session + running ค้าง
      await supabase.from('settings').delete().eq('key', `sess_${targetUsername.toLowerCase()}`);
      await supabase.from('running').delete().ilike('username', targetUsername);

      await logAction(user.username, user.role, 'ลบบัญชี', `ลบบัญชี ${delName} (@${targetUsername})`);
      return json(res, { success: true });
    }

    // ---------- รีเซ็ตรหัสผ่าน ----------
    if (body.action === 'resetPassword') {
      const { targetUsername, newPassword } = body;
      if (!newPassword || newPassword.length < 6) return json(res, { success: false, message: 'รหัสผ่านอย่างน้อย 6 ตัว' });

      await supabase.from('users').update({ password: hashPassword(newPassword) }).ilike('username', targetUsername);
      // เตะ session เก่าออก
      await supabase.from('settings').delete().eq('key', `sess_${targetUsername.toLowerCase()}`);

      await logAction(user.username, user.role, 'รีเซ็ตรหัสผ่าน', `รีเซ็ตรหัสผ่านของ @${targetUsername}`);
      return json(res, { success: true });
    }

    // ---------- รีเซ็ตเวลา (ลบ logs วันนี้ + ตั้งนาทีใหม่ได้) ----------
    if (body.action === 'resetTime') {
      const { targetUsername, activityTypes, minutesMap } = body;
      const today = new Date().toISOString().slice(0, 10);
      const allActs = ['break', 'smoking', 'toilet', 'eat', 'assist'];
      const selectedActs = (activityTypes && activityTypes.length) ? activityTypes : allActs;

      // displayType ที่จะลบ
      const delTypes = selectedActs.map(a => TYPE_MAP[a]).filter(Boolean);

      // ดึง displayName
      const { data: u } = await supabase.from('users').select('display_name').ilike('username', targetUsername).single();
      const targetName = u ? u.display_name : targetUsername;

      // 1) ลบ logs วันนี้เฉพาะกิจกรรมที่เลือก
      const { data: deleted } = await supabase.from('logs').delete()
        .ilike('username', targetUsername).eq('log_date', today)
        .in('display_type', delTypes).select();
      const deletedCount = (deleted || []).length;

      // 1.5) โหมดนาที: ใส่รายการใหม่ตามนาทีที่ตั้ง
      let addedEntries = 0;
      if (minutesMap) {
        const nowStr = thaiTimeStr();
        const rows = [];
        for (const act of selectedActs) {
          const mins = parseFloat(minutesMap[act]);
          if (isNaN(mins) || mins <= 0) continue;
          rows.push({
            username: targetUsername, display_name: targetName,
            activity_type: act, display_type: TYPE_MAP[act],
            start_str: nowStr, stop_str: nowStr,
            minutes: Math.round(mins * 100) / 100, log_date: today,
          });
        }
        if (rows.length) {
          await supabase.from('logs').insert(rows);
          addedEntries = rows.length;
        }
      }

      // 2) เคลียร์ running ค้างเฉพาะที่เลือก
      await supabase.from('running').delete()
        .ilike('username', targetUsername).in('activity_type', selectedActs);

      await logAction(user.username, user.role, 'รีเซ็ตเวลา',
        `รีเซ็ตเวลาของ ${targetName} (ลบ ${deletedCount} รายการ${addedEntries ? ', ตั้งใหม่ ' + addedEntries : ''})`);
      return json(res, { success: true, deletedLogs: deletedCount, addedEntries });
    }

    return json(res, { success: false, message: 'unknown action' });
  } catch (e) {
    return json(res, { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message });
  }
}
