# -*- coding: utf-8 -*-
"""
ESM · ดึงไฟล์ EDI 830/862 จาก Outlook บนเครื่อง → ส่งเข้าคิว 📬 ใน /planner-sales

  สายงาน: Outlook (classic) → สคริปต์นี้ → Edge Function `ingest-demand-mail` (DR)
          → ตาราง demand_mail_inbox + Storage demand-mail → แผง 📬 ในหน้า Planner & Sales
  🔴 สคริปต์นี้ "ไม่แกะไฟล์" — ส่งไฟล์ทั้งก้อนเข้าคิว แล้วให้ตัวอ่าน EDI ในแอปทำงานเหมือนเดิม
  เอกสาร: docs/modules/logistic-planner-sales.md §📬 ดึงไฟล์จากเมล

  โหมด:
    --setup   ถามโทเคน → เขียน config.ini → ทดสอบการเชื่อมต่อ
    --test    ทดสอบ: ต่อ ESM ได้ไหม + ลิสต์เมลที่เข้าเงื่อนไข (ไม่ส่งจริง)
    --diag    หาสาเหตุ "เจอ 0 ฉบับ": ลิสต์ทุกกล่องเมล + เมลที่หัวเรื่องเข้าแต่ตกเงื่อนไขอื่น พร้อมเหตุผล
    --once    รันรอบเดียวแล้วจบ
    --loop    รันค้าง เช็คทุก interval_minutes (ใช้ตอนเปิดเครื่อง)
  ต้องมี: Windows + Outlook แบบคลาสสิก + Python 3.8+ + pywin32
"""
import argparse, base64, configparser, datetime as dt, json, logging, os, re, socket, sys, tempfile, time
import urllib.request, urllib.error
from logging.handlers import RotatingFileHandler

HERE = os.path.dirname(os.path.abspath(__file__))
CFG_PATH = os.path.join(HERE, 'config.ini')
STATE_PATH = os.path.join(HERE, 'state.json')
LOG_PATH = os.path.join(HERE, 'esm_mail_ingest.log')
LOCK_PATH = os.path.join(HERE, '.lock')
PR_INTERNET_MESSAGE_ID = 'http://schemas.microsoft.com/mapi/proptag/0x1035001F'
OL_MAIL = 43

DEFAULTS = {
    'esm': {
        'endpoint': 'https://eyhclzkifitbhbljgoav.supabase.co/functions/v1/ingest-demand-mail',
        'token': '',
    },
    'mail': {
        # Inbox = กล่องจดหมายเข้าของ "ทุก" กล่องเมล/ไฟล์ข้อมูลใน Outlook (บัญชีบริษัท + PST)
        # Inbox/Forecast = โฟลเดอร์ย่อยใต้ Inbox ของทุกกล่อง
        # <ชื่อกล่องตามที่เห็นใน Outlook>/Inbox/... = เจาะกล่องเดียว เช่น Dulyatrust2025/Inbox
        'folder': 'Inbox',
        'subject_regex': r'FTM_AAT.*830.*862',
        'sender_contains': 'Sasiyawan',
        'attachment_regex': r'^(830|862)_.*\.(xlsx|xlsm|xls)$',
        'lookback_days': '7',
        'interval_minutes': '15',
    },
}

log = logging.getLogger('esm_mail')


def setup_logging(console):
    log.setLevel(logging.INFO)
    fh = RotatingFileHandler(LOG_PATH, maxBytes=1_000_000, backupCount=3, encoding='utf-8')
    fh.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    log.addHandler(fh)
    if console:
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(logging.Formatter('%(message)s'))
        log.addHandler(sh)


def load_cfg():
    cfg = configparser.ConfigParser(interpolation=None)
    cfg.read_dict(DEFAULTS)
    if os.path.exists(CFG_PATH):
        cfg.read(CFG_PATH, encoding='utf-8')
    return cfg


def save_cfg(cfg):
    with open(CFG_PATH, 'w', encoding='utf-8') as f:
        cfg.write(f)


def load_state():
    try:
        with open(STATE_PATH, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {'sent': {}}


def save_state(st):
    # เก็บแค่ 2,000 รายการล่าสุด (เมลเก่ากว่า lookback ไม่ถูกเช็คอีกอยู่แล้ว)
    sent = st.get('sent', {})
    if len(sent) > 2000:
        st['sent'] = dict(sorted(sent.items(), key=lambda kv: kv[1])[-2000:])
    tmp = STATE_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(st, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE_PATH)


def post(cfg, payload, timeout=120):
    req = urllib.request.Request(
        cfg['esm']['endpoint'], data=json.dumps(payload).encode('utf-8'), method='POST',
        headers={'content-type': 'application/json', 'x-ingest-token': cfg['esm']['token'].strip()})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')[:300]
        raise RuntimeError(f'HTTP {e.code}: {body}')


# ── Outlook ──────────────────────────────────────────────────────────────────
INBOX_NAMES = ('inbox', 'กล่องจดหมายเข้า')


def walk(folder, parts):
    for p in parts:
        folder = folder.Folders[p]
    return folder


def outlook_folders(path):
    """คืน [(ป้าย, folder)] ทุกโฟลเดอร์ที่ต้องสแกน
    🔴 ไม่ใช้ ns.GetDefaultFolder(6) ตัวเดียว (2026-10-01 · เจอจริง): เครื่อง user มีหลายกล่อง
       (บัญชีบริษัท + Dulyatrust2025) เมลจริงอยู่อีกกล่อง ⇒ สแกนกล่องหลักกล่องเดียวได้ 0 ฉบับ"""
    import win32com.client
    ns = win32com.client.Dispatch('Outlook.Application').GetNamespace('MAPI')
    parts = [p for p in re.split(r'[\\/]', path.strip()) if p]
    out = []
    if not parts or parts[0].lower() in INBOX_NAMES:
        for store in ns.Stores:
            try:
                out.append((f'{store.DisplayName}/Inbox', walk(store.GetDefaultFolder(6), parts[1:])))
            except Exception:
                continue                                # กล่องที่ไม่มี Inbox/ไม่มีโฟลเดอร์ย่อยนั้น = ข้าม
        return out
    for store in ns.Stores:
        if store.DisplayName.strip().lower() == parts[0].strip().lower():
            rest = parts[1:]
            if rest and rest[0].lower() in INBOX_NAMES:
                return [(path, walk(store.GetDefaultFolder(6), rest[1:]))]
            return [(path, walk(store.GetRootFolder(), rest))]
    raise RuntimeError(f'ไม่พบกล่องเมลชื่อ "{parts[0]}" — ดูชื่อที่ถูกด้วย --diag')


def recent_items(folder, cutoff):
    """เมลใหม่ → เก่า จนถึง cutoff
    🔴 ต้องเดินด้วย GetFirst/GetNext — `for item in items` ไม่รับประกันลำดับตาม Sort
       ถ้าเจอเมลเก่าก่อนแล้ว break = หยุดตั้งแต่ฉบับแรก (ได้ 0 ฉบับเงียบๆ)"""
    items = folder.Items
    items.Sort('[ReceivedTime]', True)
    item = items.GetFirst()
    while item is not None:
        try:
            ok = item.Class == OL_MAIL
            rt = local_naive(item.ReceivedTime) if ok else None
        except Exception:
            ok = False
        if ok:
            if rt < cutoff:
                return
            yield item, rt
        item = items.GetNext()


def local_naive(t):
    # pywin32 คืนเวลาท้องถิ่นแต่แปะ tz=UTC ไว้ (quirk ที่รู้กัน) → ใช้ตัวเลขตรงๆ เป็นเวลาเครื่อง
    return dt.datetime(t.year, t.month, t.day, t.hour, t.minute, t.second)


def sender_of(item):
    name = getattr(item, 'SenderName', '') or ''
    addr = getattr(item, 'SenderEmailAddress', '') or ''
    try:
        if item.SenderEmailType == 'EX':
            addr = item.Sender.GetExchangeUser().PrimarySmtpAddress or addr
    except Exception:
        pass
    return f'{name} <{addr}>' if addr else name


def message_id(item):
    try:
        mid = item.PropertyAccessor.GetProperty(PR_INTERNET_MESSAGE_ID)
        if mid:
            return str(mid)
    except Exception:
        pass
    return 'entry:' + item.EntryID


def check_mail(cfg, item):
    """คืน (ผ่านไหม, ผู้ส่ง, ไฟล์แนบที่เข้าเงื่อนไข, เหตุผลที่ตก)"""
    m = cfg['mail']
    if not re.search(m['subject_regex'], item.Subject or '', re.I):
        return False, '', [], 'หัวเรื่องไม่เข้า'
    snd = sender_of(item)
    who = m['sender_contains'].strip().lower()
    if who and who not in snd.lower():
        return False, snd, [], f'ผู้ส่งไม่มีคำว่า "{who}"'
    allatt = [item.Attachments.Item(i) for i in range(1, item.Attachments.Count + 1)]
    atts = [a for a in allatt if re.search(m['attachment_regex'], a.FileName or '', re.I)]
    if not atts:
        names = ', '.join(a.FileName for a in allatt) or 'ไม่มีไฟล์แนบ'
        return False, snd, [], f'ชื่อไฟล์แนบไม่เข้า ({names})'
    return True, snd, atts, ''


def matching_mails(cfg):
    cutoff = dt.datetime.now() - dt.timedelta(days=int(cfg['mail']['lookback_days']))
    for _, folder in outlook_folders(cfg['mail']['folder']):
        for item, rt in recent_items(folder, cutoff):
            ok, snd, atts, _ = check_mail(cfg, item)
            if ok:
                yield item, rt, snd, atts


def diag(cfg):
    import win32com.client
    ns = win32com.client.Dispatch('Outlook.Application').GetNamespace('MAPI')
    days = int(cfg['mail']['lookback_days'])
    cutoff = dt.datetime.now() - dt.timedelta(days=days)
    log.info('── กล่องเมลทั้งหมดใน Outlook ──')
    for store in ns.Stores:
        try:
            inbox = store.GetDefaultFolder(6)
            log.info(f'  • {store.DisplayName}  (Inbox {inbox.Items.Count} ฉบับ)')
        except Exception:
            log.info(f'  • {store.DisplayName}  (ไม่มี Inbox)')
    log.info(f'── สแกนตามตั้งค่า folder = {cfg["mail"]["folder"]} · ย้อนหลัง {days} วัน ──')
    for label, folder in outlook_folders(cfg['mail']['folder']):
        n = 0
        shown = 0
        for item, rt in recent_items(folder, cutoff):
            n += 1
            ok, snd, atts, why = check_mail(cfg, item)
            subj = item.Subject or ''
            if ok:
                log.info(f'  ✅ {label} · {rt:%d/%m %H:%M} · {subj} · {", ".join(a.FileName for a in atts)}')
            elif why != 'หัวเรื่องไม่เข้า' or re.search(r'830|862', subj):
                log.info(f'  ❌ {label} · {rt:%d/%m %H:%M} · {subj} · {why}')
            elif shown < 3:
                shown += 1
                log.info(f'  · {label} · {rt:%d/%m %H:%M} · {subj}')
        log.info(f'  = {label}: เมลในช่วงนี้ {n} ฉบับ')


def run_once(cfg, st, dry=False):
    tz = dt.datetime.now().astimezone().tzinfo
    found = sent_n = 0
    for item, rt, snd, atts in matching_mails(cfg):
        mid = message_id(item)
        found += 1
        if mid in st['sent']:
            continue
        names = [a.FileName for a in atts]
        if dry:
            log.info(f'[test] เจอ: {rt:%d/%m %H:%M} · {item.Subject} · {", ".join(names)}')
            continue
        files = []
        with tempfile.TemporaryDirectory() as td:
            for a in atts:
                p = os.path.join(td, re.sub(r'[\\/:*?"<>|]', '_', a.FileName))
                a.SaveAsFile(p)
                with open(p, 'rb') as f:
                    files.append({'name': a.FileName, 'content_b64': base64.b64encode(f.read()).decode('ascii')})
        res = post(cfg, {
            'message_id': mid, 'subject': item.Subject, 'sender': snd,
            'received_at': rt.replace(tzinfo=tz).isoformat(), 'host': socket.gethostname(), 'files': files,
        })
        if res.get('rejected'):
            log.warning(f'ไฟล์ถูกปฏิเสธ: {res["rejected"]}')
        log.info(f'ส่งแล้ว: {item.Subject} · ใหม่ {res.get("saved")} · ซ้ำ {res.get("duplicate")}')
        st['sent'][mid] = dt.datetime.now().isoformat(timespec='seconds')
        save_state(st)                                  # จำทีละเมล — ล่มกลางทางไม่ส่งซ้ำของที่ส่งแล้ว
        sent_n += 1
    return found, sent_n


def single_instance():
    import msvcrt
    f = open(LOCK_PATH, 'w')
    try:
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        return None
    return f                                            # ต้องถือไว้ตลอดอายุโปรเซส


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    for a in ('--setup', '--test', '--diag', '--once', '--loop'):
        g.add_argument(a, action='store_true')
    args = ap.parse_args()
    setup_logging(console=not args.loop)
    cfg = load_cfg()

    if args.setup:
        tok = input('วางโทเคนที่ได้จาก ESM แล้วกด Enter: ').strip()
        if tok:
            cfg['esm']['token'] = tok
        save_cfg(cfg)
        log.info(f'บันทึก {CFG_PATH} แล้ว')
        args.test = True

    if not cfg['esm']['token'].strip():
        log.error('ยังไม่มีโทเคน — รัน install.bat (หรือ --setup) ก่อน')
        return 2

    if args.diag:
        diag(cfg)
        return 0

    if args.test:
        try:
            log.info('ต่อ ESM: ' + ('✅ สำเร็จ' if post(cfg, {'action': 'ping'}, timeout=30).get('pong') else '❌ ตอบแปลก'))
        except Exception as e:
            log.error(f'ต่อ ESM ไม่ได้: {e}')
            return 1
        found, _ = run_once(cfg, load_state(), dry=True)
        log.info(f'เมลที่เข้าเงื่อนไขในช่วง {cfg["mail"]["lookback_days"]} วัน: {found} ฉบับ')
        return 0

    lock = single_instance()
    if lock is None:
        log.info('มีตัวอื่นรันอยู่แล้ว — ออก')
        return 0
    import pythoncom
    interval = max(1, int(cfg['mail']['interval_minutes'])) * 60
    while True:
        pythoncom.CoInitialize()
        try:
            found, n = run_once(cfg, load_state())
            if n or not args.loop:
                log.info(f'รอบนี้: เจอ {found} ฉบับ · ส่งใหม่ {n}')
        except Exception as e:
            # Outlook ยังไม่เปิด/เน็ตหลุด = ลองใหม่รอบหน้า ไม่ตาย
            log.error(f'รอบนี้ล้ม: {e}')
        finally:
            pythoncom.CoUninitialize()
        if not args.loop:
            return 0
        time.sleep(interval)


if __name__ == '__main__':
    sys.exit(main() or 0)
