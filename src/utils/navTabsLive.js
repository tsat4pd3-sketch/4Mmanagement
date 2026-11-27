/* ══ 🗂️ ทะเบียนแท็บ "สด" ของทุกหน้า — ข้อย่อยในแผงเมนูสำหรับหน้าที่ไม่อยู่ใน NAV_SUB_TABS (2026-11-27 · คำสั่ง user
   "เมนูย่อยใน sidebar ยังมีแค่ของสโตร์") ═══════════════════════════════════════════════════════════════════════
   · `PageHeader` (ของกลาง) ประกาศแท็บของหน้าที่เปิดอยู่ผ่าน `publishNavTabs(path, tabs)` — หน้าไม่ต้องแก้อะไร
   · แผงเมนูอ่านด้วย `useNavTabsLive()` แล้ววาดเป็นข้อย่อย (ทางลัด `?tab=`) เหมือนทะเบียนตายตัว
   · จำลง localStorage (`esm-nav-tabs-v1`) ⇒ หน้าที่เคยเปิดแล้วมีข้อย่อยตลอดแม้ยังไม่เปิดรอบนี้ · หน้าที่ไม่เคยเปิด = ยังไม่มี (ไม่เดา)
   · param = `tab` เสมอ (ค่าตั้งต้นของ `useTabParam`) — หน้าที่ใช้ param อื่น (heijunka `view`) ต้องอยู่ใน `navSubTabs.js` ซึ่งชนะทะเบียนสดเสมอ
   · แท็บที่หน้าส่งมาถูกกรองสิทธิ์โดยหน้าแล้ว ⇒ รายการสดเป็นของ "คนนี้" — ไม่ต้องกรองซ้ำ · สลับบัญชี = ล้าง (`clearNavTabsLive`)
   · ไฟล์นี้ไม่ import react component — node-safe */
import { useSyncExternalStore } from 'react';

const KEY = 'esm-nav-tabs-v1';
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
let state = read();           // path → { param:'tab', tabs:[{ key, label }] }
const subs = new Set();
const emit = () => subs.forEach(fn => fn());
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode = จำแค่ใน session */ } };

/** แท็บของหน้า (เฉพาะชั้นบนสุด · กลุ่มแตกเป็นลูก) — เหมือนเดิม = ไม่ emit */
export function publishNavTabs(path, tabs) {
  if (!path || !Array.isArray(tabs)) return;
  const flat = [];
  for (const t of tabs) {
    if (Array.isArray(t?.children)) for (const c of t.children) flat.push({ key: String(c.key), label: String(c.label ?? c.key) });
    else if (t && t.key != null) flat.push({ key: String(t.key), label: String(t.label ?? t.key) });
  }
  if (flat.length < 2) return;   // แท็บเดียว = ไม่มีอะไรให้เลือก
  const sig = flat.map(t => t.key + '\u0001' + t.label).join('\u0002');
  const cur = state[path];
  if (cur && cur.tabs.map(t => t.key + '\u0001' + t.label).join('\u0002') === sig) return;
  state = { ...state, [path]: { param: 'tab', tabs: flat } };
  persist(); emit();
}

export function clearNavTabsLive() { state = {}; persist(); emit(); }

export function useNavTabsLive() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn); }, () => state, () => state);
}
