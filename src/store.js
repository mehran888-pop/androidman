'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { mergeRules } = require('./payroll/rules');
const { YEAR_PRESETS, PRESET_YEARS } = require('./payroll/presets');
const { parsePeriod, periodKey } = require('./payroll/jalali');

const DATA_DIR = process.env.PAYROLL_DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = () => ({
  version: 1,
  organization: { name: 'شرکت نمونه', footer: 'این فیش به‌صورت خودکار توسط حقوق‌یار تولید شده است.' },
  settings: {
    baleToken: '',
    baleChatId: '',
    sendDelayMs: 700,
    panelPassword: '',
  },
  rules: mergeRules({}),
  employees: [],
  periods: {},
  deliveries: [],
  meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
});

let state = null;
let saveTimer = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (state) return state;
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      state = { ...EMPTY(), ...raw };
      state.settings = { ...EMPTY().settings, ...(raw.settings || {}) };
      state.organization = { ...EMPTY().organization, ...(raw.organization || {}) };
      state.rules = mergeRules(raw.rules);
      state.employees = Array.isArray(raw.employees) ? raw.employees : [];
      state.periods = raw.periods && typeof raw.periods === 'object' ? raw.periods : {};
      state.deliveries = Array.isArray(raw.deliveries) ? raw.deliveries : [];
    } catch (err) {
      console.error('[store] فایل داده خراب است، از نسخه‌ی پشتیبان استفاده می‌شود:', err.message);
      const backup = `${DATA_FILE}.broken-${Date.now()}`;
      try { fs.copyFileSync(DATA_FILE, backup); } catch { /* ignore */ }
      state = EMPTY();
    }
  } else {
    state = EMPTY();
    save();
  }
  return state;
}

function saveNow() {
  ensureDir();
  if (state) state.meta = { ...state.meta, updatedAt: new Date().toISOString() };
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      saveNow();
    } catch (err) {
      console.error('[store] خطا در ذخیره‌سازی:', err.message);
    }
  }, 60);
  saveTimer.unref?.();
}

function flush() {
  clearTimeout(saveTimer);
  saveNow();
}

/* ---------------------------------- کارکنان --------------------------------- */

const employeeDefaults = () => ({
  baseSalary: 0,
  housingAllowance: null,
  foodAllowance: null,
  seniorityAllowance: 0,
  positionAllowance: 0,
  missionAllowance: 0,
  otherAllowances: 0,
  loanInstallment: 0,
  otherDeductions: 0,
  children: 0,
  daysWorked: 30,
  absenceDays: 0,
  overtimeHours: 0,
  nightHours: 0,
  holidayHours: 0,
  active: true,
  baleChatId: '',
});

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

function normalizeEmployee(input = {}, existing = null) {
  const base = { ...employeeDefaults(), ...(existing || {}) };
  const toNum = (v, fallback) => {
    if (v === '' || v === null || v === undefined) return fallback;
    const n = Number(
      String(v)
        .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[,٬\s]/g, ''),
    );
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const housing = input.housingAllowance !== undefined
    ? (input.housingAllowance === '' || input.housingAllowance === null ? null : toNum(input.housingAllowance, null))
    : base.housingAllowance;
  const food = input.foodAllowance !== undefined
    ? (input.foodAllowance === '' || input.foodAllowance === null ? null : toNum(input.foodAllowance, null))
    : base.foodAllowance;

  return {
    ...base,
    fullName: input.fullName !== undefined ? str(input.fullName, 120) : base.fullName || '',
    personnelCode: input.personnelCode !== undefined ? str(input.personnelCode, 40) : base.personnelCode || '',
    position: input.position !== undefined ? str(input.position, 80) : base.position || '',
    department: input.department !== undefined ? str(input.department, 80) : base.department || '',
    nationalId: input.nationalId !== undefined ? str(input.nationalId, 20) : base.nationalId || '',
    phone: input.phone !== undefined ? str(input.phone, 20) : base.phone || '',
    hireDate: input.hireDate !== undefined ? str(input.hireDate, 20) : base.hireDate || '',
    baleChatId: input.baleChatId !== undefined ? str(input.baleChatId, 40) : base.baleChatId || '',
    baseSalary: input.baseSalary !== undefined ? toNum(input.baseSalary, base.baseSalary) : base.baseSalary,
    housingAllowance: housing,
    foodAllowance: food,
    seniorityAllowance: toNum(input.seniorityAllowance, base.seniorityAllowance),
    positionAllowance: toNum(input.positionAllowance, base.positionAllowance),
    missionAllowance: toNum(input.missionAllowance, base.missionAllowance),
    otherAllowances: toNum(input.otherAllowances, base.otherAllowances),
    loanInstallment: toNum(input.loanInstallment, base.loanInstallment),
    otherDeductions: toNum(input.otherDeductions, base.otherDeductions),
    children: Math.min(toNum(input.children, base.children), 20),
    daysWorked: Math.min(toNum(input.daysWorked, base.daysWorked), 31),
    absenceDays: Math.min(toNum(input.absenceDays, base.absenceDays), 31),
    overtimeHours: toNum(input.overtimeHours, base.overtimeHours),
    nightHours: toNum(input.nightHours, base.nightHours),
    holidayHours: toNum(input.holidayHours, base.holidayHours),
    active: input.active !== undefined ? Boolean(input.active) : base.active,
  };
}

function listEmployees({ includeInactive = true } = {}) {
  const db = load();
  const list = db.employees
    .filter((e) => includeInactive || e.active)
    .slice()
    .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'fa'));
  return list;
}

function getEmployee(id) {
  return load().employees.find((e) => e.id === id) || null;
}

function createEmployee(input) {
  const db = load();
  const employee = {
    id: crypto.randomUUID(),
    ...employeeDefaults(),
    ...normalizeEmployee(input),
    createdAt: new Date().toISOString(),
  };
  db.employees.push(employee);
  save();
  return employee;
}

function updateEmployee(id, input) {
  const db = load();
  const idx = db.employees.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  db.employees[idx] = {
    ...normalizeEmployee(input, db.employees[idx]),
    id,
    updatedAt: new Date().toISOString(),
  };
  save();
  return db.employees[idx];
}

function deleteEmployee(id) {
  const db = load();
  const before = db.employees.length;
  db.employees = db.employees.filter((e) => e.id !== id);
  for (const period of Object.values(db.periods)) {
    if (period.inputs) delete period.inputs[id];
  }
  save();
  return db.employees.length < before;
}

function findEmployeeByChatId(chatId) {
  const id = String(chatId ?? '').trim();
  if (!id) return null;
  return load().employees.find((e) => String(e.baleChatId || '').trim() === id) || null;
}

function findEmployeeByCode(code) {
  const c = String(code ?? '').trim();
  if (!c) return null;
  return load().employees.find((e) => String(e.personnelCode || '').trim() === c) || null;
}

function setEmployeeChatId(id, chatId) {
  const db = load();
  const employee = db.employees.find((e) => e.id === id);
  if (!employee) return null;
  employee.baleChatId = str(chatId, 40);
  save();
  return employee;
}

/* ---------------------------------- دوره‌ها ---------------------------------- */

function getPeriod(key) {
  const db = load();
  const parsed = parsePeriod(key);
  if (!parsed) return null;
  const k = periodKey(parsed.jy, parsed.jm);
  if (!db.periods[k]) db.periods[k] = { key: k, inputs: {}, locked: false, updatedAt: null };
  if (!db.periods[k].inputs) db.periods[k].inputs = {};
  return db.periods[k];
}

function setPeriodInput(periodKeyValue, employeeId, inputs) {
  const period = getPeriod(periodKeyValue);
  if (!period) return null;
  const employee = getEmployee(employeeId);
  if (!employee) return null;
  const merged = { ...(period.inputs[employeeId] || {}), ...pickInputs(inputs) };
  period.inputs[employeeId] = merged;
  period.updatedAt = new Date().toISOString();
  save();
  return merged;
}

const INPUT_FIELDS = [
  'daysWorked',
  'absenceDays',
  'overtimeHours',
  'nightHours',
  'holidayHours',
  'baseSalary',
  'children',
  'positionAllowance',
  'seniorityAllowance',
  'otherAllowances',
  'missionAllowance',
  'loanInstallment',
  'otherDeductions',
];

function pickInputs(inputs = {}) {
  const out = {};
  for (const field of INPUT_FIELDS) {
    const value = inputs[field];
    if (value === undefined) continue;
    if (value === null || value === '') {
      // خالی‌کردن حق مسکن/بن یعنی برگشت به نرخ پیش‌فرض سازمان
      if (field === 'housingAllowance' || field === 'foodAllowance') out[field] = null;
      continue;
    }
    const n = Number(
      String(value)
        .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[,٬\s]/g, ''),
    );
    if (Number.isFinite(n) && n >= 0) out[field] = n;
  }
  return out;
}

function getPeriodInputs(key) {
  const period = getPeriod(key);
  return period ? period.inputs : {};
}

function copyPeriodInputs(fromKey, toKey) {
  const from = getPeriod(fromKey);
  const to = getPeriod(toKey);
  if (!from || !to) return false;
  to.inputs = JSON.parse(JSON.stringify(from.inputs || {}));
  to.updatedAt = new Date().toISOString();
  save();
  return true;
}

/* --------------------------------- تنظیمات ---------------------------------- */

function getRules() {
  return mergeRules(load().rules);
}

function updateRules(patch = {}) {
  const db = load();
  const next = mergeRules({ ...db.rules, ...patch });
  const numericFields = [
    'minimumMonthlyWage', 'housingAllowance', 'foodAllowance', 'familyAllowancePerChild',
    'childrenCap', 'monthlyHours', 'standardMonthDays', 'overtimeMultiplier', 'nightPremiumRate',
    'holidayMultiplier', 'employeeInsuranceRate', 'employerInsuranceRate',
    'employeeUnemploymentRate', 'employerUnemploymentRate', 'insuranceCeilingMultiplier',
    'taxExemptionMonthly', 'roundTo',
  ];
  for (const f of numericFields) {
    const n = Number(next[f]);
    next[f] = Number.isFinite(n) && n >= 0 ? n : db.rules[f];
  }
  for (const f of ['familyAllowanceAuto', 'insuranceOnTaxable', 'prorateAllowances', 'taxFreeMission']) {
    next[f] = Boolean(next[f]);
  }
  next.taxBrackets = (next.taxBrackets || [])
    .filter((b) => b && (b.upTo === null || Number(b.upTo) >= 0) && Number(b.rate) >= 0)
    .sort((a, b) => (a.upTo === null ? Infinity : a.upTo) - (b.upTo === null ? Infinity : b.upTo));
  if (!next.taxBrackets.length) next.taxBrackets = db.rules.taxBrackets;
  db.rules = next;
  save();
  return next;
}

/** اعمال نرخ‌های یک سال (مثلاً از ۱۴۰۴ به ۱۴۰۵) */
function applyYearPreset(year) {
  const preset = YEAR_PRESETS[Number(year)];
  if (!preset) return null;
  const db = load();
  db.rules = mergeRules({ ...db.rules, ...preset });
  save();
  return db.rules;
}

function getSettings({ mask = true } = {}) {
  const s = load().settings;
  return {
    ...s,
    baleToken: mask ? maskToken(s.baleToken) : s.baleToken,
    hasBaleToken: Boolean(s.baleToken),
  };
}

function maskToken(token) {
  if (!token) return '';
  if (token.length <= 8) return '••••';
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

function updateSettings(patch = {}) {
  const db = load();
  const next = { ...db.settings };
  if (patch.baleToken !== undefined && patch.baleToken !== null && patch.baleToken !== '') {
    const token = String(patch.baleToken).trim();
    if (!token.includes('•')) next.baleToken = token; // مقدار ماسک‌شده را ذخیره نکن
  }
  if (patch.clearBaleToken) next.baleToken = '';
  if (patch.baleChatId !== undefined) next.baleChatId = str(patch.baleChatId, 40);
  if (patch.sendDelayMs !== undefined) {
    const n = Number(patch.sendDelayMs);
    next.sendDelayMs = Number.isFinite(n) ? Math.min(Math.max(n, 0), 10000) : db.settings.sendDelayMs;
  }
  db.settings = next;
  save();
  return getSettings();
}

function getOrganization() {
  return { ...load().organization };
}

function updateOrganization(patch = {}) {
  const db = load();
  db.organization = {
    name: patch.name !== undefined ? str(patch.name, 120) : db.organization.name,
    footer: patch.footer !== undefined ? str(patch.footer, 300) : db.organization.footer,
  };
  save();
  return getOrganization();
}

/* --------------------------------- ارسال‌ها ---------------------------------- */

function addDelivery(entry) {
  const db = load();
  const record = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    ...entry,
  };
  db.deliveries.push(record);
  if (db.deliveries.length > 5000) db.deliveries = db.deliveries.slice(-4000);
  save();
  return record;
}

function listDeliveries({ period, limit = 200 } = {}) {
  return load()
    .deliveries.filter((d) => !period || d.period === period)
    .slice(-limit)
    .reverse();
}

function wasDelivered(period, employeeId) {
  return load().deliveries.some(
    (d) => d.period === period && d.employeeId === employeeId && d.status === 'sent',
  );
}

function getRawState() {
  return load();
}

module.exports = {
  DATA_FILE,
  load,
  save,
  flush,
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  normalizeEmployee,
  findEmployeeByChatId,
  findEmployeeByCode,
  setEmployeeChatId,
  getPeriod,
  getPeriodInputs,
  setPeriodInput,
  copyPeriodInputs,
  pickInputs,
  getRules,
  updateRules,
  applyYearPreset,
  PRESET_YEARS,
  getSettings,
  updateSettings,
  getOrganization,
  updateOrganization,
  addDelivery,
  listDeliveries,
  wasDelivered,
  getRawState,
  maskToken,
  INPUT_FIELDS,
};
