# Your First Web App — Trainer Guide / คู่มือผู้สอน
### 4 hours · for non-IT trainers teaching non-IT people
### 4 ชั่วโมง · สำหรับคนไม่เป็นไอที สอนคนไม่เป็นไอที

Slides / สไลด์: `docs/WEB101_Basic_Slides_EN_TH.html` (44 slides)
Answer key / ไฟล์เฉลย: `docs/web101-basic/index.html`

> **Advanced version / ฉบับเต็ม:** if the audience is technical and you have a full day,
> use `docs/WEB101_Teaching_Slides.html` (71 slides, React + terminal + build tools) instead.
> ถ้าผู้เรียนเป็นสายเทคนิคและมีเวลาเต็มวัน ให้ใช้ฉบับเต็มแทน

---

## 1. Can I teach this? / ผมสอนได้เหรอ

**Yes, if you do these 3 things first / ได้ ถ้าทำ 3 อย่างนี้ก่อน:**

1. **Do the whole class yourself once, alone, from these notes** — takes about 2 hours the first time.
   ทำคลาสนี้เองให้จบ 1 รอบ ตามคู่มือนี้ — รอบแรกใช้เวลาประมาณ 2 ชม.
2. **Keep your finished folder** — you will use it to compare when someone is stuck.
   เก็บโฟลเดอร์ที่ทำเสร็จไว้ — ใช้เทียบตอนมีคนติด
3. **Practise saying this one sentence:** *"I don't know either — let's look at the error together."*
   ฝึกพูดประโยคนี้ให้ชิน: **"ผมก็ไม่รู้เหมือนกัน เดี๋ยวมาดู error ด้วยกัน"** — ผู้เรียนไม่ได้ต้องการผู้เชี่ยวชาญ เขาต้องการคนที่ไม่ทิ้งเขา

**You do NOT need to:** know React, know SQL, know what a server is, be able to answer every question.
**ไม่จำเป็นต้อง:** รู้จัก React · เขียน SQL เป็น · รู้ว่าเซิร์ฟเวอร์คืออะไร · ตอบได้ทุกคำถาม

---

## 2. Before the day / เตรียมก่อนวันสอน

| When / เมื่อไหร่ | Do / ทำอะไร |
|---|---|
| 1 week before | Send participants the install list (§3) and ask them to install **before** the class · ส่งรายการติดตั้งให้ผู้เรียนล่วงหน้า |
| 3 days before | Do the whole class yourself once · ลองทำเองให้จบ 1 รอบ |
| 1 day before | Print this guide · test the projector · test the Wi-Fi with 10 devices · พิมพ์คู่มือ · ทดสอบโปรเจคเตอร์ · ทดสอบ Wi-Fi ตอนมีคนต่อพร้อมกัน |
| 30 min before | Open slides + your finished folder + a blank folder on your own PC · เปิดสไลด์ + โฟลเดอร์ที่ทำเสร็จ + โฟลเดอร์เปล่าไว้ |

**Room / ห้องเรียน:** max 12 people · 1 helper if more than 8 · everyone needs a laptop and a power socket
สูงสุด 12 คน · เกิน 8 คนควรมีผู้ช่วย 1 คน · ทุกคนต้องมีโน้ตบุ๊กและปลั๊ก

**⚠️ The single biggest risk is the internet.** 12 people downloading VS Code at 09:05 will kill the class.
That is why installation must happen **before** the day.
**⚠️ ความเสี่ยงอันดับ 1 คืออินเทอร์เน็ต** — 12 คนโหลด VS Code พร้อมกันตอน 09:05 คลาสจบเลย จึงต้องให้ติดตั้งมาก่อน

---

## 3. Install list to send participants / รายการติดตั้งที่ส่งให้ผู้เรียน

Copy this message and send it / ก๊อปข้อความนี้ส่งได้เลย:

```
สวัสดีครับ — วันที่ ___ เราจะเรียน "สร้างเว็บแอปแรกของคุณ" 4 ชั่วโมง
รบกวนติดตั้ง 2 โปรแกรมนี้มาก่อนวันเรียนนะครับ (ฟรีทั้งคู่):

1) Google Chrome        → google.com/chrome
2) Visual Studio Code   → code.visualstudio.com
   เปิด VS Code แล้วกดรูปสี่เหลี่ยม 4 ช่องด้านซ้าย พิมพ์ค้นหา "Live Server" กด Install

และสมัครบัญชีฟรี 2 ที่ (เข้าด้วย Google ได้เลย):
3) supabase.com
4) netlify.com

ไม่ต้องเตรียมอะไรอย่างอื่น ไม่ต้องมีพื้นฐานเขียนโปรแกรมครับ
ติดตั้งไม่ได้ ทักมาก่อนวันเรียนได้เลย
```

---

## 4. Timetable / ตารางเวลา

| Time | Slides | Part | Trainer mode |
|---|---|---|---|
| 09:00–09:25 | 1–11 | How a web app works · เว็บแอปทำงานยังไง | Talk · พูด |
| 09:25–09:45 | 12–14 | Tools ready · เตรียมเครื่องมือ | **Everyone follows** |
| 09:45–10:25 | 15–21 | 🔧 Make a page appear · ทำหน้าเว็บ | **Everyone follows** |
| 10:25–10:40 | — | Break · พัก | |
| 10:40–11:25 | 22–29 | 🔧 Build the data store · สร้างที่เก็บข้อมูล | **Everyone follows** |
| 11:25–12:10 | 30–36 | 🔧 Connect them · ต่อเข้าด้วยกัน | **Everyone follows** |
| 12:10–12:35 | 37–39 | 🔧 Put it online · ขึ้นออนไลน์ | **Everyone follows** |
| 12:35–13:00 | 40–44 | Rules & next steps · กฎและก้าวต่อไป | Talk · พูด |

**If you are running late / ถ้าเวลาไม่พอ** — cut in this order:
1. Slide 9 (what happens on Save) · 2. Slide 32 (reading code aloud) · 3. Slide 43 (what real systems add)
**Never cut / ห้ามตัด:** any green checkpoint · Step B4 (the safety warning) · Slide 35 (break it on purpose) · Slide 39 (before real use)

---

## 5. Part-by-part script / สคริปต์รายช่วง

### Part 1 — How a web app works (25 min) / เว็บแอปทำงานยังไง

**Say / พูด:** "Today nobody has to become a programmer. We are going to build one small thing that works, and you will understand what you built."
"วันนี้ไม่มีใครต้องกลายเป็นโปรแกรมเมอร์ เราจะสร้างของเล็กๆ 1 ชิ้นที่ใช้ได้จริง และคุณจะเข้าใจสิ่งที่ตัวเองสร้าง"

**Ask the room / ถามห้อง:** "Which paper form in your area annoys you most?" — write 3 answers on the whiteboard, come back to them at the end.
"ใบกระดาษใบไหนในแผนกคุณที่น่ารำคาญที่สุด" — จด 3 คำตอบบนไวท์บอร์ด แล้วกลับมาอ้างอิงตอนจบ

**Watch for / ระวัง:** don't let this part run over 25 minutes. People came to build something.
อย่าให้ช่วงนี้เกิน 25 นาที — คนมาเพื่อได้ลงมือทำ

---

### Part 2 — Tools (20 min) / เตรียมเครื่องมือ

**Do / ทำ:** walk around and physically look at all screens before moving on. Do not ask "everyone ready?" — people say yes when they are not.
เดินดูจอทุกเครื่องด้วยตาตัวเองก่อนไปต่อ · **อย่าถามว่า "พร้อมกันไหม"** เพราะคนจะตอบว่าพร้อมทั้งที่ยังไม่พร้อม

**If someone did not install / ถ้ามีคนยังไม่ได้ติดตั้ง:** pair them with a neighbour, one laptop for two. Do not make 11 people wait for 1.
ให้จับคู่นั่งด้วยกัน 2 คน 1 เครื่อง · อย่าให้ 11 คนรอ 1 คน

---

### Part 3 — Make a page appear (40 min) / ทำหน้าเว็บ

**The moment that matters / จังหวะสำคัญ:** slide 19, when they save and Chrome changes by itself.
Stop and let people enjoy it — that is the moment people decide they can do this.
สไลด์ 19 ตอนที่เซฟแล้ว Chrome เปลี่ยนเอง — หยุดสักครู่ ให้เขาได้ตื่นเต้น เพราะนี่คือจังหวะที่คนตัดสินใจว่า "เราทำได้"

**Most common problem / ปัญหาที่พบบ่อยที่สุด:** the file was saved as `index.html.txt` on Windows.
Show them how to check: the VS Code tab must say exactly `index.html`.
ปัญหาที่เจอบ่อยสุด: Windows เซฟเป็น `index.html.txt` — สอนวิธีเช็ค: แท็บใน VS Code ต้องขึ้นว่า `index.html` เป๊ะๆ

---

### Part 4 — Data store (45 min) / ที่เก็บข้อมูล

**Say before Step B2 / พูดก่อนขั้น B2:** "A table is an Excel sheet that lives on the internet instead of on your PC. That is all it is."
"ตาราง = ชีต Excel ที่อยู่บนอินเทอร์เน็ตแทนที่จะอยู่ในเครื่อง แค่นั้นเลย"

**⚠️ Step B4 — you must say this out loud / ต้องพูดออกเสียง:**
> "What we just clicked means anyone with the link can read and add rows. That is fine for practice.
> It is not fine for real production data, employee data or customer data. For that you need log-in, and you must talk to IT."
> "สิ่งที่เพิ่งกดไป แปลว่าใครมีลิงก์ก็อ่านและเพิ่มข้อมูลได้ — ใช้กับข้อมูลฝึกได้ แต่ห้ามใช้กับข้อมูลผลิตจริง ข้อมูลพนักงาน หรือข้อมูลลูกค้า ของจริงต้องมีล็อกอินและต้องคุยกับ IT ก่อน"

This is the one sentence that keeps this training from causing a problem later. Do not skip it.
นี่คือประโยคเดียวที่กันไม่ให้การอบรมนี้กลายเป็นปัญหาทีหลัง — ห้ามข้าม

---

### Part 5 — Connect (45 min) / ต่อเข้าด้วยกัน

**The hardest 10 minutes of the day.** Slow down here. Paste one block, check every screen, then the next block.
**นี่คือ 10 นาทีที่ยากที่สุดของวัน** — ช้าลงตรงนี้ · วางทีละก้อน เดินดูทุกจอ แล้วค่อยก้อนถัดไป

**Order / ลำดับ:** C1 (keys) → check → C2 (show data) → **check every screen** → C3 (save button) → check.

**Top 3 causes when it doesn't work / 3 สาเหตุอันดับต้น:**
1. The key was pasted with a missing character, or outside the quote marks · ก๊อป key มาไม่ครบ หรือวางนอกเครื่องหมาย `' '`
2. The date box shows a different date from the rows in Supabase · วันที่ในช่องไม่ตรงกับวันที่ของข้อมูล
3. Step B4 policies were not created · ยังไม่ได้สร้าง policy ในขั้น B4

**Say at slide 35 / พูดตอนสไลด์ 35:** "Now turn off your Wi-Fi and press Save. I want you to see it fail properly."
"ตอนนี้ปิด Wi-Fi แล้วกด Save — ผมอยากให้เห็นว่าเวลามันพัง มันต้องพังแบบบอกเรา"

---

### Part 6 — Online (25 min) / ขึ้นออนไลน์

**Best moment of the day / จังหวะที่ดีที่สุดของวัน:** get two people to open **the same link** on their phones and each save a row, then show both rows on the projector.
ให้ 2 คนเปิด**ลิงก์เดียวกัน**บนมือถือ แล้วบันทึกคนละแถว จากนั้นฉายให้ทั้งห้องเห็นว่าข้อมูลทั้ง 2 แถวอยู่ด้วยกัน

**Say / พูด:** "That is a multi-user system. You built it before lunch."
"นี่คือระบบที่หลายคนใช้พร้อมกันได้ — คุณทำมันเสร็จก่อนพักเที่ยง"

---

### Part 7 — Rules (25 min) / กฎ

Go back to the 3 paper forms on the whiteboard from Part 1 and ask which one they will try first.
กลับไปที่ใบกระดาษ 3 ใบบนไวท์บอร์ดจากช่วงที่ 1 แล้วถามว่าจะลองทำใบไหนก่อน

End on the honest line: today's page is a **prototype**, not a production system — and prototypes are how every good system starts.
จบด้วยความจริง: หน้าของวันนี้คือ**ต้นแบบ** ยังไม่ใช่ระบบใช้งานจริง — และระบบดีๆ ทุกตัวก็เริ่มจากต้นแบบ

---

## 6. Handout — everything to copy / เอกสารแจกผู้เรียน (ก๊อปจากตรงนี้)

> Give participants this section as a file (email or USB). **Do not make them type from the projector.**
> แจกส่วนนี้เป็นไฟล์ให้ผู้เรียน (อีเมลหรือ USB) **อย่าให้พิมพ์ตามจอโปรเจคเตอร์**

### Block 1 — the starter page (Step A2) / หน้าเริ่มต้น

```html
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>บันทึกยอดผลิต</title>
</head>
<body>

  <h1>บันทึกยอดผลิต / Daily Production Log</h1>
  <p>Hello. This page is alive.</p>

</body>
</html>
```

### Block 2 — the boxes and the table (Step A4) / ช่องกรอกและตาราง

Replace the `<p>Hello…</p>` line with this / เอาบรรทัด `<p>Hello…</p>` ออก แล้ววางอันนี้แทน:

```html
  <input id="date" type="date">
  <input id="line" placeholder="ไลน์ / Line">
  <input id="ok"   type="number" placeholder="ดี / Good">
  <input id="ng"   type="number" placeholder="เสีย / NG">
  <button id="saveBtn">บันทึก / Save</button>

  <div id="msg"></div>

  <table border="1">
    <thead>
      <tr><th>ไลน์ / Line</th><th>ดี / Good</th><th>เสีย / NG</th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
```

### Block 3 — the connection (Step C1) / ตัวเชื่อม

Paste just above `</body>` / วางเหนือบรรทัด `</body>`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>

<script>
const PROJECT_URL = 'วาง Project URL ที่นี่'
const PUBLIC_KEY  = 'วาง public key ที่นี่'

const db  = supabase.createClient(PROJECT_URL, PUBLIC_KEY)
const box = (id) => document.getElementById(id)
</script>
```

### Block 4 — show the data (Step C2) / ดึงข้อมูลมาแสดง

Paste inside the same `<script>` block / วางต่อในก้อน `<script>` เดิม:

```js
async function load() {
  const answer = await db.from('daily_logs')
    .select('line_name, qty_ok, qty_ng')
    .eq('work_date', box('date').value)

  if (answer.error) {
    box('msg').textContent = 'โหลดไม่สำเร็จ / Load failed: ' + answer.error.message
    return
  }

  box('rows').innerHTML = answer.data.map(function (r) {
    return '<tr><td>' + r.line_name + '</td><td>' + r.qty_ok + '</td><td>' + r.qty_ng + '</td></tr>'
  }).join('')
}

box('date').value = '2026-09-08'      // ← ใส่วันที่ของวันนี้
load()
```

### Block 5 — make Save work (Step C3) / ทำให้ปุ่มบันทึกทำงาน

```js
async function save() {
  if (box('line').value.trim() === '') {
    box('msg').textContent = 'กรอกชื่อไลน์ก่อน / Enter a line name first'
    return
  }

  const answer = await db.from('daily_logs').insert({
    work_date: box('date').value,
    line_name: box('line').value.trim(),
    qty_ok: Number(box('ok').value) || 0,
    qty_ng: Number(box('ng').value) || 0,
  })

  if (answer.error) {
    box('msg').textContent = 'บันทึกไม่สำเร็จ / Save failed: ' + answer.error.message
    return
  }

  box('msg').textContent = 'บันทึกแล้ว / Saved'
  box('line').value = ''; box('ok').value = ''; box('ng').value = ''
  load()
}

box('saveBtn').addEventListener('click', save)
box('date').addEventListener('change', load)
```

### Supabase table to create (Step B2) / ตารางที่ต้องสร้าง

Table name / ชื่อตาราง: **`daily_logs`**

| Column / คอลัมน์ | Type / ชนิด |
|---|---|
| `work_date` | `date` |
| `line_name` | `text` |
| `qty_ok` | `int8` |
| `qty_ng` | `int8` |

(`id` and `created_at` are created for you / มีให้อยู่แล้ว ไม่ต้องเพิ่ม)

---

## 7. Troubleshooting / ตารางแก้ปัญหา

**Always start here / เริ่มที่นี่เสมอ:** Chrome → press **F12** → **Console** tab → read the red line.
Chrome → กด **F12** → แท็บ **Console** → อ่านบรรทัดสีแดง

| Symptom / อาการ | Cause / สาเหตุ | Fix / วิธีแก้ |
|---|---|---|
| Page shows the code itself · หน้าโชว์โค้ดออกมา | File is not `.html` · ชื่อไฟล์ไม่ลงท้าย .html | Rename to `index.html` · เปลี่ยนชื่อไฟล์ |
| Thai text is garbled · ภาษาไทยเพี้ยน | `charset="utf-8"` missing · บรรทัด charset หาย | Paste Block 1 again · วาง Block 1 ใหม่ |
| Chrome doesn't open · Chrome ไม่เด้ง | Live Server not installed · ยังไม่ได้ลง Live Server | Install the extension · ลงส่วนเสริม |
| `supabase is not defined` | Helper line missing or below the code · บรรทัดยืมตัวช่วยหาย/อยู่ใต้โค้ด | Put the `<script src=…>` line above your `<script>` · ย้ายขึ้นบน |
| `Invalid API key` | Key copied incomplete · ก๊อป key ไม่ครบ | Copy the whole key again · ก๊อปใหม่ทั้งเส้น |
| `column … does not exist` | Column name mismatch · ชื่อคอลัมน์ไม่ตรง | Compare table vs code letter by letter · เทียบตัวต่อตัว |
| `row-level security` error on save | INSERT policy missing · ยังไม่ได้ทำ policy INSERT | Redo Step B4 · ทำขั้น B4 ใหม่ |
| Table empty, Supabase has rows · ตารางว่างทั้งที่มีข้อมูล | Date mismatch, or read policy missing · วันที่ไม่ตรง หรือไม่มี policy อ่าน | Set the date box to the row's date · ตั้งวันที่ให้ตรง |
| Save button does nothing · กด Save ไม่มีอะไรเกิด | Last 2 lines missing · 2 บรรทัดสุดท้ายหาย | Paste the end of Block 5 · วางท้าย Block 5 |
| Everything is broken and we can't find why | — | Open the answer key `docs/web101-basic/index.html` and compare side by side · เปิดไฟล์เฉลยมาเทียบทีละบรรทัด |

**Rule for the trainer:** if one person is stuck for more than 4 minutes, give them the answer key file and move the class on. Fix it with them at the break.
**กฎของผู้สอน:** ถ้ามีคนติดเกิน 4 นาที ให้ไฟล์เฉลยเขาไปเลยแล้วเดินคลาสต่อ · ค่อยไปแก้ด้วยกันตอนพัก

---

## 8. Questions you will be asked / คำถามที่จะโดนถาม

| Question / คำถาม | A good honest answer / คำตอบที่ตรงไปตรงมา |
|---|---|
| "Is this free forever?" · "ฟรีตลอดไปไหม" | Free for small use. If many people use it daily, it costs money — ask IT then · ฟรีสำหรับการใช้เล็กๆ ถ้ามีคนใช้เยอะทุกวันจะมีค่าใช้จ่าย ตอนนั้นค่อยคุยกับ IT |
| "Can I use this for real work tomorrow?" · "พรุ่งนี้ใช้จริงเลยได้ไหม" | For your own practice data yes. For official records, no — talk to IT first · ข้อมูลฝึกของตัวเองได้ · บันทึกทางการยังไม่ได้ ต้องคุยกับ IT ก่อน |
| "Where is the data actually stored?" · "ข้อมูลเก็บที่ไหนจริงๆ" | On Supabase's servers (we chose Singapore). Not on your PC · บนเซิร์ฟเวอร์ของ Supabase (เราเลือกสิงคโปร์) ไม่ได้อยู่ในเครื่องคุณ |
| "What if I delete the folder?" · "ถ้าลบโฟลเดอร์ทิ้งล่ะ" | The page is gone, the data stays. Rebuild the page from the handout · หน้าเว็บหาย แต่ข้อมูลยังอยู่ · สร้างหน้าใหม่จากเอกสารแจกได้ |
| "Is this how ESM was built?" · "ESM สร้างแบบนี้เหรอ" | Same three pieces, much bigger, with log-in and rules on top · สามชิ้นส่วนเดียวกัน แค่ใหญ่กว่ามาก และมีล็อกอินกับกฎอีกหลายชั้น |
| Anything you don't know | **"I don't know either — let's look together"** then open F12 with them · **"ผมก็ไม่รู้ เดี๋ยวดูด้วยกัน"** แล้วเปิด F12 ดูกับเขา |

---

## 9. After the class / หลังจบคลาส

- Send participants: this guide + the answer key file + their own links · ส่งคู่มือนี้ + ไฟล์เฉลย + ลิงก์ของแต่ละคน
- Book a 1-hour follow-up in 2 weeks to look at their homework · นัดติดตาม 1 ชม. ใน 2 สัปดาห์เพื่อดูการบ้าน
- Collect the "what got stuck" notes — they are the real requirement list for your next real system · เก็บโน้ต "ติดตรงไหน" ของทุกคนไว้ — นั่นคือรายการความต้องการจริงสำหรับระบบตัวถัดไป

---

*Companion to `docs/WEB101_Basic_Slides_EN_TH.html` · answer key `docs/web101-basic/index.html` · update both together (2026-09-08)*
