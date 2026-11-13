/* ══ 🪪 บัญชีไหน "ยังไม่รู้ว่าเป็นใคร" — ตัวจัดคิวกลาง (pure · 2026-10-19 · คำสั่ง user) ═══════
 *
 * โจทย์: *"จอบัญชีที่ยังไม่ผูกพนักงาน 49/122"*
 *
 * 🔍 **วัดฐานจริงก่อนทำ (19/10 · ฝั่ง Main) — ตัวเลข 49 เป็นการนับที่หยาบเกินไป:**
 *   | ประเภทบัญชี | ทั้งหมด | ไม่ได้ผูกพนักงาน | แปลว่า |
 *   |---|---|---|---|
 *   | `person` (บัญชีของคน) | 73 | **0** | ✅ ผูกครบแล้วทุกใบ |
 *   | `shared` (จอ TV / ประจำเครื่อง) | 31 | 31 | ✅ **ถูกต้องแล้ว — ไม่ใช่งานค้าง** (ไม่มีตัวตนให้ผูก) |
 *   | `null` (ยังไม่ระบุประเภท) | 18 | 18 | 🔴 **งานค้างตัวจริง** |
 *   ⇒ **ของจริงคือ 18 ไม่ใช่ 49** · และงานไม่ใช่ "ผูกให้ครบ" แต่คือ **"ตัดสินว่าบัญชีนี้คืออะไร"**
 *
 * 🔴 **ทำไม "จับคู่ชื่ออัตโนมัติ" แก้ไม่ได้** (วัด 18 ใบนั้นเทียบกับ `employees` active):
 *   ชื่อตรงกันเลย **1 ใบ** · ชื่อต้นตรงแต่นามสกุลต่าง 2 ใบ (ซึ่ง**อาจเป็นคนละคน**) · **ไม่เจออะไรเลย 15 ใบ**
 *   เพราะคนกลุ่มนี้คือ **หัวหน้าแผนก/ผจก./วิศวกร/ธุรการ/เลขา** ที่**ไม่เคยอยู่ในทะเบียนพนักงานหน้าไลน์**
 *   ⇒ ปลายทางมี **3 ทาง ไม่ใช่ทางเดียว**: ผูกกับคนที่มีอยู่ · เพิ่มเข้าฐานพนักงานก่อนแล้วผูก · เป็นบัญชีกลาง
 *
 * 🔴 **ห้ามให้ระบบเดาประเภทบัญชีเอง** (กฎเดิมที่เขียนไว้ที่จอ `/add-user` แล้ว) —
 *    "บัญชีนี้เป็นของคนหรือของหน่วยงาน" คนตัดสิน · ไฟล์นี้**จัดคิว + เสนอตัวเลือก** ไม่ตัดสินแทน
 *
 * 🔴 **ทำไมต้องผูก:** ตัวตน (ทีม/ไลน์/ส่วนงาน) อ่านด้วยสูตร `emp.<f> ?? profile.<f>` (`App.jsx`)
 *    ⇒ ยังไม่ผูก = ใช้ค่าที่แอดมินกรอกไว้ในบัญชี ซึ่ง**เพี้ยนเงียบ** (เคสจริง: หัวหน้า 2 คนทีมสลับกัน
 *    แล้วเปิดจอเช็คชื่อไม่เห็นกะตัวเอง) · คู่กับ `identitySync.js` ที่ดูแล "ผูกแล้วแต่ค่าไม่ตรง"
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
import { normSearch } from './thaiText.js';   // .js เพื่อให้ node:test resolve ได้ (bundler ไม่สน)

/** ชื่อต้น (คำแรก) หลัง normalize — ต้องตัดคำ**ก่อน** normalize เพราะ `normSearch` กินช่องว่างทิ้ง */
const firstTok = (s) => normSearch(String(s ?? '').trim().split(/\s+/)[0] || '');

/**
 * คนในทะเบียนที่ "น่าจะเป็นคนเดียวกัน" กับบัญชีนี้ — เรียงจากมั่นใจมากไปน้อย
 *
 * คืน `{ tier, rows, confident }`
 *   · `tier='name'`  ชื่อตรงกันหลัง normalize (ต่างแค่ช่องว่าง/วรรณยุกต์/ทัณฑฆาต) — ใช้ผูกได้
 *   · `tier='first'` ชื่อต้นตรง นามสกุลต่าง — **โชว์ให้คนเลือก ห้ามผูกให้เอง**
 *   · `tier=null`    ไม่เจอ ⇒ คนนี้ยังไม่อยู่ในทะเบียนพนักงาน
 *   · `confident`    true เฉพาะ **tier='name' และเจอคนเดียว** ⇒ จอมีปุ่มผูกคลิกเดียวได้
 *
 * 🔴 **ชื่อตรงกันแต่เจอหลายคน = ห้ามเดา** (ชื่อซ้ำมีจริงในโรงงาน) ⇒ `confident=false`
 * 🔴 **ห้ามไล่ลงไปถึงชั้น "นามสกุลคล้ายกัน"** — ผูกผิดคนแก้ยากกว่าไม่ผูก
 *    (คะแนนทักษะ/ลายเซ็น/กะ จะไปเกาะคนผิดแล้วไม่มีใครรู้)
 */
export function employeeCandidates(profile, employees = [], { limit = 5, takenBy = null } = {}) {
  const none = { tier: null, rows: [], confident: false };
  const full = normSearch(profile?.full_name);
  if (!full) return none;
  const live = (employees || []).filter(e => e && e.name && e.is_active !== false);
  /* 🔴 พนักงาน 1 คนผูกได้บัญชีเดียว (unique `profiles_employee_id_uniq`)
     ⇒ คนที่ถูกจองแล้ว **ต้องยังโชว์** (ซ่อน = จอบอก "ไม่มีชื่อนี้ในทะเบียน" ซึ่งไม่จริง)
       แต่ต้องติดป้ายว่าใครถืออยู่ และห้ามนับเป็น "ผูกได้เลย" */
  const mark = (e) => (takenBy?.get?.(e.id) ? { ...e, takenByName: takenBy.get(e.id) } : e);
  const freeOnly = (rows) => rows.filter(e => !takenBy?.get?.(e.id));

  const same = live.filter(e => normSearch(e.name) === full);
  if (same.length) {
    const free = freeOnly(same);
    return { tier: 'name', rows: same.slice(0, limit).map(mark), confident: free.length === 1 && same.length === 1 };
  }

  const ft = firstTok(profile?.full_name);
  if (!ft) return none;
  const first = live.filter(e => firstTok(e.name) === ft);
  return first.length ? { tier: 'first', rows: first.slice(0, limit).map(mark), confident: false } : none;
}

/** พนักงานคนไหนถูกบัญชีไหนจองไว้แล้ว — `Map<employee_id, ชื่อบัญชีที่ถือ>` */
export function takenEmployeeMap(users = []) {
  const m = new Map();
  for (const u of users || []) {
    if (u?.employee_id) m.set(u.employee_id, u.full_name || u.email || '(ไม่มีชื่อ)');
  }
  return m;
}

/**
 * แยกบัญชีทั้งหมดเป็น 3 กอง — **ตัวเลขที่จอต้องพูดให้ตรง**
 *   · `queue`         ยังไม่ระบุประเภท (`account_kind` ว่าง) = **คิวงานจริง** (พร้อมตัวเลือกที่เจอ)
 *   · `personUnlinked` ติดป้ายว่าเป็นบัญชีของคน แต่ยังไม่ผูกตัวตน = **ควรเป็น 0** (มี = ตกค้าง/บั๊ก)
 *   · `sharedOk`      บัญชีกลาง = **ถูกต้องแล้ว ห้ามนับเป็นงานค้าง**
 * 🔴 เอา 3 กองมารวมเป็นเลขเดียว ("49 บัญชีไม่ผูกพนักงาน") = จอโกหก — 31 ใบในนั้นถูกต้องอยู่แล้ว
 */
export function unlinkedTriage(users = [], employees = []) {
  const queue = [], personUnlinked = [], sharedOk = [];
  const takenBy = takenEmployeeMap(users);   // 🔴 ไม่ส่ง = จอเสนอให้ผูกคนที่ถูกจองแล้ว → ชน unique แน่นอน
  (users || []).forEach((u) => {
    if (!u) return;
    const kind = String(u.account_kind || '').trim();
    if (kind === 'shared') { sharedOk.push(u); return; }
    if (kind === 'person') {
      if (!u.employee_id) personUnlinked.push({ u, ...employeeCandidates(u, employees, { takenBy }) });
      return;
    }
    queue.push({ u, ...employeeCandidates(u, employees, { takenBy }) });
  });
  return { queue, personUnlinked, sharedOk };
}

/** ป้ายบอก "ทางไปต่อ" ของแถวในคิว — ข้อความอยู่ที่นี่ที่เดียว จอไม่ต้องคิดเอง */
export function routeHint({ tier, confident, rows = [] } = {}) {
  if (confident) return { key: 'link_one', text: 'เจอชื่อตรงกันคนเดียว — ผูกได้เลย' };
  /* 🔴 ชื่อตรงแต่ถูกบัญชีอื่นจองหมดแล้ว — ต้องบอกว่าใครถือ ไม่ใช่ปล่อยให้กดแล้วเด้ง error ดิบ
     (เคสจริง 28/10: "ธวัช พิมพ์วงศ์" มี 2 บัญชี ต่างกันแค่ช่องว่าง ⇒ กดผูกแล้วชน unique) */
  if (tier === 'name' && rows.length && rows.every(r => r.takenByName)) {
    return { key: 'taken', text: rows.length === 1
      ? `คนนี้ถูกผูกกับบัญชี "${rows[0].takenByName}" อยู่แล้ว — บัญชีนี้น่าจะซ้ำ ให้ลบหรือตั้งเป็นบัญชีกลาง`
      : `ชื่อตรงกัน ${rows.length} คน แต่ถูกผูกกับบัญชีอื่นหมดแล้ว` };
  }
  if (tier === 'name') return { key: 'pick_one', text: `ชื่อตรงกัน ${rows.length} คน — ต้องเลือกว่าคนไหน` };
  if (tier === 'first') return { key: 'maybe', text: 'ชื่อต้นตรง นามสกุลต่าง — อาจเป็นคนละคน ต้องยืนยันเอง' };
  return { key: 'not_in_registry', text: 'ไม่มีชื่อนี้ในทะเบียนพนักงาน — เพิ่มเข้าฐานก่อน หรือเป็นบัญชีกลาง' };
}
