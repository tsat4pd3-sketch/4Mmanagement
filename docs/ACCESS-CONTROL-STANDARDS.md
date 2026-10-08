# 🔐 มาตรฐานสากลด้านสิทธิ์การเข้าถึง — เทียบกับ ESM

> **สถานะ:** เอกสารอ้างอิง (ไม่ใช่แผนงาน) · 2026-09-24
> **ทำไมมี:** คำสั่ง user *"หาบทความหรือทฤษฎี architecture design เกี่ยวกับ role permission
> เพื่อช่วยทำให้โปรเจคเราสมบูรณ์ได้มาตรฐานสากล"*
> **อ่านคู่กับ:** `docs/ORG-AXES-DECISION.md` (แกน) · `docs/PERMISSIONS-DESIGN.md` (ของจริงในระบบ)
>
> ⚠️ ตัวเลขทุกตัวในเอกสารนี้ **วัดจากฐานจริง 23-24/09/2026** ไม่ใช่ประมาณ — วัดซ้ำได้ด้วย
> `node audit/permmap.mjs` + คิวรีใน §7

---

## 1. สรุปหน้าเดียว — เราอยู่ตรงไหนของมาตรฐาน

| เรื่อง | มาตรฐานว่าไง | ESM วันนี้ | ช่องว่าง |
|---|---|---|---|
| โมเดลสิทธิ์ | **RBAC + attribute แบบ role-centric** (NIST) | role × permission_key + scope (กำลังทำ) | 🟢 **ทิศถูกแล้ว** — แต่ scope ยัง "ขยายสิทธิ์ได้" ซึ่งผิดนิยาม |
| ด่านจริงอยู่ที่ไหน | **ต้องอยู่ฝั่ง server ซ่อนปุ่มไม่นับ** (OWASP A01) | 192/279 policy = `true` | 🔴 **ด่านจริงคือ UI เท่านั้น** |
| ค่าเริ่มต้น | **Deny by default** | ไม่มี scope = เห็นทุกอย่าง (fail-open) | 🔴 กลับด้านกับมาตรฐาน |
| เขียนด่านที่เดียวแล้วใช้ซ้ำ | **ต้อง** (OWASP) | `can()` 180 จุด **แต่ hardcode `role ===` อีก 147 จุด** | 🟡 มี 2 ระบบซ้อนกัน |
| ทบทวนสิทธิ์เป็นรอบ | **บังคับ** (ISO 27001 A.5.18) | ไม่มีเลย | 🔴 ยังไม่เริ่ม |
| Log เวลาสิทธิ์ถูกปฏิเสธ | **ต้องมี + แจ้งเตือน** (OWASP) | ไม่มีเลย | 🔴 ยังไม่เริ่ม |
| แยกหน้าที่ (SoD) | **บังคับ** (ISO 27001 A.5.15) | มีบางส่วน (4M: คนสร้าง ≠ คนอนุมัติ) | 🟡 ไม่ได้บังคับที่ระบบ |

---

## 2. โมเดลที่เราใช้ มีชื่อทางการว่าอะไร — **"Role-centric RBAC-A"**

NIST (Kuhn / Coyne / Weil, *Adding Attributes to Role-Based Access Control*, IEEE Computer 2010)
แบ่งวิธีผสม RBAC กับ attribute เป็น **3 แบบ**:

| แบบ | สิทธิ์คำนวณยังไง | ปัญหา |
|---|---|---|
| **Dynamic roles** | attribute เป็นตัว*เลือก role*ให้ user (เช่น กะดึก → ได้ role นี้) | ยังตอบได้ว่า role ไหนทำอะไรได้ แต่ "ใครได้ role ไหน" กลายเป็นของ runtime |
| **Attribute-centric** | สิทธิ์ = กฎ attribute ล้วน role เป็นแค่ attribute ตัวหนึ่ง | **NIST บอกเองว่า "ไม่ค่อยนับเป็น RBAC แล้ว"** — ตอบไม่ได้ว่า role นี้ทำอะไรได้บ้าง |
| **Role-centric** ⭐ | **role กำหนด "เพดาน" ของสิทธิ์ · attribute ได้แค่ *ตัดออก* ไม่เคย *เพิ่ม*** | ตอบคำถาม audit ได้ครบ — เพดานยังอ่านจากตาราง role ได้เหมือนเดิม |

> ### 🎯 ESM = role-centric และ**ต้องเป็นแบบนั้นต่อไป**
> สูตรที่เราเคาะไว้ใน `ORG-AXES-DECISION.md` §5:
> **เห็น/ทำ/ได้แจ้งเตือน = (สิทธิ์) ∩ (สังกัด × ระดับ)**
> — เครื่องหมาย **∩ (ตัดกัน)** คือหัวใจ: ขอบเขต **ตัดสิทธิ์ให้แคบลงเท่านั้น ห้ามขยาย**
>
> **🔴 กฎที่ตามมา (ยังละเมิดอยู่วันนี้):**
> - `profiles.sections = []` (ไม่ตั้งขอบเขต) วันนี้แปลว่า **"เห็นทุกส่วนงาน"** = ขอบเขต*ขยาย*สิทธิ์
>   ⇒ ผิดนิยาม role-centric และผิด deny-by-default พร้อมกัน · วัดได้ **11 บัญชี**
> - `notify_recipients()` fail-open ด้วยหลักเดียวกัน (ไม่มี scope = เข้าเกณฑ์ทุกตัวกรอง)
> - **ทางแก้ที่ถูกตามมาตรฐาน:** ไม่ตั้งขอบเขต = **เห็นเฉพาะของตัวเอง** · "เห็นทั้งโรงงาน" ต้องเป็น
>   ค่าที่ตั้งชัดเจน (`scope_depth = all`) ไม่ใช่ผลข้างเคียงของการเว้นว่าง

### 2.1 ทำไมไม่ทำ role เป็น `manager_PD3`, `manager_PD4` ไปเลย — **role explosion**

NIST ชี้ว่าถ้าเอา attribute ไปยัดใน role จะเกิด *role explosion* (ต้องสร้าง role เป็นพันตัว
สำหรับชุดสิทธิ์ที่ต่างกันนิดเดียว) · ของเรา: 14 role × 6 ฝ่าย × 14 แผนก = **ระเบิดทันที**
⇒ การแยก "ขอบเขต" ออกจาก "role" เป็นคนละแกน คือท่ามาตรฐาน ไม่ใช่การออกแบบเกินจำเป็น

---

## 3. การตกทอดตามผังองค์กร — ยืมแนวคิดจาก ReBAC / Google Zanzibar

Zanzibar (Google, USENIX ATC 2019) = ระบบสิทธิ์ที่ Google ใช้กับ Drive/Cloud/YouTube
มองสิทธิ์เป็น **กราฟความสัมพันธ์** และรองรับ **relation inheritance** —
สิทธิ์ที่ให้ที่ระดับบน *ตกทอดลงมาถึงลูกอัตโนมัติ* (org → folder → subfolder → file)

**สิ่งที่เราควรยืม:**
- `scope_depth = branch` ของเรา = แนวคิดเดียวกันเป๊ะ (ให้สิทธิ์ที่โหนด PD3 → ครอบทุกอย่างใต้ PD3)
- **คำนวณ closure (บรรพบุรุษ/ลูกหลาน) ที่เดียว** — ของเรามี `orgScope.ancestorsOf()` อยู่แล้ว
  **ห้ามมีจอไหนไล่ `parent_id` เอง**

**สิ่งที่เรา *ไม่* ต้องยืม (จะ over-engineer):**
- Zanzibar ออกแบบมาเพื่อ *แชร์รายชิ้นข้ามองค์กร* + *ตรวจสิทธิ์ล้านครั้ง/วินาที ทั่วโลก*
- ของเรา = องค์กรเดียว ผังชั้นเดียว ไม่มีการแชร์รายชิ้นให้คนนอก
  ⇒ **RBAC + ขอบเขตตามผัง เพียงพอ** ไม่ต้องทำ tuple store / relation DSL

---

## 4. OWASP A01 — "Broken Access Control" อันดับ 1 ของโลก 2 รอบติด (2021, 2025)

ข้อกำหนดหลัก 4 ข้อที่เกี่ยวกับเราตรงๆ:

1. **"ด่านต้องอยู่ฝั่ง server เท่านั้น — ซ่อนลิงก์/ปุ่มใน UI ไม่นับเป็นการป้องกัน"**
   🔴 ของเรา: **192 จาก 279 policy ฝั่ง Main คือ `true`** (ใครก็ได้ที่ login แตะได้)
   ⇒ ด่านจริงวันนี้คือ `can()` ในหน้าเว็บ — ซึ่ง OWASP บอกตรงๆ ว่า *ไม่นับ*
   ⇒ ฝั่ง **DR หนักกว่า**: `supabaseDR` วิ่งด้วย `anon` เสมอ (กฎเหล็ก CLAUDE.md) ⇒ RLS คือด่านเดียว
2. **Deny by default** — ยกเว้นของสาธารณะ ที่เหลือต้องปฏิเสธก่อน
   🔴 ของเรา fail-open 2 จุด (§2)
3. **"เขียนกลไกสิทธิ์ครั้งเดียวแล้วใช้ซ้ำทั้งแอป"**
   🟡 ของเรามี `can()` 180 จุด **แต่ยังมี `role === '...'` อีก 147 จุด ใน ~40 ไฟล์**
   (หนักสุด Report 31 · DailyReport 15 · AddUser 10) — **สิทธิ์พวกนี้ `/permissions` ปรับไม่ได้**
4. **"Log ทุกครั้งที่สิทธิ์ถูกปฏิเสธ + แจ้งเตือน admin เมื่อเกิดซ้ำ"**
   🔴 เราไม่มีเลย · และอาการ *"RLS ปฏิเสธ = สำเร็จ 0 แถว ไม่มี error"* (กฎเหล็ก CLAUDE.md ข้อ 2)
   ทำให้การปฏิเสธ **เงียบสนิททั้งฝั่ง user และฝั่ง admin**

---

## 5. Postgres RLS — กับดักที่มาตรฐานเตือน (ใช้ได้ทันทีกับ Supabase)

- **เจ้าของตารางข้าม RLS ได้โดยไม่มีสัญญาณ** — เปิด RLS แล้วแต่ policy ถูกข้ามเงียบๆ
  ⇒ ตารางที่ข้อมูลสำคัญควรใช้ `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
- **"พิสูจน์ว่า RLS ทำงานจริง"** = คิวรีด้วย context ผิด **ต้องได้ 0 แถว**
  ถ้าไม่ได้ 0 = *policy theater* (มีไว้ให้ดูดีเฉยๆ)
  ⇒ **ควรมีเทส/สคริปต์ไล่ตรวจหลัง migration ทุกครั้ง เพราะโหมดพังคือ "เงียบ"**
- **RLS = ชั้นป้องกันเสริม ไม่ใช่ตัวแทนด่านฝั่งแอป** — ต้องมีทั้งคู่ (defense in depth)

---

## 6. ISO 27001 — ของที่เรา "ยังไม่เริ่มเลย" (และ IATF จะถามแน่)

| Control | ต้องการอะไร | ESM |
|---|---|---|
| **A.5.15 Access Control** | นโยบายที่เขียนไว้: need-to-know · least privilege · **separation of duties** | 🟡 มีในทางปฏิบัติ (4M: คนสร้าง ≠ คนอนุมัติ) แต่ไม่มีเอกสารนโยบาย + ระบบไม่บังคับ |
| **A.5.18 Access Rights** | วงจรชีวิตสิทธิ์: ให้ · ถอน · **ทบทวนเป็นรอบ (recertification)** | 🔴 ไม่มีการทบทวนเลย · ไม่รู้ว่าใครมีสิทธิ์เกินความจำเป็นบ้าง |

> **หลักที่ใช้ตรวจ:** *"สิทธิ์จะ creep ขึ้นเรื่อยๆ ถ้าไม่มีการทบทวน"* —
> คนย้ายแผนก/เปลี่ยนงานแล้วสิทธิ์เก่าไม่เคยถูกถอด
> · เรามีวัตถุดิบครบแล้ว (`role_permissions` + `profiles` + audit log) **ขาดแค่จอกับรอบเวลา**
> · **ผู้อนุมัติสิทธิ์ต้องไม่ใช่คนขอเอง** (SoD) — วันนี้ admin กดให้ตัวเองได้

---

## 7. คิวรีวัดซ้ำ (Main project `ewhdfqwfwofivojtsizn`)

```sql
-- ① ด่านฝั่ง DB อ่อนแค่ไหน (OWASP A01 ข้อ 1)
select count(*) total,
       count(*) filter (where qual='true' or with_check='true') as open_to_any_login,
       count(*) filter (where coalesce(qual,'')||coalesce(with_check,'') like '%has_perm%') as uses_has_perm
  from pg_policies where schemaname='public';

-- ② บัญชีที่ fail-open (ไม่มีขอบเขต = เห็นทุกอย่าง)
select count(*) from profiles
 where employee_id is null and coalesce(section,'')=''
   and coalesce(array_length(sections,1),0)=0;
```
```bash
# ③ สิทธิ์ที่ /permissions ปรับไม่ได้ (hardcode) + คีย์ตาย
node audit/permmap.mjs
```

---

## 8. แหล่งอ้างอิง

- NIST — *Adding Attributes to Role-Based Access Control* (Kuhn, Coyne, Weil · IEEE Computer 2010)
  https://csrc.nist.gov/pubs/journal/2010/06/adding-attributes-to-rolebased-access-control/final
- NIST SP 800-162 — *Guide to Attribute Based Access Control (ABAC)*
  https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-162.pdf
- OWASP Top 10:2025 — *A01 Broken Access Control*
  https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/
- Google Zanzibar / ReBAC — https://en.wikipedia.org/wiki/Google_Zanzibar ·
  https://www.osohq.com/academy/relationship-based-access-control-rebac
- ISO/IEC 27001:2022 Annex A 5.15 (Access Control) · A 5.18 (Access Rights)
  https://www.isms.online/iso-27001/annex-a-2022/5-15-access-control-2022/
- Postgres RLS ในงานจริง — https://www.permit.io/blog/postgres-rls-implementation-guide ·
  https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres

> ⚠️ container ของ session นี้ดึงไฟล์จากเว็บตรงๆ ไม่ได้ (egress proxy บล็อก csrc.nist.gov / owasp.org)
> ⇒ สรุปข้างบนมาจากผลค้นหา **ยังไม่ได้อ่านตัวเต็มของ NIST/OWASP ทีละบรรทัด**
> ก่อนเอาไปอ้างในเอกสารส่งลูกค้า/ผู้ตรวจ **ให้เปิดลิงก์ตัวจริงยืนยันถ้อยคำอีกรอบ**
