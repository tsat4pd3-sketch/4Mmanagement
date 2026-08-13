-- Seed ชุดเอกสาร PE ของพาร์ท P703 (MB3B-16E060-CH) — นำเข้าโครงจากไฟล์จริงที่ user อัปโหลด (2026-08-13)
-- PFC-P703-01 Rev.12 / FMEA-P703-01 Rev.33 / CNP-P703-01 Rev.22 · Main project
-- ขอบเขต seed: โครง 28 OP ครบ (op/เครื่อง/child part ตรวจจาก CNP รายชีทแล้ว) + FMEA/CP ของ OP130 เป็นตัวอย่าง
--   + ประวัติ revision 44 รายการจาก cover ทั้ง 2 เอกสาร (rev_no = null — cover จริงไม่ระบุเลขรายแถว)
-- เนื้อหา FMEA/CP ของ OP อื่นให้ทีม PE เติม/นำเข้าภายหลัง (ตัว import Excel = เฟสถัดไป)
-- idempotent: มีชุดนี้อยู่แล้ว = ข้ามทั้งก้อน (guard ด้วย id คงที่)
do $seed$
begin
  if exists (select 1 from pe_doc_sets where id = 'ae093964-1500-4c73-b1e9-2b8ae34ae424') then return; end if;

  insert into pe_doc_sets (id, part_no, mat_no, part_name, model, customer, line_name, doc_no_pfc, doc_no_fmea, doc_no_cp, status, remark, created_by_name)
  values ('ae093964-1500-4c73-b1e9-2b8ae34ae424', 'MB3B-16E060-CH', null, 'REINF ASY FRT FNDR INR BDY RH', 'P703', 'FORD', 'Line 60', 'PFC-P703-01', 'FMEA-P703-01', 'CNP-P703-01', 'active',
  'นำเข้าโครงจากไฟล์จริง PFC Rev.12 / FMEA Rev.33 / CNP Rev.22 (2026-08-13) — เนื้อหา FMEA/CP ครบทุก OP ให้ทีม PE ทยอยเติม/นำเข้า', 'ระบบ (นำเข้าจากไฟล์ Excel)');
  
  insert into pe_processes (id, set_id, op_no, seq, name, kind, machine_no, child_parts, remark) values
  ('4c2fdeae-c045-41b2-86c5-97d5a5b08165','ae093964-1500-4c73-b1e9-2b8ae34ae424','10',10,'INCOMING INSP. + STORAGE','incoming_insp',null,'W520771-S NUT WELD M6 HF 10','OP 10.1 Incoming Insp. / 10.2 Storage'),
  ('90fc3a60-b61e-46fd-8835-a824e9fe53b3','ae093964-1500-4c73-b1e9-2b8ae34ae424','20',20,'INCOMING INSP. + STORAGE','incoming_insp',null,'W520772-S NUT WELD M8 HF 10','OP 20.1 Incoming Insp. / 20.2 Storage'),
  ('0eec4647-22ec-440b-bbf1-9e373ccb0c77','ae093964-1500-4c73-b1e9-2b8ae34ae424','30',30,'INCOMING INSP. + STORAGE','incoming_insp',null,'W520781-S NUT WELD M6 HF THDLS 10','OP 30.1 Incoming Insp. / 30.2 Storage'),
  ('d36fb84a-81c9-470d-ba92-4e940562702d','ae093964-1500-4c73-b1e9-2b8ae34ae424','40',40,'INCOMING INSP. + STORAGE','incoming_insp',null,'W520782-S NUT WELD M8 HF THDLS 10','OP 40.1 Incoming Insp. / 40.2 Storage'),
  ('31832a22-8eef-468b-8ab1-1ea5a9b73e7b','ae093964-1500-4c73-b1e9-2b8ae34ae424','50',50,'INCOMING INSP. + STORAGE','incoming_insp',null,'W717477-S NUT RIVET','OP 50.1 Incoming Insp. / 50.2 Storage'),
  ('5a10a0cf-f53a-4485-8c97-a26487544a5b','ae093964-1500-4c73-b1e9-2b8ae34ae424','60',60,'INCOMING INSP. + STORAGE','incoming_insp',null,'MB3B-16C172-AC BAR FRT FNDR LWR SUPT','OP 60.1 Incoming Insp. / 60.2 Storage'),
  ('4b4bfba5-d08a-43dd-aaa8-5525f6da2a8d','ae093964-1500-4c73-b1e9-2b8ae34ae424','70',70,'INCOMING INSP. + STORAGE','incoming_insp',null,'MB3B-16088-BB BRA ASY FRT FNDR OPG RR','OP 70.1 Incoming Insp. / 70.2 Storage'),
  ('bd8b8891-848d-40d1-a180-597e4baf8913','ae093964-1500-4c73-b1e9-2b8ae34ae424','80',80,'INCOMING INSP. + STORAGE','incoming_insp',null,'MB3B-16290-BC BRKT FRT FNDR TO PLR SUPORT','OP 80.1 Incoming Insp. / 80.2 Storage'),
  ('a9150379-6e3c-4645-a24a-181e5f19262a','ae093964-1500-4c73-b1e9-2b8ae34ae424','90',90,'INCOMING INSP. + STORAGE','incoming_insp',null,'MB3B-16A126-AB GST FRT FNDR APR & RAD SUPT','OP 90.1 Incoming Insp. / 90.2 Storage'),
  ('f5c902b7-85a6-4f62-80b7-0adc2c447881','ae093964-1500-4c73-b1e9-2b8ae34ae424','100',100,'HYDROFORM FAMILY (MB3B-16C274 RH)','process',null,'MB3B-16C274-CG REINF FRT FNDR INR BDY FRT RH','Sub-op 100.1 Incoming → 100.2 Storage → Bending → Preforming → Hydroforming → Laser cutting (100.8) → Dot marking → Inspection — แตกราย sub-op ได้ภายหลัง (อ้าง PFC Rev.12)'),
  ('3b8dfa69-a4ba-494e-afb1-a719b8dfd500','ae093964-1500-4c73-b1e9-2b8ae34ae424','110',110,'PROGRESSIVE STAMPING (MB3B-16E024-BC)','process',null,'MB3B-16E024-BC REINF FRT FNDR @ BAT MTNG LWR','Sub-op 110.1-110.10: Pierce+Blank+Cut → Form 1 → Form 2 → Pierce+Cam Pierce → Final Inspection'),
  ('a37fc6ca-ba8b-4505-9384-c6e9342d89a6','ae093964-1500-4c73-b1e9-2b8ae34ae424','120',120,'PROGRESSIVE STAMPING (MB3B-E02446-AA)','process',null,'MB3B-E02446-AA SUPT FRT WHL/HS CTR RR','Sub-op 120.1-120.5 + Final Inspection'),
  ('454ce82d-80b7-4ab7-b58b-dfe7c209170d','ae093964-1500-4c73-b1e9-2b8ae34ae424','130',130,'PROJECTION WELD NUT','process','SP-82','MB3B-16A126-AB
  W520771-S NUT WELD M6 ×1',null),
  ('3a570537-90f5-4ee5-afd3-802ecb0fc6d0','ae093964-1500-4c73-b1e9-2b8ae34ae424','140',140,'PROJECTION WELD NUT','process','SP-82','MB3B-16C172-AC
  W520771-S NUT WELD M6',null),
  ('56573819-cb7b-4289-ade2-3829a96eff7c','ae093964-1500-4c73-b1e9-2b8ae34ae424','150',150,'PROJECTION WELD NUT','process','SP-74','MB3B-16E024-BC
  W520781-S NUT WELD M6 THDLS',null),
  ('3b63e364-6c2a-4b54-816d-73a844f2c273','ae093964-1500-4c73-b1e9-2b8ae34ae424','160',160,'PROJECTION WELD NUT','process','SP-10','MB3B-16290-BC
  W520771-S NUT WELD M6 ×2',null),
  ('51470122-d92b-42e2-a00d-f2e955130c10','ae093964-1500-4c73-b1e9-2b8ae34ae424','170',170,'PROJECTION WELD NUT','process','SP-85','MB3B-16C274
  W520782-S NUT WELD M8 THDLS','Robot RB-132'),
  ('b361a79f-5a19-4b74-978d-95e1941d53b6','ae093964-1500-4c73-b1e9-2b8ae34ae424','180',180,'PROJECTION WELD NUT','process','SP-78','MB3B-16C274
  W520772-S NUT WELD M8','Robot RB-114'),
  ('adfa06db-b619-4c77-a6c2-0f0a4111af7c','ae093964-1500-4c73-b1e9-2b8ae34ae424','190',190,'PROJECTION WELD NUT','process','SP-80','MB3B-16C274
  W520771-S NUT WELD M6','Robot RB-116 · JIG 2 / JIG 4'),
  ('ba95c2b9-1ae2-4100-883c-af0ecc763928','ae093964-1500-4c73-b1e9-2b8ae34ae424','200',200,'ARC WELDING (CO2)','process','RB-122',null,'Robot welding · JIG 5'),
  ('380636f1-68de-4d91-8d3f-be2b58f34484','ae093964-1500-4c73-b1e9-2b8ae34ae424','210',210,'PROJECTION WELD NUT','process','SP-81','MB3B-16A126-AB
  W520781-S NUT WELD M6 THDLS','Robot RB-119'),
  ('a4eb1c4a-61dd-4f90-8ffa-c584fd45a3eb','ae093964-1500-4c73-b1e9-2b8ae34ae424','220',220,'ARC WELDING (CO2)','process','RB-126',null,'Robot welding'),
  ('02663ee0-12c2-49aa-9148-1b1a914a5eb8','ae093964-1500-4c73-b1e9-2b8ae34ae424','230',230,'ARC WELDING (CO2)','process','RB-127',null,'Robot welding · JIG 6'),
  ('a96592bf-d5f9-48ac-bb38-9645235c91c8','ae093964-1500-4c73-b1e9-2b8ae34ae424','240',240,'RIVET','process',null,'W717477-S NUT RIVET ×2','RIVET GUN'),
  ('0a834541-98e0-4961-854b-6682583436f6','ae093964-1500-4c73-b1e9-2b8ae34ae424','250',250,'WELD INSPECTION + REWORK','inspection',null,null,'เพิ่มโดย rev 08/03/2023 (Add process welding inspection and rework)'),
  ('47d277fc-3281-4ab6-aa6c-5d7a82fd9a7c','ae093964-1500-4c73-b1e9-2b8ae34ae424','260',260,'FINAL INSPECTION','inspection',null,null,null),
  ('9c9d464d-aa2c-4bdc-a41e-4ec8926bae90','ae093964-1500-4c73-b1e9-2b8ae34ae424','270',270,'WAREHOUSE','warehouse',null,null,null),
  ('1ba43e54-22fc-4599-8f7f-4ca69d143d63','ae093964-1500-4c73-b1e9-2b8ae34ae424','280',280,'DELIVERY','delivery',null,null,null);
  
  insert into pe_fmea_items (process_id, seq, requirement, failure_mode, effects, severity, classification, causes, prevention, occurrence, detection_ctrl, detection, recommended_action, responsibility, action_taken, new_severity, new_occurrence, new_detection) values
  ('454ce82d-80b7-4ab7-b58b-dfe7c209170d',1,'- Nut thread Q''ty 1 Pc.','- Missing nut','TSAT4: Sorted 100% and rework offline
  Assembly plant: Can not assembled',7,null,'- Nut feeder wrong position
  - Nut feeder broken
  - Operator not follow SOP
  - Proximity have a problem
  - Skip process','- PPM check sheet
  - PM check sheet
  - OJT operator
  - Program recheck sensor signal
  - Step counter',3,'- Visual check
  - Skill training
  - PPM check sheet',4,'- Install sensor and support
  - Alarm welding error / counter step incomplete / water flow error
  - Install poka-yoke check missing nut in assembly line','PD','- Sensor check nut / setting sensor after change model & tip dressing
  - M/C alarm + do not release electricity
  - Poka-yoke check',7,2,3),
  ('454ce82d-80b7-4ab7-b58b-dfe7c209170d',2,'- Nut m6 thread','- Nut wrong type','TSAT4: Sorted 100% and rework offline
  Assembly plant: Sorted 100% and rework',7,null,'- Mixing from supplier
  - Wrong area store
  - Operator not understand about type nut
  - Fill nut wrong type','- Supplier check before delivery
  - Tag on shelf
  - OJT operator
  - Checking with the lead sensor',3,'- Incoming inspection
  - Visual check
  - Pokayoke in rail nut feeder',6,'- Add check dummy 5 pcs. before production by PD
  - Add reed sensor for check distance sensor
  - Add cover nut feeder','PD','- PPM no. PPM-PD3-001
  - Cover nut feeder',7,3,5),
  ('454ce82d-80b7-4ab7-b58b-dfe7c209170d',3,'- Position of nut weld','- Nut offset','- Can not assembly next process',5,null,'- Diameter Guide Pin less than STD.','- Check diameter guide pin before production
  - Change guide pin at the specified time',3,'- Checking Fixture',8,'- Add step counter on stationary for specified timing to change guide pin
  - Install poka-yoke for detection in assembly line','PD','- Alarm timing change guide pin on stationary M/C Ref. SOP NO. FTM-P703-068
  - Poka-Yoke in assembly line',5,2,6),
  ('454ce82d-80b7-4ab7-b58b-dfe7c209170d',4,'- Nut weld torque test ≥ 20Nm','- Nut cold weld','TSAT4: Scrap and sorted 100%
  Assembly plant: Rework offline and sorted 100%',7,null,'- Electrode not available
  - Leakage current
  - Wrong condition
  - Shape part not meet requirement','- Check availability surface electrode
  - Check current for welding
  - Check condition before production
  - Stamping inspection report',3,'- Visual check
  - Weld scope
  - Non-destructive test before production
  - Taper feeler gauge',8,'- Destructive test before production 1 pc.','QA','- Follow destructive test result FM-QA-064',7,2,6);
  
  insert into pe_cp_items (process_id, char_no, product_char, process_char, person, spec, method, sample_size, frequency, control_method, reaction_plan) values
  ('454ce82d-80b7-4ab7-b58b-dfe7c209170d',1,null,'WELDING PARAMETER','JIG MTN','FOLLOW SOP NO. FTM-P703-068','TEACHING BOX / WELD SCOPE','1 TIME','EVERY MONTH','CHECK SHEET CONDITION NO.FM-PE1-037','STOP PROCESS AND ADJUST MACHINE'),
  ('454ce82d-80b7-4ab7-b58b-dfe7c209170d',2,null,'CHECK MACHINE AND NUT FEEDER','PD','MACHINE AND NUT FEEDER AVAILABILITY FOLLOW PPM NO.FM-PD3-001
  POKA YOKE CHECK
  ELECTRODE FILLING','VISUAL CHECK
  RUN RED RABBIT
  CARBON IMPRESSION CHECK','1 TIME','BEFORE PRODUCTION EVERY SHIFT','PPM NO.FM-PD3-001
  CHECK SHEET PARALLEL STRENGTH UPPER&LOWER NO.FM-PD3-003','STOP PROCESS AND ADJUST MACHINE'),
  ('454ce82d-80b7-4ab7-b58b-dfe7c209170d',3,'QUANTITY OF NUT',null,'PD','NUT M6 THREAD 1 PC.','STEP COUNTER AND VISUAL CHECK','1','EVERY SHIFT','PD BLUE MARK','RECHECK PART'),
  ('454ce82d-80b7-4ab7-b58b-dfe7c209170d',4,'APPEARANCE',null,'PD','PRESENCE OF REQUIRED CHILD PARTS / CORRECT PART
  METAL SPATTERS / THREADS / NUT REVERSE WELD','VISUAL CHECK','1 TIME','EVERY 2 HOUR','LINE CHECK SHEET NO. FM-PE1-050','REPAIR PART & RECHECK'),
  ('454ce82d-80b7-4ab7-b58b-dfe7c209170d',5,'WELDING QUALITY','DESTRUCTIVE / NON-DESTRUCTIVE TEST','QA','DESTRUCTIVE ≥ 20 NM. (1 PC.)
  NON-DESTRUCTIVE ≥ 14 NM. (3 PCS. FIRST/MIDDLE/END)','TORQUE TEST','1 PC. / 3 PCS.','BEFORE PRODUCTION + EVERY SHIFT','DESTRUCTIVE TEST RESULT NO. FM-QA-064
  INSPECTION DATA REPORT NO. FM-QA-112','STOP PROCESS AND ADJUST MACHINE');
  
  insert into pe_doc_revisions (set_id, doc_type, rev_no, rev_date, suffix, ecn_no, content, ref_kind, ref_id, issued_by, checked_by, approved_by) values
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-11-03','MB3B-16E060-CG',null,'Process 230 BRKT wrong position',null,null,'Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-09-16','MB3B-16E060-CG',null,'Process 210 Missing nut m6 (WLS00292)','claim','WLS00292','Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-09-10','MB3B-16E060-CG',null,'Process 160 Double nut (W3501083)','claim','W3501083','Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-08-21','MB3B-16E060-CG',null,'Process 130 Nut m6 wrong trype',null,null,'Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-07-17','MB3B-16E060-CG',null,'Process 210 Missing nut m6 (WLS6042)','claim','WLS6042','Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-06-26','MB3B-16E060-CG',null,'Process 200 Nut offset (W356042)','claim','W356042','Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-05-26','MB3B-16E060-CG','MAY23001','Process 160 and 170 Change nut type',null,null,'Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-05-25','MB3B-16E060-CG',null,'Process 100.8 Laser cut incomplete (WLS6033)','claim','WLS6033','Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-03-30','MB3B-16E060-CG',null,'Process 230 Spatter cling to hole (W356025)','claim','W356025','Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-03-20','MB3B-16E060-CG',null,'Process 100.8 Laser cut incomplete (W356025)','claim','W356025','Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-03-08','MB3B-16E060-CG',null,'Add process welding inspection and rework',null,null,'Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-03-03','MB3B-16E060-CG',null,'Process 240 Missing rivet (W356014)','claim','W356014','Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2023-01-18','MB3B-16E060-CG',null,'Process 200 Missing nut m6 threadlesss (WLS6005)','claim','WLS6005','Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2022-12-23','MB3B-16E060-CG','C14419067','Part no. MB3B-16C274 Move rivet hole 25 mm',null,null,'Tiptawan K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2022-09-12','MB3B-16E060-CF',null,'Process 180 Missing nut m6 (VLS6120)','claim','VLS6120','Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2022-07-26','MB3B-16E060-CF',null,'Process 240 Missing nut rivet m6 (VLS6048&VLS6093&V9Y0101)','claim','VLS6048','Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2022-07-03','MB3B-16E060-CF',null,'Process 130 Missing nut m6 (VLS6080)','claim','VLS6080','Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2022-06-29','MB3B-16E060-CF',null,'Process 180 Missing nut m6 (VLS6069&VLS6077)','claim','VLS6069','Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2022-06-27','MB3B-16E060-CF',null,'Process 170 Nut weld off opposite (VLS6081)','claim','VLS6081','Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2022-06-18','MB3B-16E060-CF',null,'Process 160 Missing nut weld m8 (V356073)','claim','V356073','Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2022-06-13','MB3B-16E060-CF',null,'Process 150 Missing nut weld m6 (VLS6045)','claim','VLS6045','Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2021-11-18','MB3B-16E060-CF','C14284165','Part no. MB3B-16C274 change access hole to clearance hole | Part no. MB3B-16E024 modified anti rotation slot size',null,null,'Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2021-10-22','MB3B-16E060-CE',null,'Nut m6 offset (3846158)','claim','3846158','Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2021-10-20','MB3B-16E060-CE',null,'Process 210 Rusty in nut (3846729)','claim','3846729','Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2021-10-15','MB3B-16E060-CE',null,'Process 160 Nut m8 have spatter on thread (3845034)','claim','3845034','Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2021-08-26','MB3B-16E060-CE','C14247830','Part no. MB3B-16C172 remove 2 hole and add chamfer notch',null,null,'Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2021-06-17','MB3B-16E060-CD','C14228094','Part no. MB3B-16C274 modified slot hole',null,null,'Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2021-05-15','MB3B-16E060-CC','C14175617','Part no. MB3B-16E024 change hole size | Part no. MB3B-16A126 add hex hole and remove hole location | Part no. MB3B-16290 Add return flange | Add nut rivet(W717477) 1 pc.',null,null,'Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2021-05-06','MB3B-16E060-CB','C14170517','Part no. MB3B-16C274 Add and remove hole | Part no. MB3B-16C172 Change trim edge and form | Part no. MB3B-16088 modified form | Part no. MB3B-16290 change trim edge and modified hole',null,null,'Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2020-11-13','MB3B-16E060-CA','C14072232','Add Part no. MB3B-16088 and MB3B-16290 | Add nut m6 thread 2 Pcs.',null,null,'Pensiri V.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','fmea',null,'2020-03-04','MB3B-16E060-CA',null,'New Issue',null,null,'Pensiri V.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2024-06-20','MB3B-16E060-CH',null,'Annual review FY2024',null,null,'Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2024-02-29','MB3B-16E060-CH','C14562222','Part no. MB3B-16C274-C The slug opening angle minimum 91° | Part no. MB3B-16C274-C Change size tolerance one hole + 0.25',null,null,'Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2023-08-01','MB3B-16E060-CG',null,'Review Comply with Internal Audit Fy 2023',null,null,'Suphakon T.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2023-05-26','MB3B-16E060-CG',null,'Process 160 and 170 change  nut type',null,null,'Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2023-03-08','MB3B-16E060-CG',null,'Add Process Welding Inspection and rework',null,null,'Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2022-12-23','MB3B-16E060-CG','C14419067','Part no. MB3B-16C274 Move rivet hole 25 mm',null,null,'Tiptawan K.','Pensiri V.','Somyong K.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2021-11-18','MB3B-16E060-CF','C14284165','Part no. MB3B-16C274 change access hole to clearance hole | Part no. MB3B-16E024 modified anti rotation slot size',null,null,'Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2021-08-26','MB3B-16E060-CE','C14247830','Part no. MB3B-16C172 remove 2 hole and add chamfer notch',null,null,'Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2021-06-17','MB3B-16E060-CD','C14228094','Part no. MB3B-16C274 modified slot hole',null,null,'Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2021-05-15','MB3B-16E060-CC','C14175617','Part no. MB3B-16E024 change hole size | Part no. MB3B-16A126 add hex hole and remove hole location | Part no. MB3B-16290 Add return flange | Add nut rivet (W717477) 1 pc.',null,null,'Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2021-05-06','MB3B-16E060-CB','C14170517','Part no. MB3B-16C274 Add and remove hole | Part no. MB3B-16C172 Change trim edge and form | Part no. MB3B-16088 modified form | Part no. MB3B-16290 change trim edge and modified hole',null,null,'Sarawut K.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2020-11-13','MB3B-16E060-CA','C14072232','Add Part no. MB3B-16088 and MB3B-16290 | Add nut m6 thread 2 Pcs.',null,null,'Pensiri V.','Pensiri V.','Prasit M.'),
  ('ae093964-1500-4c73-b1e9-2b8ae34ae424','pfc',null,'2020-03-04','MB3B-16E060-CA',null,'New Issue',null,null,'Pensiri V.','Pensiri V.','Prasit M.');
end $seed$;
