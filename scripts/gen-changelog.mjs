#!/usr/bin/env node
/* ══ 📦 gen-changelog — สร้าง public/changelog.json จาก git log (2026-10-01 · คำสั่ง user) ══
   โจทย์: *"เพิ่มหน้า program update … อัพเดทฟีเจอร์อะไรไปบ้าง แก้อะไรไปบ้าง"*

   🔴 **แหล่งความจริงคือ git ไม่ใช่ไฟล์ที่คนพิมพ์มือ**
      ทะเบียนที่ต้องมีคนมาจดเองจะล้าสมัยตั้งแต่สัปดาห์ที่สอง (บทเรียนซ้ำในโปรเจคนี้:
      ช่องที่ไม่มีใครกรอก = ช่องตาย) · commit มีอยู่แล้วทุกครั้งที่แก้ของ ⇒ อ่านจากนั้น

   กฎที่ยึด:
   1. **ห้ามทำให้ build ล่ม** — git ใช้ไม่ได้/พังกลางทาง = เตือนแล้ว exit 0 โดยคงไฟล์เดิมไว้
   2. 🔴 **shallow clone ต้องไม่ล้างประวัติ** — Render อาจ clone มาตื้น (git log ได้ไม่กี่ commit)
      ถ้าของใหม่น้อยกว่าของเดิมอย่างมีนัย = **ไม่เขียนทับ** (ไม่งั้นหน้าจะเหลือ 1 บรรทัดเงียบๆ)
   3. **เอาแค่บรรทัดหัวเรื่องของ commit** — ไม่เอา body ⇒ trailer (Co-Authored-By / ลิงก์ session)
      ไม่มีทางหลุดออกจอ
   4. ไฟล์ผลลัพธ์ถูก commit ไว้ด้วย — ที่ไหนรัน script ไม่ได้ก็ยังมีข้อมูลให้จอ
      และจอ **ต้องโชว์ `generatedAt`** ให้คนเห็นเองว่าข้อมูลสดถึงเมื่อไหร่ (ห้ามซ่อนความเก่า)
   ════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'public', 'changelog.json');
/** ของใหม่น้อยกว่าของเดิมเกินเกณฑ์นี้ = สงสัยว่า clone ตื้น ⇒ ไม่เขียนทับ */
const SHRINK_GUARD = 0.9;
/** เพดานจำนวนรายการในไฟล์ — กันไฟล์โตไม่จำกัดเมื่อประวัติยาวขึ้นเรื่อยๆ
    ตัดแล้ว **ต้องติดธง `truncated` ให้จอเขียนบอก** ห้ามตัดเงียบ (ปัจจุบันยังไม่ถึงเพดาน) */
const MAX = 1500;
const SEP = '\u001f';            // ตัวคั่นฟิลด์ที่ไม่มีทางอยู่ในข้อความ commit

const warn = (m) => console.warn(`[changelog] ⚠️  ${m}`);

/** แปลงหัวเรื่อง commit → { t: ชนิด, s: ขอบเขต, m: ข้อความ } (conventional commit · ไม่ตรงรูป = t:null) */
export function parseSubject(subject) {
  const raw = String(subject || '').trim();
  const m = /^([a-zA-Z]+)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(raw);
  if (!m) return { t: null, s: null, m: raw };
  return { t: m[1].toLowerCase(), s: (m[2] || '').trim() || null, m: m[3].trim() };
}

function readExisting() {
  try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return null; }
}

function gitLog() {
  const out = execFileSync('git', [
    'log', '--no-merges', '--date=short',
    `--pretty=format:%h${SEP}%ad${SEP}%s`,
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\n').filter(Boolean).map((line) => {
    const [h, d, subject] = line.split(SEP);
    const p = parseSubject(subject);
    return { h, d, t: p.t, s: p.s, m: p.m };
  }).filter(c => c.d && c.m);
}

function main() {
  let commits;
  try {
    commits = gitLog();
  } catch (e) {
    warn(`อ่าน git log ไม่ได้ (${e.code || e.message}) — คงไฟล์เดิมไว้`);
    return;
  }
  if (!commits.length) { warn('git log ว่าง — คงไฟล์เดิมไว้'); return; }

  const old = readExisting();
  const oldN = Array.isArray(old?.commits) ? old.commits.length : 0;
  if (oldN && commits.length < oldN * SHRINK_GUARD) {
    warn(`ได้ ${commits.length} commit แต่ไฟล์เดิมมี ${oldN} — น่าจะเป็น shallow clone ⇒ ไม่เขียนทับ`);
    return;
  }

  const truncated = commits.length > MAX;
  const kept = truncated ? commits.slice(0, MAX) : commits;
  const data = {
    generatedAt: new Date().toISOString(),
    from: kept[kept.length - 1].d,
    to: kept[0].d,
    count: kept.length,
    truncated,                      // true = มีของเก่ากว่านี้ใน git แต่ไม่อยู่ในไฟล์ (จอต้องเขียนบอก)
    oldestInGit: commits[commits.length - 1].d,
    commits: kept,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  const json = JSON.stringify(data);
  const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === json;
  if (!same) writeFileSync(OUT, json);
  console.log(`[changelog] ${kept.length} commit · ${data.from} → ${data.to}`
    + `${truncated ? ` (ตัดจาก ${commits.length} · เก่าสุดใน git ${data.oldestInGit})` : ''}`
    + `${same ? ' (ไม่เปลี่ยน)' : ''} · ${(json.length / 1024).toFixed(0)} KB`);
}

main();
