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

// ── ทะเบียน "ชื่อ → uid" สำหรับชื่อคนอื่น (เฟส 4 · 2026-09-17) ──────────────
//
// ทำไมต้องมี: wrapper เติม uid ได้เฉพาะ "ชื่อที่เขียน = คนที่กำลังกด"
// แต่คอลัมน์ส่วนใหญ่เก็บ "ชื่อคนอื่น" (ช่างที่มอบหมาย / ผู้อนุมัติ / ผู้ตรวจรับ)
// ⇒ ถ้าไม่ resolve เลย uid เป็น null เกือบทั้งระบบ = งานเฟส 1-3 แทบไม่มีผลกับรายงานจริง
//
// ทำไมไม่ไล่แก้ 91 จุดที่เรียก <PersonSelect> ให้ส่ง res.uid มาเอง:
//   แต่ละจุดต้องแก้ 2 ที่ (onChange + จุดที่ประกอบ payload ส่ง DB) = ~180 จุดแก้มือ
//   บนหน้าที่เป็น workflow หลายขั้น · ตกหล่นที่เดียว = แถวที่ชื่อกับ uid เป็นคนละคน (แย่กว่าไม่มี uid)
//   และจุดที่คน "พิมพ์ชื่อเอง" (allowFree) ก็ยังไม่ได้ uid อยู่ดี
// ⇒ ใช้เกณฑ์เดียวกับ backfill เฟส 3: **จับคู่ชื่อได้ไม่กำกวมเท่านั้นถึงเติม uid**
//   (วัดจริง 17/09: profiles 91 คน → ชื่อ norm ไม่ซ้ำ 90 · ซ้ำ 1 ชื่อ = "ธวัช พิมพ์วงศ์" 2 บัญชี)
//
// 🔴 ชื่อที่ซ้ำ (หลาย uid) → คืน null เสมอ ห้ามเดา — "ไม่รู้" ซื่อสัตย์กว่า "เดาผิด"
// 🔴 ทะเบียนนี้มาจาก `profiles` เท่านั้น — `employees` ที่ไม่มี user ไม่มี uid ให้ผูก (ถูกแล้ว)
// 🔴 ยังไม่โหลด = resolve ไม่ได้ = uid null (พฤติกรรมเดิม) — ห้ามทำให้การเขียนล้ม
const AMBIGUOUS = Symbol('ambiguous')
let _people = new Map()

/**
 * ตั้งทะเบียนคน — เรียกจาก loadProfilesPeople() ทุกครั้งที่โหลด profiles (จุดเดียว)
 * รับ array ของ { id, full_name } · ชื่อซ้ำ → มาร์กกำกวม (resolve ไม่ได้)
 */
export function setPeopleIndex(people) {
  const m = new Map()
  for (const p of people || []) {
    const n = normPersonName(p?.full_name ?? p?.name)
    const uid = p?.id || p?.uid
    if (!n || !uid) continue
    const cur = m.get(n)
    if (cur === undefined) m.set(n, uid)
    else if (cur !== uid) m.set(n, AMBIGUOUS)   // ชื่อซ้ำคนละ uid → ตอบไม่ได้ว่าคนไหน
  }
  _people = m
}

/** ชื่อ → uid · ไม่รู้จัก/ซ้ำ/ยังไม่โหลดทะเบียน → null */
export function resolveUid(name) {
  const n = normPersonName(name)
  if (!n) return null
  const v = _people.get(n)
  return (v === undefined || v === AMBIGUOUS) ? null : v
}

/** ขนาดทะเบียนที่โหลดอยู่ — ไว้เทส/ดีบัก (0 = ยังไม่โหลด) */
export const peopleIndexSize = () => _people.size

/**
 * เติม uid ให้คอลัมน์ "ผู้ทำงานแต่ละขั้น" ในค่าที่กำลังจะเขียนลง DB (pure)
 *
 *   pairs  = [[คอลัมน์ชื่อ, คอลัมน์ uid], ...]  เช่น [['opened_by_name','opened_by_uid']]
 *   values = payload ที่กำลังจะส่ง supabase
 *   actor  = { uid, name } ของคนที่กำลังกด
 *
 * 🔴 กฎความถูกต้องที่ห้ามพลาด — "เขียนชื่อเมื่อไหร่ ต้องเขียน uid ทับด้วยเสมอ"
 *    ถ้าเขียนชื่อใหม่แล้วปล่อย uid เดิมไว้ จะได้ **แถวที่ชื่อเป็นคนหนึ่ง แต่ uid เป็นอีกคน**
 *    (เช่น ช่างซ่อมเปลี่ยนจาก A เป็น B แต่ uid ยังชี้ A ⇒ รายงานนับงานให้ A ทั้งที่ B ทำ)
 *    ซึ่ง **แย่กว่าไม่มี uid เลย** เพราะมันดูน่าเชื่อถือแต่ผิด
 *    ⇒ ชื่อที่ resolve ไม่ได้ → เขียน uid = null (แปลว่า "ไม่รู้" ซึ่งซื่อสัตย์)
 *
 * ลำดับการ resolve (2026-09-17): ตัวเราเอง → ทะเบียนชื่อแบบไม่กำกวม → null
 *
 * เคารพค่าที่หน้าส่งมาเอง: ถ้า payload มีคอลัมน์ uid อยู่แล้ว (มาจาก PersonSelect ที่คืน uid
 * ของคนที่ถูกเลือก) จะไม่ไปแตะ — หน้ารู้ดีกว่าเสมอ
 */
export function applyStepActors(pairs, values, actor) {
  if (!pairs?.length || !values || typeof values !== 'object' || Array.isArray(values)) return values
  const out = { ...values }
  let touched = false
  for (const [nameCol, uidCol] of pairs) {
    if (!(nameCol in out)) continue     // รอบนี้ไม่ได้เขียนคอลัมน์นี้ → ไม่ยุ่ง
    if (uidCol in out) continue         // หน้าส่ง uid มาเอง → เคารพ
    const v = out[nameCol]
    const isMe = !!actor?.uid && !!v && samePerson({ name: v }, { name: actor?.name })
    // ลำดับ: ตัวเราเอง → ทะเบียนชื่อ (ไม่กำกวม) → null (ไม่รู้)
    out[uidCol] = isMe ? actor.uid : resolveUid(v)
    touched = true
  }
  return touched ? out : values
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
