// ============================================================
// api/bell.js — กระดิ่งแจ้งเตือน (ดึงประวัติการกระทำ)
// เรียก: POST /api/bell  body: { action, token, limit }
// (Admin level เท่านั้น)
// ============================================================
import { supabase, getUserByToken, isAdminOrMonitor, json } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, { success: false, message: 'POST only' }, 405);
  const body = req.body || {};
  const user = await getUserByToken(body.token);
  if (!user) return json(res, { success: false, expired: true });
  if (!isAdminOrMonitor(user)) return json(res, { success: false, message: 'เฉพาะผู้ดูแลระบบ' });

  try {
    if (body.action === 'getActionLog') {
      const limit = body.limit || 50;
      const { data } = await supabase.from('activity_log').select('*')
        .order('created_at', { ascending: false }).limit(limit);
      const items = (data || []).map(r => {
        const dt = new Date(r.created_at);
        return {
          date: dt.toLocaleDateString('th-TH'),
          time: dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          actor: r.actor, role: r.role, type: r.type, detail: r.detail,
          ms: dt.getTime(),
        };
      });
      return json(res, { success: true, items });
    }
    return json(res, { success: false, message: 'unknown action' });
  } catch (e) {
    return json(res, { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message });
  }
}
