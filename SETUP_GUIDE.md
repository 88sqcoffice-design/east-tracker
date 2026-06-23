# 🚀 คู่มือติดตั้ง EAST TIME TRACKER (Supabase + Vercel)

คู่มือจับมือทำทีละขั้น — ทำตามลำดับ ไม่ต้องข้าม

---

## 📦 สิ่งที่ได้ในชุดนี้

```
migration/
├── 01_schema.sql          ← SQL สร้างตาราง (รันใน Supabase)
├── api/
│   ├── _lib/supabase.js   ← เชื่อมต่อ + helper
│   ├── auth.js            ← login / register / logout
│   ├── activity.js        ← start / stop / quota / todayLogs / running
│   ├── reports.js         ← daily / range / userDetail / deleteEntry
│   ├── staff.js           ← list / setRole / deleteUser / resetPassword / resetTime
│   ├── live.js            ← getLive / forceStop / discard
│   ├── bell.js            ← getActionLog (กระดิ่ง)
│   └── settings.js        ← Telegram / ธีม / รูป
├── public/                ← วาง index.html ที่นี่ (ภายหลัง)
├── package.json
├── vercel.json
└── .env.example
```

> **✅ API ครบทั้งหมดแล้ว** (25 actions ครอบคลุม 27 ฟังก์ชันเดิม) — พร้อม deploy
> ขั้นต่อไปคือเชื่อม Index.html (เปลี่ยน google.script.run → fetch)

## 🔌 API ทั้งหมด (เทียบกับระบบเดิม)

| ไฟล์ | actions | แทนฟังก์ชันเดิม |
|---|---|---|
| **auth.js** | login, register, logout | login, registerUser, logout |
| **activity.js** | start, stop, quota, todayLogs, running | notifyStartActivity, logActivity, getQuotaUsage, getTodayLogs, getRunningActivities |
| **reports.js** | daily, range, userDetail, deleteEntry | getAdminDailyReport, getAdminRangeReport, getUserDayDetail, deleteLogEntry |
| **staff.js** | list, setRole, deleteUser, resetPassword, resetTime | getStaffList, setUserRole, deleteUser, resetUserPassword, resetUserTime |
| **live.js** | getLive, forceStop, discard | getLiveActivities, adminForceStop, adminDiscardActivity |
| **bell.js** | getActionLog | getActionLog |
| **settings.js** | getTelegram, setTelegram, testTelegram, setBackground, setTextColors, setPopupImages, getAll | getTelegramSettingsForAdmin, setTelegramSettings, testTelegramSend, setDefaultBackground, setDefaultTextColors, setDefaultPopupImages |

---

## STEP 1 — สมัคร Supabase + สร้างตาราง (15 นาที)

### 1.1 สมัคร
1. ไปที่ https://supabase.com → **Start your project**
2. login ด้วย GitHub (หรือ email)
3. **New Project** → ตั้งชื่อ `east-tracker`
4. ตั้ง **Database Password** (จดไว้!)
5. เลือก Region: **Southeast Asia (Singapore)** ← ใกล้ไทยสุด
6. รอ ~2 นาที (สร้าง database)

### 1.2 สร้างตาราง
1. เมนูซ้าย → **SQL Editor** → **New query**
2. เปิดไฟล์ `01_schema.sql` → คัดลอกทั้งหมด → วาง
3. กด **Run** (มุมขวาล่าง)
4. ✅ เห็น "Success" = เสร็จ

### 1.3 ตรวจสอบ
- เมนูซ้าย → **Table Editor**
- ควรเห็น **6 ตาราง**: users, logs, running, settings, force_stop_log, activity_log
- คลิก `users` → เห็นบัญชี `admin` 1 รายการ ✅

---

## STEP 2 — เก็บ Key ของ Supabase (5 นาที)

1. เมนูซ้าย → **Project Settings** (เฟือง) → **API**
2. คัดลอก 2 ค่านี้ไว้:
   - **Project URL** (เช่น `https://xxxxx.supabase.co`)
   - **service_role** key (ใต้ "Project API keys" — กด reveal)

> ⚠️ **service_role key เป็นความลับ!** อย่าใส่ในโค้ดฝั่ง frontend หรือ push ขึ้น GitHub

---

## STEP 3 — Deploy ขึ้น Vercel (15 นาที)

### 3.1 เตรียมโค้ด
1. สร้าง repo ใหม่บน GitHub → upload โฟลเดอร์ `migration/` ทั้งหมด
   - (หรือใช้ Vercel CLI ก็ได้)

### 3.2 สมัคร + เชื่อม
1. ไปที่ https://vercel.com → login ด้วย GitHub
2. **Add New → Project** → เลือก repo ที่เพิ่ง upload
3. **Environment Variables** → เพิ่ม 2 ตัว:
   ```
   SUPABASE_URL         = (Project URL จาก Step 2)
   SUPABASE_SERVICE_KEY = (service_role key จาก Step 2)
   ```
4. กด **Deploy** → รอ ~1 นาที
5. ได้ URL: `https://east-tracker-xxx.vercel.app` ✅

---

## STEP 4 — ทดสอบ API (5 นาที)

เปิด terminal แล้วทดสอบ login (แทน URL ด้วยของคุณ):

```bash
curl -X POST https://east-tracker-xxx.vercel.app/api/auth \
  -H "Content-Type: application/json" \
  -d '{"action":"login","username":"admin","password":"admin123"}'
```

**ควรได้:**
```json
{"success":true,"username":"admin","role":"superadmin","token":"admin:xxx"}
```

✅ ถ้าได้แบบนี้ = backend ทำงานแล้ว!

---

## STEP 5 — ทดสอบกิจกรรม + กันซ้ำ (5 นาที)

ใช้ token จาก Step 4:

```bash
# เริ่มกิจกรรม
curl -X POST .../api/activity \
  -d '{"action":"start","token":"YOUR_TOKEN","activityType":"smoking","startStr":"14:00:00"}'

# หยุดกิจกรรม
curl -X POST .../api/activity \
  -d '{"action":"stop","token":"YOUR_TOKEN","activityType":"smoking","startStr":"14:00:00","durationSec":300}'

# ลองหยุดซ้ำ → ควรได้ alreadyLogged (กันซ้ำ!)
curl -X POST .../api/activity \
  -d '{"action":"stop","token":"YOUR_TOKEN","activityType":"smoking","startStr":"14:00:00","durationSec":300}'
```

✅ หยุดครั้งแรก = success, ครั้งที่ 2 = `alreadyLogged` → **กันซ้ำได้ที่ database!**

---

## ✅ เช็คพอยต์ Phase 1-2

เมื่อทำถึงตรงนี้ คุณมี:
- ✅ Database พร้อม (6 ตาราง)
- ✅ Backend บน Vercel (auth + กิจกรรม + โควต้า)
- ✅ login ได้
- ✅ เริ่ม/หยุดกิจกรรมได้ + กันซ้ำที่ database

---

## 📋 ขั้นต่อไป

- [x] ~~API ทั้งหมด~~ ✅ เสร็จแล้ว (auth, activity, reports, staff, live, bell, settings)
- [ ] **เชื่อม Index.html** (เปลี่ยน google.script.run → fetch) ← ขั้นต่อไป
- [ ] ทดสอบทุกหน้า (พนักงาน/monitor/admin/superadmin)
- [ ] ทดสอบโหลด (จำลองคนเยอะ)
- [ ] สลับใช้งานจริง

---

## 🆘 ปัญหาที่พบบ่อย

**login ไม่ได้ (500):** เช็ค Environment Variables ใน Vercel + service_role key ครบไหม
**"relation does not exist":** ยังไม่ได้รัน 01_schema.sql
**CORS error:** ปกติไม่มี (frontend+API domain เดียวกัน)

---

*ทำทีละ STEP ไม่ต้องรีบ — ติดตรงไหนถามได้*
