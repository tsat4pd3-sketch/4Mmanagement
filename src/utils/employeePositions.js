/**
 * ตำแหน่งงานของพนักงานหน้างาน (employees.position) — source of truth เดียว (2026-07-21)
 * เดิม hardcode ซ้ำใน Register.jsx + operator.jsx (ค่าตรงกันโดยบังเอิญ) — แก้ที่นี่ที่เดียว
 * หมายเหตุ: คนละเรื่องกับ profiles.position (ตำแหน่งของ user ระบบ — free text ใน AddUser)
 */
export const EMPLOYEE_POSITIONS = ['Operator', 'Leader', 'Technician', 'Engineer', 'QC'];
