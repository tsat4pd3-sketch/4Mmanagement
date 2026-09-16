// ═══ actorStamp — เจ้าของเดียวของคำตอบ "ใครเป็นคนทำรายการนี้" (2026-09-16) ═══════════════
//
// ทำอะไร: เก็บตัวตนผู้ใช้ปัจจุบัน (uid + ชื่อ) ไว้จุดเดียว แล้วแจกให้ทุกจุดที่ต้อง stamp ลง DB
//          + ฟังก์ชัน pure สำหรับ "เทียบว่าชื่อสองอันคือคนเดียวกันไหม"
//
// ใครใช้: - src/supabaseClient.js (wrapper ฝั่ง DR — stamp อัตโนมัติทุก insert/update/upsert)
//         - หน้าที่เขียนคอลัมน์ผู้ทำงานเอง (ช่างซ่อม/ผู้อนุมัติ/ผู้จ่ายของ) ผ่าน actorFields()
//         - รายงานที่ต้องนับ "คนทำจริงกี่คน" ผ่าน personKey()
//
// ── ทำไมต้องมีไฟล์นี้ (เคสจริง 2026-09-16) ────────────────────────────────────────────────
// เดิมชื่อคนถูกเก็บเป็น text ล้วนไม่ผูกรหัสอะไร และมีทะเบียนคนหลายชุดที่พิมพ์มือแยกกัน
// ⇒ คนเดียวกันกลายเป็นหลายคนในรายงาน:
//     profiles/employees          mtn_technicians (พิมพ์มือ)
//     "อภิสิทธิ์ จำปาต้า"    vs   "นายอภิสิทธิ์ จำปาต้น"
//     "ณัฐภัทร ฐานันต๊ะ"     vs   "นายณัฐภัทร  ถานันต๊ะ"
// ⇒ ตอบไม่ได้ว่างานหนึ่งมีคนทำจริงกี่คน และคนหนึ่งแตะงานอะไรบ้าง
//
// ── ข้อจำกัดที่ต้องรู้ ────────────────────────────────────────────────────────────────────
// 🔴 uid ฝั่ง DR **ไม่ใช่หลักฐานที่ verify ฝั่ง server ได้** — supabaseDR เป็น anon เสมอ
//    (ไม่มี JWT ให้ตรวจ) uid ถูกส่งมาจาก client เหมือน updated_by_name ที่ทำมาตั้งแต่ 2026-07-24
//    มันคือ "คีย์สำหรับนับ/join" ไม่ใช่ "ลายเซ็นดิจิทัล" — ถ้าต้องการหลักฐานที่ปลอมไม่ได้
//    ต้องผ่าน Edge Function ที่ validate ฝั่ง server (known gap เดิมของ DR — ดู CLAUDE.md)
//
// 🔴 ห้ามเอา normPersonName() ไปเขียนทับข้อมูลใน DB — มันใช้ "เทียบ" เท่านั้น
//    ชื่อที่เก็บในแถวคือ snapshot ณ วันที่ทำงาน ต้องไม่เปลี่ยนตามการแก้ profiles ภายหลัง
//    (หลักเดียวกับ line_name / emp_name snapshot ทั้งระบบ)
//
// 🔴 normPersonName ไม่แก้ "สะกดผิด" ให้ (ฐานันต๊ะ vs ถานันต๊ะ) โดยตั้งใจ —
//    การตัดสินว่าสองชื่อนี้คือคนเดียวกันเป็น **การตัดสินใจของคน** ไม่ใช่ของระบบ
//    (ENGINEERING-PRINCIPLES §2: ห้ามให้ระบบเดาแล้วเขียนข้อมูลแทนคน — ให้เตือนบนจอแทน)
//    มันจัดการได้แค่ความต่างเชิงกลไก: ช่องว่างซ้ำ · คำนำหน้า · ช่องว่างหัวท้าย · zero-width

// ── ตัวตนผู้ใช้ปัจจุบัน ────────────────────────────────────────────────────────────────────
let _actor = { uid: null, name: null }

/** ตั้งตัวตนผู้ใช้ — เรียกจาก App.jsx ตอนรู้โปรไฟล์ · ส่ง (null, null) ตอน logout */
export function setActor(uid, name) {
  _actor = { uid: uid || null, name: name || null }
}

/** ตัวตนปัจจุบัน { uid, name } — คืน object ใหม่เสมอ กันการแก้จากภายนอก */
export function getActor() {
  return { ..._actor }
}

/**
 * คืนคู่คอลัมน์สำหรับ stamp ลงแถว
 *   actorFields()            → { updated_by_name, updated_by_uid }
 *   actorFields('opened_by') → { opened_by_name, opened_by_uid }
 * ไม่มีตัวตน (ยังไม่ login) → คืน {} เพื่อไม่ไปทับค่าเดิมในแถวด้วย null
 */
export function actorFields(prefix = 'updated_by') {
  if (!_actor.name && !_actor.uid) return {}
  const out = {}
  if (_actor.name) out[`${prefix}_name`] = _actor.name
  if (_actor.uid) out[`${prefix}_uid`] = _actor.uid
  return out
}

// ── เทียบชื่อคน (pure — มีเทสใน __tests__/actorStamp.test.mjs) ───────────────────────────
const TITLE_RE = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i

/**
 * ทำให้ชื่อ "เทียบกันได้" — สำหรับจับคู่/นับคนเท่านั้น ห้ามใช้แสดงผลหรือเขียนลง DB
 * จัดการเฉพาะความต่างเชิงกลไกที่ไม่ใช่การตัดสินใจของคน:
 *   "  นายอภิสิทธิ์   จำปาต้น " → "อภิสิทธิ์ จำปาต้น"
 *   "ฉัตรชัย  ใจรักเรียน"       → "ฉัตรชัย ใจรักเรียน"   (ช่องว่างซ้ำ — เคสจริงใน employees)
 * ⚠️ "จำปาต้น" กับ "จำปาต้า" ยังคงเป็นคนละค่า (สะกดต่างจริง = คนต้องตัดสิน)
 */
export function normPersonName(s) {
  if (s == null) return ''
  return String(s)
    .replace(/[​-‍﻿]/g, '')  // zero-width ที่ติดมาจากการก๊อปจาก Excel
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TITLE_RE, '')
    .trim()
}

/**
 * คีย์สำหรับ "นับคน" ในรายงาน — uid ชนะชื่อเสมอ
 * มี uid  → 'u:<uid>'        (เชื่อถือได้ · คนละคนแน่นอนถ้าคีย์ต่าง)
 * ไม่มี   → 'n:<ชื่อ norm>'  (ค่าประมาณ · สะกดต่างยังนับเป็นคนละคน)
 * ไม่มีทั้งคู่ → '' (ผู้เรียกต้องตัดทิ้งเอง ห้ามนับเป็นคนหนึ่ง)
 */
export function personKey(uid, name) {
  if (uid) return `u:${String(uid).trim().toLowerCase()}`
  const n = normPersonName(name)
  return n ? `n:${n}` : ''
}

/** สองรายการนี้คือคนเดียวกันไหม (ใช้ personKey เป็นเกณฑ์) */
export function samePerson(a, b) {
  const ka = personKey(a?.uid, a?.name)
  const kb = personKey(b?.uid, b?.name)
  return !!ka && ka === kb
}

/**
 * นับ "คนทำจริงกี่คน" จากรายการงาน + บอกว่าเชื่อถือได้แค่ไหน
 * คืน { people, byUid, byName } — byName > 0 แปลว่ายังมีรายการที่ผูก uid ไม่ได้
 * ⇒ หน้าจอต้องเขียนกำกับว่าตัวเลขนี้เป็นค่าประมาณ (ห้ามโชว์เฉยๆ เหมือนเป็นค่าจริง)
 */
export function countPeople(rows, getUid, getName) {
  const keys = new Set(); let byUid = 0; let byName = 0
  for (const r of rows || []) {
    const uid = getUid?.(r); const name = getName?.(r)
    const k = personKey(uid, name)
    if (!k) continue
    if (!keys.has(k)) { keys.add(k); if (k.startsWith('u:')) byUid++; else byName++ }
  }
  return { people: keys.size, byUid, byName }
}
