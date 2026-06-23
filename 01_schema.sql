-- ============================================================
-- EAST TIME TRACKER — Supabase Schema
-- รันใน Supabase: SQL Editor → New query → วางทั้งหมด → Run
-- ============================================================

-- ลบตารางเก่า (ถ้ารันซ้ำ) — ระวัง! ลบข้อมูลทั้งหมด
-- drop table if exists activity_log, force_stop_log, running, logs, settings, users cascade;

-- ------------------------------------------------------------
-- 1. users — บัญชีผู้ใช้ (จาก USERS sheet)
-- ------------------------------------------------------------
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  username      text unique not null,
  password      text not null,                    -- SHA-256 hash (เหมือนระบบเดิม)
  display_name  text not null,
  role          text not null default 'employee', -- superadmin/admin/monitor/employee
  created_at    timestamptz default now()
);
create index if not exists idx_users_username on users(lower(username));

-- ------------------------------------------------------------
-- 2. logs — ประวัติกิจกรรม (จาก LOGS sheet) ⭐ ตารางหลัก
-- ------------------------------------------------------------
create table if not exists logs (
  id            bigserial primary key,
  username      text not null,
  display_name  text,
  activity_type text not null,                    -- break/smoking/toilet/eat/assist
  display_type  text,                             -- พักเบรค/สูบบุหรี่/เข้าห้องน้ำ/ซื้อ-กินข้าว/ช่วยงานบริษัท
  start_time    timestamptz,                      -- (สำรอง) ไม่ใช้แสดงผล
  stop_time     timestamptz,
  start_str     text,                             -- เวลาเริ่ม HH:mm:ss (ตรงกับ frontend)
  stop_str      text,                             -- เวลาหยุด HH:mm:ss
  minutes       numeric,
  log_date      date not null default current_date, -- วันที่ (สำหรับ query โควต้าเร็ว)
  created_at    timestamptz default now()
);
create index if not exists idx_logs_user_date on logs(lower(username), log_date);
create index if not exists idx_logs_date on logs(log_date);
create index if not exists idx_logs_created on logs(created_at desc);

-- ------------------------------------------------------------
-- 3. running — กิจกรรมที่กำลังทำ (จาก RUNNING sheet)
--    unique constraint = กันหยุดซ้ำที่ database level!
-- ------------------------------------------------------------
create table if not exists running (
  id              bigserial primary key,
  username        text not null,
  display_name    text,
  activity_type   text not null,
  start_ms        bigint,
  start_str       text,
  notified_limit  boolean default false,
  notified_admin  boolean default false,
  created_at      timestamptz default now(),
  unique(lower(username), activity_type)          -- 1 คน 1 กิจกรรม ห้ามซ้ำ
);

-- ------------------------------------------------------------
-- 4. settings — ค่าตั้งค่าระบบ (จาก SETTINGS sheet)
-- ------------------------------------------------------------
create table if not exists settings (
  key         text primary key,
  value       text,
  updated_at  timestamptz default now()
);

-- ------------------------------------------------------------
-- 5. force_stop_log — ประวัติการกดหยุดให้คนอื่น (จาก FORCE_STOP_LOG sheet)
-- ------------------------------------------------------------
create table if not exists force_stop_log (
  id            bigserial primary key,
  stopper_user  text,
  stopper_role  text,
  target_user   text,
  target_name   text,
  display_type  text,
  start_str     text,
  stop_str      text,
  minutes       numeric,
  log_date      date not null default current_date,
  created_at    timestamptz default now()
);
create index if not exists idx_fsl_target on force_stop_log(lower(target_user), log_date);

-- ------------------------------------------------------------
-- 6. activity_log — ประวัติทุกการกระทำ (กระดิ่ง 🔔) (จาก ACTIVITY_LOG sheet)
-- ------------------------------------------------------------
create table if not exists activity_log (
  id          bigserial primary key,
  actor       text,
  role        text,
  type        text,
  detail      text,
  created_at  timestamptz default now()
);
create index if not exists idx_activity_log_date on activity_log(created_at desc);

-- ============================================================
-- ค่าเริ่มต้น (โควต้า/limit) — เก็บใน settings เผื่อปรับภายหลัง
-- ============================================================
insert into settings (key, value) values
  ('quota_shared_min', '90'),
  ('quota_break_min', '120'),
  ('limit_smoking_min', '20'),
  ('limit_toilet_min', '20'),
  ('limit_eat_min', '20')
on conflict (key) do nothing;

-- ============================================================
-- บัญชี admin ชุดแรก (เปลี่ยนรหัสผ่านหลัง login!)
-- รหัส 'admin123' → SHA-256 hash ด้านล่าง
-- ============================================================
insert into users (username, password, display_name, role) values
  ('admin',
   '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',  -- admin123
   'ผู้ดูแลระบบ',
   'superadmin')
on conflict (username) do nothing;

-- ============================================================
-- เสร็จ! ตรวจสอบ: Table Editor ควรเห็น 6 ตาราง
-- ============================================================
