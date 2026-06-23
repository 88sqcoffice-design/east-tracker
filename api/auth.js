// ============================================================
// api/auth.js — login / register / logout
// เรียก: POST /api/auth  body: { action, username, password, ... }
// ============================================================
import { supabase, hashPassword, makeToken, getUserByToken, isSuperAdmin, logAction, json } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, { success: false, message: 'POST only' }, 405);
  const body = req.body || {};
  const action = body.action;

  try {
    // ---------- LOGIN ----------
    if (action === 'login') {
      const { username, password } = body;
      if (!username || !password) return json(res, { success: false, message: 'กรอกข้อมูลให้ครบ' });

      const { data: user } = await supabase.from('users').select('*').ilike('username', username).single();
      if (!user || user.password !== hashPassword(password)) {
        return json(res, { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
      }

      // สร้าง token + เก็บเป็น session (เครื่องใหม่ login → เครื่องเก่าหลุด)
      const token = makeToken(user.username);
      await supabase.from('settings').upsert({
        key: `sess_${user.username.toLowerCase()}`, value: token,
      });

      return json(res, {
        success: true,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        token,
      });
    }

    // ---------- REGISTER (ลงทะเบียนผู้ใช้ใหม่) ----------
    if (action === 'register') {
      const { username, password, displayName, role, adminToken } = body;
      if (!username || !password || !displayName) return json(res, { success: false, message: 'กรอกข้อมูลให้ครบ' });
      if (password.length < 6) return json(res, { success: false, message: 'รหัสผ่านอย่างน้อย 6 ตัว' });
      if (!/^[a-zA-Z0-9_]+$/.test(username)) return json(res, { success: false, message: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 _' });

      // role จะถูกตั้งได้เฉพาะ superadmin (ถ้าลงทะเบียนเอง → employee)
      let finalRole = 'employee';
      if (role && role !== 'employee') {
        const admin = await getUserByToken(adminToken);
        if (isSuperAdmin(admin)) finalRole = role;
      }

      // เช็คซ้ำ
      const { data: exist } = await supabase.from('users').select('id').ilike('username', username).single();
      if (exist) return json(res, { success: false, message: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });

      const { error } = await supabase.from('users').insert({
        username, password: hashPassword(password), display_name: displayName, role: finalRole,
      });
      if (error) return json(res, { success: false, message: error.message });

      return json(res, { success: true, message: 'สร้างบัญชีสำเร็จ' });
    }

    // ---------- LOGOUT ----------
    if (action === 'logout') {
      const { username } = body;
      if (username) {
        await supabase.from('settings').delete().eq('key', `sess_${String(username).toLowerCase()}`);
      }
      return json(res, { success: true });
    }

    // ---------- VALIDATE SESSION (เช็ค token ยังใช้ได้ไหม) ----------
    if (action === 'validate') {
      const user = await getUserByToken(body.token);
      if (!user) return json(res, { valid: false, expired: true });
      return json(res, { valid: true, role: user.role });
    }

    // ---------- RESET PASSWORD ตัวเอง (self-service ที่หน้า login) ----------
    if (action === 'resetPasswordSelf') {
      const { username, newPassword } = body;
      if (!username || !newPassword) return json(res, { success: false, message: 'กรอกข้อมูลให้ครบ' });
      if (newPassword.length < 6) return json(res, { success: false, message: 'รหัสผ่านอย่างน้อย 6 ตัว' });

      const { data: user } = await supabase.from('users').select('id').ilike('username', username).single();
      if (!user) return json(res, { success: false, message: 'ไม่พบชื่อผู้ใช้นี้' });

      await supabase.from('users').update({ password: hashPassword(newPassword) }).ilike('username', username);
      await supabase.from('settings').delete().eq('key', `sess_${username.toLowerCase()}`);
      return json(res, { success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
    }

    return json(res, { success: false, message: 'unknown action' });
  } catch (e) {
    return json(res, { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message });
  }
}
