// ============================================================
// api/ping.js — keep-alive (ตรวจว่า server ออนไลน์)
// ============================================================
export default async function handler(req, res) {
  res.status(200).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: true, pong: Date.now() }));
}
