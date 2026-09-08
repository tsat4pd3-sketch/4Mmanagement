/* ── useColumnHistory — "ค่าที่เคยบันทึกไว้" ของคอลัมน์หนึ่ง สำหรับป้อน picker เป็นกลุ่ม 📜 ──
   (2026-09-07 · คำสั่ง user: "ถ้าข้อมูลจะไม่มี[ในทะเบียน] ใช้ข้อมูลที่เคยลงไว้ได้มั้ย")

   picker กลางบังคับเลือกจากทะเบียน แต่ของจริงมีค่าที่บันทึกมาก่อนทะเบียนจะครบ (เครื่องที่ยังไม่ลง
   /machines · MAT เก่าที่ Product Master ยังไม่มี · ชื่อคนที่พิมพ์มาก่อน) — ห้ามล้าง/บล็อกเงียบ
   → หน้าโหลด distinct ของคอลัมน์ปลายทางผ่าน hook นี้ แล้วส่งเข้า picker เป็น `history`
     picker แสดงเป็นกลุ่ม "📜 เคยบันทึกไว้ (ไม่มีในทะเบียน)" เลือกได้ + ติดป้าย ⚠ ให้เห็นว่านอกทะเบียน

   ⚠️ best-effort: อ่านล่าสุด `limit` แถวแล้ว dedupe ฝั่ง client (PostgREST ไม่มี distinct) · cache ร่วม
   ผ่าน masterCache · คิวรีล้ม = คืน [] (ไม่ทำให้ picker พัง) */
import { useEffect, useState } from 'react';
import { cachedMaster, invalidateMaster } from './masterCache';

const norm = (v) => String(v ?? '').trim();

/**
 * @param {object} client   supabase หรือ supabaseDR (ตารางอยู่ project ไหน)
 * @param {string} table
 * @param {string} column
 * @param {{ limit?: number, upper?: boolean, enabled?: boolean }} opt
 */
export async function loadColumnHistory(client, table, column, { limit = 3000, upper = false } = {}) {
  const key = `hist:${table}.${column}`;
  return cachedMaster(key, async () => {
    const r = await client.from(table).select(column).not(column, 'is', null).limit(limit);
    if (r.error) return [];
    const seen = new Set(); const out = [];
    for (const row of r.data || []) {
      const v = norm(row[column]); if (!v) continue;
      const k = upper ? v.toUpperCase() : v;
      if (seen.has(k)) continue; seen.add(k); out.push(upper ? k : v);
    }
    return out.sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  });
}
export const invalidateColumnHistory = (table, column) => invalidateMaster(`hist:${table}.${column}`);

export default function useColumnHistory(client, table, column, { enabled = true, limit = 3000, upper = false } = {}) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!enabled || !client || !table || !column) return undefined;
    let alive = true;
    loadColumnHistory(client, table, column, { limit, upper }).then(d => { if (alive) setRows(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, [client, table, column, enabled, limit, upper]);
  return rows;
}
