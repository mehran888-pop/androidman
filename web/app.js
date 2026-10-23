/* حقوق‌یار — رابط کاربری (بدون build، وانیلا JS) */
(() => {
  'use strict';

  /* ------------------------------- ابزارها ------------------------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

  const fa = (value) => String(value ?? '').replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

  const fmt = (value) => {
    const n = Math.round(Number(value) || 0);
    return n.toLocaleString('en-US');
  };

  const money = (value) => `${fa(fmt(value))} <small>تومان</small>`;

  const parseNum = (value) => {
    if (value === null || value === undefined) return 0;
    const s = String(value)
      .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
      .replace(/[^\d.-]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };

  const esc = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const initials = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '؟';
    return parts[0].charAt(0) + (parts[1] ? parts[1].charAt(0) : '');
  };

  const toEnglishDigits = (value) =>
    String(value ?? '').replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));

  const formatAmountInput = (value) => {
    const digits = toEnglishDigits(value).replace(/[^\d]/g, '');
    if (!digits) return '';
    return Number(digits).toLocaleString('en-US');
  };

  const pct = (value) => `${fa(Math.round(Number(value) * 1000) / 10)}٪`;

  /* --------------------------------- وضعیت -------------------------------- */

  const store = {
    password: localStorage.getItem('hy.password') || '',
    period: localStorage.getItem('hy.period') || '',
    tab: localStorage.getItem('hy.tab') || 'payroll',
    // در نسخه‌ی اندروید آدرس سرور دستی تنظیم می‌شود
    apiBase: (localStorage.getItem('hy.apiBase') || '').replace(/\/+$/, ''),
  };

  const state = {
    meta: null,
    periodData: null,
    employees: [],
    results: null,
    busy: false,
  };

  /* --------------------------------- API ---------------------------------- */

  async function request(path, { method = 'GET', body, raw = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (store.password) headers['x-panel-password'] = store.password;
    const res = await fetch(`${store.apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401) {
      showLogin();
      throw new Error('نیاز به ورود');
    }

    if (raw) {
      if (!res.ok) throw new Error('خطا در دریافت فایل');
      return res;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `خطای ${res.status}`);
    return data;
  }

  const api = {
    get: (p) => request(p),
    post: (p, body) => request(p, { method: 'POST', body }),
    put: (p, body) => request(p, { method: 'PUT', body }),
    del: (p) => request(p, { method: 'DELETE' }),
  };

  /* --------------------------------- UI پایه ------------------------------- */

  let toastTimer;
  function toast(message, type = '') {
    const el = $('#toast');
    el.textContent = message;
    el.className = `toast ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  function setLoading(on) {
    state.busy = on;
    $('#loadingBar').classList.toggle('hidden', !on);
  }

  const sheetWrap = $('#sheetWrap');
  const sheet = $('#sheet');

  function openSheet(html, onMount) {
    sheet.innerHTML = html;
    sheetWrap.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    sheet.scrollTop = 0;
    if (onMount) onMount(sheet);
    setTimeout(() => sheet.focus({ preventScroll: true }), 30);
  }

  function closeSheet() {
    sheetWrap.classList.add('hidden');
    sheet.innerHTML = '';
    document.body.style.overflow = '';
  }

  function showLogin() {
    $('#loginOverlay').classList.remove('hidden');
    setTimeout(() => $('#loginPassword').focus(), 100);
  }

  function hideLogin() {
    $('#loginOverlay').classList.add('hidden');
    $('#loginError').textContent = '';
    $('#loginPassword').value = '';
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = $('#loginPassword').value;
    store.password = pass;
    try {
      const res = await request('/api/auth/check', { method: 'POST' });
      if (!res.ok) throw new Error('نادرست');
      localStorage.setItem('hy.password', pass);
      hideLogin();
      await boot();
    } catch {
      localStorage.removeItem('hy.password');
      store.password = '';
      $('#loginError').textContent = 'رمز عبور نادرست است.';
    }
  });

  /* --------------------------------- بوت ---------------------------------- */

  async function boot() {
    setLoading(true);
    try {
      const meta = await api.get('/api/state');
      state.meta = meta;
      $('#orgName').textContent = meta.organization.name || 'محاسبه حقوق و دستمزد';
      document.title = `حقوق‌یار | ${meta.organization.name || ''}`.trim();

      const periodKeys = meta.periods.map((p) => p.key);
      if (!store.period || !periodKeys.includes(store.period)) {
        store.period = meta.today.key;
      }
      await Promise.all([loadPeriod(store.period), loadEmployees()]);
      render();
    } catch (err) {
      if (!/نیاز به ورود/.test(err.message)) {
        $('#view').innerHTML = store.apiBase
          ? `<div class="alert error">خطا در بارگذاری: ${esc(err.message)}</div>`
          : serverSetupView(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  function serverSetupView(errorText) {
    return `
      <section class="hero">
        <p class="hero-label">خوش آمدید</p>
        <p class="hero-value" style="font-size:20px">اتصال به سرور حقوق‌یار</p>
        <p class="small" style="opacity:.85;margin:8px 0 0">
          این نسخه‌ی اندرویدی است و برای محاسبه و ارسال فیش، به سرور Node.js نیاز دارد.
          آدرس سرور را وارد کنید (مثلاً <span class="ltr">https://payroll.example.com</span>).
        </p>
      </section>
      <section class="card">
        <label class="field"><span>آدرس سرور</span>
          <input id="apiBaseInput" class="ltr" placeholder="https://payroll.example.com" value="${esc(store.apiBase)}" />
          <span class="hint">اگر سرور روی کامپیوتر خودتان است و گوشی در همان وای‌فای قرار دارد: <span class="ltr">http://192.168.1.10:3000</span></span>
        </label>
        <button class="btn btn-primary btn-block" data-action="save-api-base">اتصال</button>
        ${errorText ? `<div class="alert error small" style="margin-top:12px">${esc(errorText)}</div>` : ''}
        <p class="tiny muted" style="margin-bottom:0">راهنمای کامل در فایل README پروژه آمده است.</p>
      </section>`;
  }

  async function loadPeriod(key) {
    const data = await api.get(`/api/period/${key}`);
    state.periodData = data;
    store.period = data.key;
    localStorage.setItem('hy.period', data.key);
    $('#periodLabel').textContent = data.label;
  }

  async function loadEmployees() {
    const data = await api.get('/api/employees');
    state.employees = data.employees;
  }

  function periodLabelOf(key) {
    const p = state.meta?.periods.find((x) => x.key === key);
    if (p) return p.label;
    const m = /^(\d{4})-(\d{2})$/.exec(key || '');
    return m ? `${state.meta?.months[Number(m[2]) - 1] || ''} ${m[1]}` : key;
  }

  /* --------------------------------- رندر --------------------------------- */

  function render() {
    $$('.nav-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === store.tab));
    const view = $('#view');
    if (store.tab === 'employees') view.innerHTML = employeesView();
    else if (store.tab === 'send') view.innerHTML = sendView();
    else if (store.tab === 'settings') view.innerHTML = settingsView();
    else view.innerHTML = payrollView();

    if (store.tab === 'send') mountSendView();
    if (store.tab === 'settings') mountSettingsView();
  }

  /* -------------------------------- فیش‌ها -------------------------------- */

  function payrollView() {
    const data = state.periodData;
    if (!data) return '<div class="empty">در حال بارگذاری…</div>';
    const t = data.totals;

    if (!data.items.length) {
      return `
        ${heroBlock(t, data.label)}
        <div class="empty">
          <div class="icon">👥</div>
          <h3>هنوز پرسنلی ثبت نشده</h3>
          <p>برای محاسبه‌ی حقوق، ابتدا کارکنان را اضافه کنید.</p>
          <button class="btn btn-primary" data-action="new-employee">افزودن پرسنل</button>
        </div>`;
    }

    return `
      ${heroBlock(t, data.label)}
      <div class="toolbar">
        <button class="btn btn-sm btn-soft" data-action="copy-previous">⤵️ کپی از ماه قبل</button>
        <button class="btn btn-sm" data-action="choose-period">📅 تغییر دوره</button>
        <button class="btn btn-sm" data-action="goto-send">📤 ارسال به بله</button>
      </div>
      <div class="section-title"><span>پرسنل دوره (${fa(t.headcount)} نفر)</span><span class="tiny muted">برای ویرایش کارکرد در هر ردیف ضربه بزنید</span></div>
      ${data.items
        .map((item) => {
          const p = item.payslip;
          const hasChat = data.employees.find((e) => e.id === item.employeeId)?.baleChatId;
          const warn = p.warnings.length;
          return `
            <button class="employee-card" data-action="edit-item" data-id="${item.employeeId}">
              <div class="avatar">${esc(initials(p.employee.fullName))}</div>
              <div class="employee-main">
                <strong>${esc(p.employee.fullName || 'بدون نام')}</strong>
                <span>${esc(p.employee.position || 'بدون سِمَت')} • کارکرد ${fa(p.input.effectiveDays)} روز${p.input.overtimeHours ? ` • ${fa(p.input.overtimeHours)} ساعت اضافه‌کاری` : ''}</span>
                <div class="employee-meta">
                  ${item.sent ? '<span class="chip ok">ارسال شد</span>' : ''}
                  ${warn ? `<span class="chip warn">${fa(warn)} هشدار</span>` : ''}
                  ${hasChat ? '' : '<span class="chip">بدون شناسه بله</span>'}
                </div>
              </div>
              <div class="employee-net">
                <b>${fa(fmt(p.net))}</b>
                <span>خالص (تومان)</span>
              </div>
            </button>`;
        })
        .join('')}`;
  }

  function heroBlock(totals, label) {
    return `
      <section class="hero">
        <p class="hero-label">جمع خالص پرداختی — ${esc(label)}</p>
        <p class="hero-value">${fa(fmt(totals.net))} <small>تومان</small></p>
        <div class="hero-grid">
          <div><span>جمع پرداختی</span><b>${fa(fmt(totals.gross))}</b></div>
          <div><span>کسورات</span><b>${fa(fmt(totals.deductions))}</b></div>
          <div><span>هزینه کارفرما</span><b>${fa(fmt(totals.employerCost))}</b></div>
        </div>
      </section>`;
  }

  /* ----------------------------- ویرایش فیش ------------------------------ */

  const EDIT_FIELDS = [
    { key: 'daysWorked', label: 'روز کارکرد', step: true, hint: 'حداکثر ۳۱' },
    { key: 'absenceDays', label: 'روز غیبت', step: true },
    { key: 'overtimeHours', label: 'اضافه‌کاری (ساعت)', step: true },
    { key: 'nightHours', label: 'شب‌کاری (ساعت)', step: true },
    { key: 'holidayHours', label: 'کار در تعطیل (ساعت)', step: true },
  ];

  const MONEY_FIELDS = [
    { key: 'baseSalary', label: 'حقوق پایه ماهانه', allowEmpty: false },
    { key: 'housingAllowance', label: 'حق مسکن', allowEmpty: true, hint: 'خالی = نرخ پیش‌فرض سازمان' },
    { key: 'foodAllowance', label: 'بن خواربار', allowEmpty: true, hint: 'خالی = نرخ پیش‌فرض سازمان' },
    { key: 'seniorityAllowance', label: 'پایه سنوات' },
    { key: 'positionAllowance', label: 'حق پست / مسئولیت' },
    { key: 'missionAllowance', label: 'فوق‌العاده مأموریت' },
    { key: 'otherAllowances', label: 'سایر مزایا' },
    { key: 'loanInstallment', label: 'قسط وام' },
    { key: 'otherDeductions', label: 'سایر کسورات' },
  ];

  function openEditor(employeeId) {
    const item = state.periodData.items.find((i) => i.employeeId === employeeId);
    if (!item) return;
    const employee = state.employees.find((e) => e.id === employeeId) || {};
    const p = item.payslip;
    const merged = { ...employee, ...item.inputs };
    const children = merged.children ?? employee.children ?? 0;

    sheet.dataset.employeeId = employeeId;
    openSheet(
      `
      <div class="payslip-head">
        <div>
          <h2>${esc(p.employee.fullName)}</h2>
          <span class="tiny muted">${esc(p.employee.position || '')} • کد ${esc(p.employee.personnelCode || '—')} • ${esc(state.periodData.label)}</span>
        </div>
        <button class="btn btn-icon btn-ghost" data-action="close-sheet" aria-label="بستن">✕</button>
      </div>

      <form id="editorForm" class="field-group">
        ${EDIT_FIELDS.map(
          (f) => `
          <label class="field">
            <span>${f.label}</span>
            <div style="display:flex;gap:6px">
              <input type="text" inputmode="numeric" data-num data-field="${f.key}" value="${fa(fmt(merged[f.key] || 0))}" />
              <button type="button" class="btn btn-sm" data-action="step" data-field="${f.key}" data-delta="-1">−</button>
              <button type="button" class="btn btn-sm" data-action="step" data-field="${f.key}" data-delta="1">+</button>
            </div>
          </label>`,
        ).join('')}
        <label class="field">
          <span>تعداد فرزند (حق اولاد)</span>
          <input type="text" inputmode="numeric" data-num data-field="children" value="${fa(fmt(children))}" />
        </label>
        <div class="field full" style="margin-bottom:4px"></div>
        ${MONEY_FIELDS.map(
          (f) => `
          <label class="field ${f.allowEmpty ? '' : 'full'}">
            <span>${f.label}</span>
            <div class="input-suffix">
              <input type="text" inputmode="numeric" data-num data-field="${f.key}"
                value="${merged[f.key] === null || merged[f.key] === undefined ? '' : fa(fmt(merged[f.key]))}"
                placeholder="${f.allowEmpty ? 'پیش‌فرض' : '۰'}" />
              <span class="suffix">تومان</span>
            </div>
            ${f.hint ? `<span class="hint">${f.hint}</span>` : ''}
          </label>`,
        ).join('')}
      </form>

      <div id="previewBox" class="payslip-block">${previewInner(p)}</div>

      <div class="sheet-actions">
        <button class="btn btn-ghost" data-action="close-sheet">انصراف</button>
        <button class="btn btn-primary" data-action="save-item" data-id="${employeeId}">💾 ذخیره</button>
      </div>
      <button class="btn btn-soft btn-block" style="margin-top:8px" data-action="send-one" data-id="${employeeId}">
        📤 ارسال فیش این نفر به بله
      </button>
      `,
    );
  }

  function readEditorInputs() {
    const inputs = {};
    $$('#editorForm [data-field]').forEach((input) => {
      const field = input.dataset.field;
      const raw = input.value.trim();
      if (!raw) {
        inputs[field] = null;
        return;
      }
      inputs[field] = parseNum(raw);
    });
    return inputs;
  }

  function previewInner(p) {
    const lines = (rows) =>
      rows
        .map((r) => `<div class="line-row"><span>${esc(r.label)}</span><b>${fa(fmt(r.amount))}</b></div>`)
        .join('');
    return `
      <h4>پیش‌نمایش فیش</h4>
      ${lines(p.earnings)}
      ${
        p.earnings.length
          ? `<div class="line-row total"><span>جمع پرداختی‌ها</span><b>${fa(fmt(p.gross))}</b></div>`
          : ''
      }
      ${p.deductions.length ? `<div style="margin-top:8px">${lines(p.deductions)}</div>` : ''}
      <div class="line-row total net"><span>خالص پرداختی</span><b>${fa(fmt(p.net))} تومان</b></div>
      <div class="mini-grid">
        <div class="mini"><span>بیمه سهم کارگر</span><b>${fa(fmt(p.deductions.find((d) => d.key === 'insurance')?.amount || 0))}</b></div>
        <div class="mini"><span>مالیات</span><b>${fa(fmt(p.deductions.find((d) => d.key === 'incomeTax')?.amount || 0))}</b></div>
        <div class="mini"><span>مأخذ مشمول بیمه</span><b>${fa(fmt(p.insuranceBase))}</b></div>
        <div class="mini"><span>هزینه کل کارفرما</span><b>${fa(fmt(p.employer.totalCost))}</b></div>
      </div>
      ${
        p.warnings.length
          ? `<div class="alert" style="margin-top:10px"><ul>${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
          : ''
      }`;
  }

  let previewTimer;
  function schedulePreview(employeeId) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      try {
        const res = await api.post('/api/preview', { employeeId, inputs: readEditorInputs() });
        const box = $('#previewBox');
        if (box) box.innerHTML = previewInner(res.payslip);
      } catch (err) {
        toast(err.message, 'error');
      }
    }, 260);
  }

  async function saveItem(employeeId) {
    try {
      setLoading(true);
      await api.put(`/api/period/${state.periodData.key}/input/${employeeId}`, readEditorInputs());
      await loadPeriod(state.periodData.key);
      closeSheet();
      render();
      toast('فیش ذخیره شد.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  /* -------------------------------- پرسنل --------------------------------- */

  function employeesView() {
    const list = state.employees;
    return `
      <div class="toolbar" style="justify-content:space-between;align-items:center">
        <div class="section-title" style="margin:0">پرسنل (${fa(list.length)})</div>
        <button class="btn btn-primary btn-sm" data-action="new-employee">＋ افزودن پرسنل</button>
      </div>
      ${
        list.length
          ? list
              .map(
                (e) => `
          <button class="employee-card" data-action="edit-employee" data-id="${e.id}">
            <div class="avatar">${esc(initials(e.fullName))}</div>
            <div class="employee-main">
              <strong>${esc(e.fullName || 'بدون نام')} ${e.active ? '' : '<span class="chip danger">غیرفعال</span>'}</strong>
              <span>${esc(e.position || '—')} ${e.department ? `• ${esc(e.department)}` : ''}</span>
              <div class="employee-meta">
                <span class="chip">کد ${esc(e.personnelCode || '—')}</span>
                ${e.baleChatId ? '<span class="chip ok">بله متصل</span>' : '<span class="chip warn">بله متصل نیست</span>'}
              </div>
            </div>
            <div class="employee-net">
              <b>${fa(fmt(e.baseSalary))}</b>
              <span>حقوق پایه</span>
            </div>
          </button>`,
              )
              .join('')
          : `<div class="empty">
               <div class="icon">🧑‍💼</div>
               <h3>فهرست خالی است</h3>
               <p>اولین کارمند را اضافه کنید تا فیش حقوقی ساخته شود.</p>
               <button class="btn btn-primary" data-action="new-employee">افزودن پرسنل</button>
             </div>`
      }`;
  }

  function openEmployeeForm(id) {
    const e = id ? state.employees.find((x) => x.id === id) : null;
    const v = (key) => (e && e[key] !== null && e[key] !== undefined ? e[key] : '');
    const amount = (key) => (v(key) === '' ? '' : fa(fmt(v(key))));

    openSheet(
      `
      <div class="payslip-head">
        <h2>${e ? 'ویرایش پرسنل' : 'افزودن پرسنل'}</h2>
        <button class="btn btn-icon btn-ghost" data-action="close-sheet" aria-label="بستن">✕</button>
      </div>
      <form id="employeeForm" class="field-group">
        <label class="field full"><span>نام و نام خانوادگی *</span>
          <input name="fullName" required value="${esc(v('fullName'))}" placeholder="مثلاً زهرا محمدی" /></label>
        <label class="field"><span>کد پرسنلی</span>
          <input name="personnelCode" value="${esc(v('personnelCode'))}" placeholder="۱۰۰۱" /></label>
        <label class="field"><span>کد ملی</span>
          <input name="nationalId" inputmode="numeric" value="${esc(v('nationalId'))}" placeholder="برای اتصال امن بله" /></label>
        <label class="field"><span>سِمَت</span>
          <input name="position" value="${esc(v('position'))}" placeholder="کارشناس حسابداری" /></label>
        <label class="field"><span>واحد / دپارتمان</span>
          <input name="department" value="${esc(v('department'))}" /></label>
        <label class="field"><span>تلفن</span>
          <input name="phone" inputmode="tel" value="${esc(v('phone'))}" /></label>
        <label class="field"><span>تاریخ استخدام</span>
          <input name="hireDate" value="${esc(v('hireDate'))}" placeholder="1403/05/12" /></label>
        <label class="field full"><span>شناسه چت بله (Chat ID)</span>
          <input name="baleChatId" inputmode="numeric" value="${esc(v('baleChatId'))}" placeholder="مثلاً 123456789" />
          <span class="hint">کارمند می‌تواند با ارسال /id به ربات، شناسه‌ی خود را ببیند. با /link هم می‌تواند خودش متصل شود.</span></label>

        <hr class="sep full" />
        <label class="field"><span>حقوق پایه ماهانه (تومان)</span>
          <input name="baseSalary" data-num value="${amount('baseSalary')}" placeholder="0" /></label>
        <label class="field"><span>تعداد فرزند</span>
          <input name="children" data-num value="${fa(fmt(v('children')))}" /></label>
        <label class="field"><span>حق مسکن (خالی = پیش‌فرض)</span>
          <input name="housingAllowance" data-num value="${amount('housingAllowance')}" placeholder="پیش‌فرض" /></label>
        <label class="field"><span>بن خواربار (خالی = پیش‌فرض)</span>
          <input name="foodAllowance" data-num value="${amount('foodAllowance')}" placeholder="پیش‌فرض" /></label>
        <label class="field"><span>پایه سنوات</span>
          <input name="seniorityAllowance" data-num value="${amount('seniorityAllowance')}" /></label>
        <label class="field"><span>حق پست</span>
          <input name="positionAllowance" data-num value="${amount('positionAllowance')}" /></label>
        <label class="field"><span>قسط وام ماهانه</span>
          <input name="loanInstallment" data-num value="${amount('loanInstallment')}" /></label>
        <label class="field"><span>کارکرد پیش‌فرض (روز)</span>
          <input name="daysWorked" data-num value="${fa(fmt(v('daysWorked') || 30))}" /></label>
        <label class="field"><span>وضعیت</span>
          <select name="active">
            <option value="1" ${!e || e.active ? 'selected' : ''}>فعال</option>
            <option value="0" ${e && !e.active ? 'selected' : ''}>غیرفعال</option>
          </select></label>
      </form>
      <div class="sheet-actions">
        ${e ? `<button class="btn btn-danger" data-action="delete-employee" data-id="${e.id}">حذف</button>` : ''}
        <button class="btn btn-ghost" data-action="close-sheet">انصراف</button>
        <button class="btn btn-primary" data-action="save-employee" data-id="${e ? e.id : ''}">💾 ذخیره</button>
      </div>`,
      () => {
        // فرمت مبالغ
        $$('#employeeForm [data-num]').forEach((input) => {
          input.addEventListener('input', () => {
            input.value = formatAmountInput(input.value);
          });
        });
      },
    );
  }

  async function saveEmployee(id) {
    const form = $('#employeeForm');
    if (!form) return;
    const body = {};
    new FormData(form).forEach((value, key) => {
      body[key] = value;
    });
    body.active = body.active === '1';
    if (!body.fullName.trim()) {
      toast('نام الزامی است.', 'error');
      return;
    }
    try {
      setLoading(true);
      if (id) await api.put(`/api/employees/${id}`, body);
      else await api.post('/api/employees', body);
      await Promise.all([loadEmployees(), loadPeriod(state.periodData.key)]);
      closeSheet();
      render();
      toast('پرسنل ذخیره شد.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function deleteEmployee(id) {
    if (!confirm('این پرسنل حذف شود؟ این کار قابل بازگشت نیست.')) return;
    try {
      setLoading(true);
      await api.del(`/api/employees/${id}`);
      await Promise.all([loadEmployees(), loadPeriod(state.periodData.key)]);
      closeSheet();
      render();
      toast('پرسنل حذف شد.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  /* ------------------------------ انتخاب دوره ------------------------------ */

  function openPeriodPicker() {
    const periods = state.meta.periods;
    openSheet(`
      <div class="payslip-head">
        <h2>انتخاب دوره</h2>
        <button class="btn btn-icon btn-ghost" data-action="close-sheet" aria-label="بستن">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${periods
          .map(
            (p) => `
          <button class="employee-card" data-action="choose-period" data-key="${p.key}" style="border-color:${p.key === state.periodData?.key ? 'var(--brand)' : 'var(--line)'}">
            <div class="avatar">📅</div>
            <div class="employee-main"><strong>${esc(p.label)}</strong><span>${esc(p.key)}</span></div>
            ${p.key === state.periodData?.key ? '<span class="chip brand">فعلی</span>' : ''}
          </button>`,
          )
          .join('')}
      </div>
      <div class="sheet-actions"><button class="btn btn-ghost btn-block" data-action="close-sheet">بستن</button></div>
    `);
  }

  async function choosePeriod(key) {
    try {
      closeSheet();
      setLoading(true);
      await loadPeriod(key);
      render();
      toast(`دوره: ${periodLabelOf(key)}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  /* -------------------------------- ارسال بله ------------------------------ */

  function sendView() {
    const s = state.meta.settings;
    const period = state.periodData;
    return `
      <div class="section-title"><span>اتصال به ربات بله</span></div>
      <section class="card">
        <div class="kv"><span>وضعیت توکن</span>${s.hasBaleToken ? '<span class="chip ok">ذخیره شده</span>' : '<span class="chip danger">تنظیم نشده</span>'}</div>
        <div class="kv"><span>شناسه چت مدیر</span><b>${s.baleChatId ? esc(s.baleChatId) : '—'}</b></div>
        <form id="baleForm">
          <label class="field" style="margin-top:10px"><span>توکن ربات بله</span>
            <input name="baleToken" class="ltr" placeholder="${s.hasBaleToken ? esc(s.baleToken) : '123456789:AA...'}" />
            <span class="hint">توکن را از @BotFather در بله بگیرید. برای امنیت، توکن ذخیره‌شده نمایش داده نمی‌شود.</span>
          </label>
          <label class="field"><span>شناسه چت مدیر (Chat ID)</span>
            <input name="baleChatId" class="ltr" inputmode="numeric" value="${esc(s.baleChatId)}" placeholder="مثلاً 123456789" />
            <span class="hint">در بله به ربات پیام دهید و /id را بفرستید تا شناسه‌ی خود را ببینید.</span>
          </label>
          <div class="toolbar">
            <button type="button" class="btn btn-primary btn-sm" data-action="save-bale">💾 ذخیره</button>
            <button type="button" class="btn btn-sm" data-action="test-bale">🔌 تست اتصال</button>
            <button type="button" class="btn btn-sm" data-action="test-message">✉️ پیام آزمایشی</button>
          </div>
        </form>
        <div id="baleStatus" style="margin-top:10px"></div>
      </section>

      <div class="section-title"><span>ارسال فیش‌ها</span><span class="tiny muted">${esc(period?.label || '')}</span></div>
      <section class="card">
        <div class="kv"><span>تعداد پرسنل دوره</span><b>${fa(period?.totals.headcount || 0)} نفر</b></div>
        <div class="kv"><span>دارای شناسه بله</span><b>${fa(period?.employees.filter((e) => e.baleChatId).length || 0)} نفر</b></div>
        <div class="kv"><span>جمع خالص دوره</span><b>${fa(fmt(period?.totals.net || 0))} تومان</b></div>
        <div class="switch-row">
          <div><div class="label">ارسال دوباره به همه</div><div class="desc">فیش کسانی که قبلاً دریافت کرده‌اند هم دوباره ارسال شود.</div></div>
          <label class="switch"><input type="checkbox" id="forceSend" /><span></span></label>
        </div>
        <div class="toolbar" style="margin-top:12px">
          <button class="btn btn-sm" data-action="preview-send">👁 پیش‌نمایش</button>
          <button class="btn btn-primary btn-sm" data-action="send-all">📤 ارسال به همه</button>
        </div>
        <div id="sendResults" style="margin-top:12px">${state.results ? sendResultsHtml(state.results) : ''}</div>
      </section>

      <div class="section-title"><span>گزارش ارسال‌ها</span></div>
      <section class="card" id="deliveryLog"><div class="muted small">در حال بارگذاری…</div></section>

      <div class="section-title"><span>دریافت پیام‌های ربات</span></div>
      <section class="card">
        <p class="small muted" style="margin-top:0">دو روش برای پاسخ‌دادن ربات به کارکنان وجود دارد:</p>
        <details style="margin-bottom:10px">
          <summary class="small" style="cursor:pointer;font-weight:600">روش ۱ — بدون دامنه (long polling)</summary>
          <p class="small muted">در سرور، دستور زیر را در ترمینال اجرا کنید و باز بگذارید:</p>
          <p><code>npm run bot</code></p>
          <p class="small muted">ربات با <code>/payslip</code> فیش را برای کارمند و با <code>/send</code> ارسال گروهی را برای مدیر انجام می‌دهد.</p>
        </details>
        <details>
          <summary class="small" style="cursor:pointer;font-weight:600">روش ۲ — وب‌هوک (نیازمند دامنه HTTPS)</summary>
          <form id="webhookForm" style="margin-top:8px">
            <label class="field"><span>آدرس عمومی سرور</span>
              <input name="url" class="ltr" placeholder="https://payroll.example.com" />
            </label>
            <div id="webhookUrl" class="small muted ltr" style="margin-bottom:8px"></div>
            <div class="toolbar">
              <button type="button" class="btn btn-sm btn-primary" data-action="set-webhook">ثبت وب‌هوک</button>
              <button type="button" class="btn btn-sm" data-action="delete-webhook">حذف وب‌هوک</button>
            </div>
          </form>
        </details>
      </section>`;
  }

  function mountSendView() {
    loadDeliveries();
    const form = $('#webhookForm');
    if (form) {
      form.addEventListener('input', () => {
        const url = form.url.value.trim().replace(/\/+$/, '');
        $('#webhookUrl').textContent = url ? `${url}/api/bale/hook/…` : '';
      });
    }
  }

  function sendResultsHtml(result) {
    const s = result.summary || {};
    const rows = (result.results || [])
      .map((r) => {
        const map = {
          sent: ['ok', 'ارسال شد'],
          'already-sent': ['', 'قبلاً ارسال شده'],
          skipped: ['warn', 'بدون شناسه چت'],
          failed: ['danger', 'ناموفق'],
          'dry-run': ['brand', 'پیش‌نمایش'],
        };
        const [cls, label] = map[r.status] || ['', r.status];
        return `<div class="line-row"><span>${esc(r.fullName || '—')} ${r.error ? `<em class="tiny">${esc(r.error)}</em>` : ''}</span><span class="chip ${cls}">${label}</span></div>`;
      })
      .join('');
    return `
      <div class="alert ${result.dryRun ? 'info' : 'ok'}" style="margin-bottom:8px">
        ${result.dryRun ? 'پیش‌نمایش (بدون ارسال واقعی)' : 'نتیجه‌ی ارسال'} —
        موفق: ${fa(s.sent || 0)} • ناموفق: ${fa(s.failed || 0)} • بدون شناسه: ${fa(s.skipped || 0)} • قبلاً ارسال‌شده: ${fa(s['already-sent'] || 0)}
      </div>
      ${rows}`;
  }

  async function saveBaleSettings() {
    const form = $('#baleForm');
    const body = {
      baleToken: form.baleToken.value.trim(),
      baleChatId: form.baleChatId.value.trim(),
    };
    try {
      setLoading(true);
      await api.put('/api/settings', body);
      await boot();
      toast('تنظیمات بله ذخیره شد.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function testBale() {
    const box = $('#baleStatus');
    box.innerHTML = '<div class="alert info">در حال بررسی…</div>';
    try {
      const res = await api.post('/api/bale/test', {});
      box.innerHTML = `<div class="alert ok">${esc(res.message)}</div>`;
    } catch (err) {
      box.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  }

  async function testMessage() {
    const box = $('#baleStatus');
    box.innerHTML = '<div class="alert info">در حال ارسال…</div>';
    try {
      await api.post('/api/bale/test-message', {});
      box.innerHTML = '<div class="alert ok">پیام آزمایشی به چت مدیر ارسال شد. بله را بررسی کنید.</div>';
    } catch (err) {
      box.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  }

  async function runSend(dryRun) {
    const force = $('#forceSend')?.checked || false;
    if (!dryRun && !confirm('فیش حقوقی برای پرسنل دوره به بله ارسال شود؟')) return;
    const box = $('#sendResults');
    box.innerHTML = '<div class="alert info">در حال ارسال… (بسته به تعداد نفرات کمی طول می‌کشد)</div>';
    try {
      const result = await api.post('/api/bale/send', {
        period: state.periodData.key,
        dryRun,
        force: dryRun ? true : force,
      });
      state.results = result;
      box.innerHTML = sendResultsHtml(result);
      await loadPeriod(state.periodData.key);
      loadDeliveries();
      render();
      toast(dryRun ? 'پیش‌نمایش آماده شد.' : 'ارسال انجام شد.', 'ok');
    } catch (err) {
      box.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  }

  async function loadDeliveries() {
    const box = $('#deliveryLog');
    if (!box) return;
    try {
      const { deliveries } = await api.get(`/api/bale/deliveries?period=${state.periodData.key}`);
      if (!deliveries.length) {
        box.innerHTML = '<div class="muted small">هنوز ارسالی در این دوره ثبت نشده است.</div>';
        return;
      }
      box.innerHTML = deliveries
        .slice(0, 25)
        .map(
          (d) => `
          <div class="line-row">
            <span>${esc(d.fullName || d.employeeId)} <em class="tiny muted">${esc(new Date(d.at).toLocaleString('fa-IR'))}</em></span>
            <span class="chip ${d.status === 'sent' ? 'ok' : 'danger'}">${d.status === 'sent' ? 'ارسال شد' : 'ناموفق'}</span>
          </div>`,
        )
        .join('');
    } catch (err) {
      box.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  }

  /* -------------------------------- تنظیمات -------------------------------- */

  function settingsView() {
    const r = state.meta.rules;
    const org = state.meta.organization;
    return `
      <div class="section-title"><span>نرخ‌ها و ضرایب (${fa(r.year)})</span></div>
      <section class="card">
        <div class="alert info small" style="margin-bottom:12px">
          نرخ‌های پیش‌فرض بر اساس مصوبات سال <b>${fa(r.year)}</b> است. با دکمه‌های زیر می‌توانید نرخ‌های سال دیگر را اعمال کنید و بعد مقادیر را دستی ویرایش کنید.
          <div class="toolbar" style="margin-top:8px">
            ${(state.meta.presetYears || []).map((y) => `<button class="btn btn-sm ${y === r.year ? 'btn-soft' : ''}" data-action="apply-preset" data-year="${y}">نرخ‌های ${fa(y)}</button>`).join('')}
          </div>
        </div>
        <form id="rulesForm" class="field-group">
          <label class="field full"><span>حداقل حقوق ماهانه (تومان)</span>
            <input name="minimumMonthlyWage" data-num value="${fa(fmt(r.minimumMonthlyWage))}" /></label>
          <label class="field"><span>حق مسکن</span><input name="housingAllowance" data-num value="${fa(fmt(r.housingAllowance))}" /></label>
          <label class="field"><span>بن خواربار</span><input name="foodAllowance" data-num value="${fa(fmt(r.foodAllowance))}" /></label>
          <label class="field"><span>ساعت کاری ماهانه</span><input name="monthlyHours" data-num value="${fa(fmt(r.monthlyHours))}" /></label>
          <label class="field"><span>روز کاری ماه</span><input name="standardMonthDays" data-num value="${fa(fmt(r.standardMonthDays))}" /></label>
          <label class="field"><span>ضریب اضافه‌کاری (٪)</span><input name="overtimeMultiplier" data-num value="${fa(fmt(r.overtimeMultiplier * 100))}" /></label>
          <label class="field"><span>فوق‌العاده شب‌کاری (٪)</span><input name="nightPremiumRate" data-num value="${fa(fmt(r.nightPremiumRate * 100))}" /></label>
          <label class="field"><span>بیمه سهم کارگر (٪)</span><input name="employeeInsuranceRate" data-num value="${fa(fmt(r.employeeInsuranceRate * 100))}" /></label>
          <label class="field"><span>بیمه سهم کارفرما (٪)</span><input name="employerInsuranceRate" data-num value="${fa(fmt(r.employerInsuranceRate * 100))}" /></label>
          <label class="field"><span>سقف بیمه (برابر حداقل حقوق)</span><input name="insuranceCeilingMultiplier" data-num value="${fa(fmt(r.insuranceCeilingMultiplier))}" /></label>
          <label class="field"><span>گرد کردن مبالغ به (تومان)</span><input name="roundTo" data-num value="${fa(fmt(r.roundTo))}" /></label>
          <label class="field"><span>سقف فرزند حق اولاد</span><input name="childrenCap" data-num value="${fa(fmt(r.childrenCap))}" /></label>
        </form>
        <div class="switch-row">
          <div><div class="label">حق اولاد خودکار</div><div class="desc">۳ برابر مزد روزانه‌ی حداقل به‌ازای هر فرزند</div></div>
          <label class="switch"><input type="checkbox" id="familyAuto" ${r.familyAllowanceAuto ? 'checked' : ''} /><span></span></label>
        </div>
        <div class="switch-row">
          <div><div class="label">کسر بیمه از درآمد مشمول مالیات</div><div class="desc">۷٪ بیمه‌ی کارگر معاف از مالیات است</div></div>
          <label class="switch"><input type="checkbox" id="insuranceOnTaxable" ${r.insuranceOnTaxable ? 'checked' : ''} /><span></span></label>
        </div>
        <div class="switch-row">
          <div><div class="label">تقلیل مزایای ثابت با کارکرد</div><div class="desc">حق مسکن و بن خواربار به نسبت روزهای کارکرد</div></div>
          <label class="switch"><input type="checkbox" id="prorateAllowances" ${r.prorateAllowances ? 'checked' : ''} /><span></span></label>
        </div>

        <hr class="sep" />
        <div class="section-title" style="margin:0 0 6px"><span>پله‌های مالیات بر درآمد (ماهانه)</span></div>
        <div id="bracketsBox">
          ${r.taxBrackets
            .map(
              (b, i) => `
            <div class="bracket-row">
              <input type="text" inputmode="numeric" data-bracket-upto="${i}" value="${b.upTo === null ? '' : fa(fmt(b.upTo))}" placeholder="بدون سقف" />
              <input type="text" inputmode="numeric" data-bracket-rate="${i}" value="${fa(fmt(b.rate * 100))}" placeholder="٪" />
              <button type="button" class="btn btn-sm btn-ghost" data-action="remove-bracket" data-index="${i}">✕</button>
            </div>`,
            )
            .join('')}
        </div>
        <button class="btn btn-sm btn-soft" data-action="add-bracket">＋ پله جدید</button>

        <button class="btn btn-primary btn-block" style="margin-top:14px" data-action="save-rules">💾 ذخیره نرخ‌ها</button>
      </section>

      <div class="section-title"><span>سازمان</span></div>
      <section class="card">
        <label class="field"><span>نام سازمان / شرکت</span>
          <input id="orgNameInput" value="${esc(org.name)}" /></label>
        <label class="field"><span>متن پانویس فیش</span>
          <textarea id="orgFooterInput">${esc(org.footer)}</textarea></label>
        <button class="btn btn-primary btn-sm" data-action="save-org">💾 ذخیره</button>
      </section>

      <div class="section-title"><span>امنیت</span></div>
      <section class="card">
        <label class="field"><span>رمز عبور پنل (خالی = بدون رمز)</span>
          <input type="password" id="panelPasswordInput" placeholder="••••••" autocomplete="new-password" />
          <span class="hint">اگر روی سرور عمومی اجرا می‌کنید، حتماً رمز بگذارید.</span>
        </label>
        <button class="btn btn-sm" data-action="save-password">ذخیره رمز</button>
      </section>

      <div class="section-title"><span>سرور</span></div>
      <section class="card">
        <label class="field"><span>آدرس سرور حقوق‌یار</span>
          <input id="apiBaseInput" class="ltr" placeholder="https://payroll.example.com" value="${esc(store.apiBase)}" />
          <span class="hint">برای نسخه‌ی اندروید (اپ) لازم است. در نسخه‌ی وب خالی بگذارید تا از همان دامنه استفاده شود. بعد از ذخیره، برنامه دوباره بارگذاری می‌شود.</span>
        </label>
        <button class="btn btn-sm" data-action="save-api-base">ذخیره و اتصال</button>
      </section>

      <div class="section-title"><span>خروجی و پشتیبان</span></div>
      <section class="card">
        <div class="toolbar">
          <button class="btn btn-sm" data-action="download" data-kind="csv">⬇️ خروجی Excel (CSV)</button>
          <button class="btn btn-sm" data-action="download" data-kind="txt">📄 متن فیش‌ها</button>
        </div>
        <p class="tiny muted" style="margin-bottom:0">فایل داده در مسیر <code>data/db.json</code> سرور ذخیره می‌شود؛ از همین فایل پشتیبان بگیرید.</p>
      </section>

      <div class="section-title"><span>درباره</span></div>
      <section class="card">
        <div class="kv"><span>نسخه</span><b>${esc(state.meta.appVersion)}</b></div>
        <div class="kv"><span>نسخه‌ی نرخ‌ها</span><b>${fa(state.meta.rules.year)}</b></div>
        <p class="tiny muted">حقوق‌یار — محاسبه‌ی حقوق و دستمزد و ارسال فیش به ربات بله. مبالغ پیش‌فرض نمونه‌اند و مسئولیت صحت محاسبات با کاربر است.</p>
      </section>`;
  }

  function mountSettingsView() {
    // فرمت‌دهی مبالغ به‌صورت سراسری (delegation) انجام می‌شود
  }

  async function saveRules() {
    const form = $('#rulesForm');
    const numField = (name) => parseNum(form[name]?.value);
    const brackets = [];
    $$('[data-bracket-upto]').forEach((input) => {
      const idx = input.dataset.bracketUpto;
      const upToRaw = input.value.trim();
      const rateInput = $(`[data-bracket-rate="${idx}"]`);
      brackets.push({
        upTo: upToRaw === '' ? null : parseNum(upToRaw),
        rate: parseNum(rateInput?.value) / 100,
      });
    });
    const body = {
      minimumMonthlyWage: numField('minimumMonthlyWage'),
      housingAllowance: numField('housingAllowance'),
      foodAllowance: numField('foodAllowance'),
      monthlyHours: numField('monthlyHours'),
      standardMonthDays: numField('standardMonthDays'),
      overtimeMultiplier: numField('overtimeMultiplier') / 100,
      nightPremiumRate: numField('nightPremiumRate') / 100,
      employeeInsuranceRate: numField('employeeInsuranceRate') / 100,
      employerInsuranceRate: numField('employerInsuranceRate') / 100,
      insuranceCeilingMultiplier: numField('insuranceCeilingMultiplier'),
      roundTo: numField('roundTo'),
      childrenCap: numField('childrenCap'),
      familyAllowanceAuto: $('#familyAuto').checked,
      insuranceOnTaxable: $('#insuranceOnTaxable').checked,
      prorateAllowances: $('#prorateAllowances').checked,
      taxBrackets: brackets,
    };
    try {
      setLoading(true);
      await api.put('/api/rules', body);
      await Promise.all([boot(), loadPeriod(state.periodData.key)]);
      render();
      toast('نرخ‌ها ذخیره شد.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function saveOrg() {
    try {
      setLoading(true);
      await api.put('/api/settings', {
        organization: { name: $('#orgNameInput').value, footer: $('#orgFooterInput').value },
      });
      await boot();
      render();
      toast('اطلاعات سازمان ذخیره شد.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function savePassword() {
    const pass = $('#panelPasswordInput').value;
    try {
      setLoading(true);
      await api.put('/api/settings', { panelPassword: pass });
      if (pass) localStorage.setItem('hy.password', pass);
      else localStorage.removeItem('hy.password');
      store.password = pass;
      toast(pass ? 'رمز پنل فعال شد.' : 'رمز پنل برداشته شد.', 'ok');
      await boot();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function download(kind) {
    try {
      const path = `/api/export/${state.periodData.key}.${kind}`;
      const headers = {};
      if (store.password) headers['x-panel-password'] = store.password;
      const res = await fetch(`${store.apiBase}${path}`, { headers });
      if (!res.ok) throw new Error('دانلود ناموفق بود');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll-${state.periodData.key}.${kind}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ------------------------------ رویدادها -------------------------------- */

  document.addEventListener('click', async (ev) => {
    const navBtn = ev.target.closest('.nav-btn');
    if (navBtn) {
      store.tab = navBtn.dataset.tab;
      localStorage.setItem('hy.tab', store.tab);
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const { action } = el.dataset;

    switch (action) {
      case 'close-sheet':
        closeSheet();
        break;
      case 'new-employee':
        openEmployeeForm(null);
        break;
      case 'edit-employee':
        openEmployeeForm(el.dataset.id);
        break;
      case 'save-employee':
        saveEmployee(el.dataset.id || null);
        break;
      case 'delete-employee':
        deleteEmployee(el.dataset.id);
        break;
      case 'edit-item':
        openEditor(el.dataset.id);
        break;
      case 'save-item':
        saveItem(el.dataset.id);
        break;
      case 'step': {
        const input = $(`#editorForm [data-field="${el.dataset.field}"]`);
        if (!input) break;
        const next = Math.max(0, parseNum(input.value) + Number(el.dataset.delta));
        input.value = fa(fmt(next));
        schedulePreview(el.dataset.id);
        break;
      }
      case 'choose-period':
        if (el.dataset.key) choosePeriod(el.dataset.key);
        else openPeriodPicker();
        break;
      case 'copy-previous': {
        const periods = state.meta.periods;
        const idx = periods.findIndex((p) => p.key === state.periodData.key);
        const prev = periods[idx + 1];
        if (!prev) return toast('دوره‌ی قبل پیدا نشد.', 'error');
        if (!confirm(`اقلام متغیر از ${prev.label} کپی شود؟`)) return;
        try {
          setLoading(true);
          await api.post(`/api/period/${state.periodData.key}/copy`, { from: prev.key });
          await loadPeriod(state.periodData.key);
          render();
          toast('کپی انجام شد.', 'ok');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          setLoading(false);
        }
        break;
      }
      case 'goto-send':
        store.tab = 'send';
        localStorage.setItem('hy.tab', 'send');
        render();
        break;
      case 'save-bale':
        saveBaleSettings();
        break;
      case 'test-bale':
        testBale();
        break;
      case 'test-message':
        testMessage();
        break;
      case 'preview-send':
        runSend(true);
        break;
      case 'send-all':
        runSend(false);
        break;
      case 'send-one': {
        if (!confirm('فیش این نفر به بله ارسال شود؟')) return;
        try {
          setLoading(true);
          const res = await api.post('/api/bale/send', {
            period: state.periodData.key,
            employeeIds: [el.dataset.id],
            force: true,
          });
          const r = res.results[0];
          toast(
            r.status === 'sent' ? 'فیش در بله ارسال شد.' : r.error || 'ارسال نشد.',
            r.status === 'sent' ? 'ok' : 'error',
          );
          await loadPeriod(state.periodData.key);
          render();
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          setLoading(false);
        }
        break;
      }
      case 'set-webhook': {
        const url = $('#webhookForm').url.value.trim().replace(/\/+$/, '');
        try {
          setLoading(true);
          const res = await api.post('/api/bale/webhook', { url });
          toast(res.message || 'وب‌هوک ثبت شد.', 'ok');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          setLoading(false);
        }
        break;
      }
      case 'delete-webhook':
        try {
          const res = await api.post('/api/bale/webhook', { delete: true });
          toast(res.message || 'وب‌هوک حذف شد.', 'ok');
        } catch (err) {
          toast(err.message, 'error');
        }
        break;
      case 'save-rules':
        saveRules();
        break;
      case 'apply-preset': {
        const year = el.dataset.year;
        if (!confirm(`نرخ‌های سال ${year} جایگزین مقادیر فعلی شود؟`)) break;
        try {
          setLoading(true);
          await api.post(`/api/rules/preset/${year}`, {});
          await boot();
          render();
          toast(`نرخ‌های ${year} اعمال شد.`, 'ok');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          setLoading(false);
        }
        break;
      }
      case 'save-org':
        saveOrg();
        break;
      case 'save-password':
        savePassword();
        break;
      case 'download':
        download(el.dataset.kind);
        break;
      case 'save-api-base': {
        const val = $('#apiBaseInput').value.trim().replace(/\/+$/, '');
        if (val && !/^https?:\/\//.test(val)) {
          toast('آدرس باید با http:// یا https:// شروع شود.', 'error');
          break;
        }
        localStorage.setItem('hy.apiBase', val);
        store.apiBase = val;
        toast('در حال اتصال…');
        setTimeout(() => location.reload(), 500);
        break;
      }
      case 'add-bracket':
        addBracketRow();
        break;
      case 'remove-bracket': {
        const idx = Number(el.dataset.index);
        const inputs = $$('[data-bracket-upto]');
        if (inputs.length <= 1) return;
        inputs[idx]?.parentElement?.remove();
        renumberBrackets();
        break;
      }
      default:
        break;
    }
  });

  function addBracketRow() {
    const box = $('#bracketsBox');
    const row = document.createElement('div');
    row.className = 'bracket-row';
    row.innerHTML = `
      <input type="text" inputmode="numeric" data-bracket-upto="" value="" placeholder="بدون سقف" />
      <input type="text" inputmode="numeric" data-bracket-rate="" value="" placeholder="٪" />
      <button type="button" class="btn btn-sm btn-ghost" data-action="remove-bracket">✕</button>`;
    const upTo = row.querySelector('[data-bracket-upto]');
    upTo.addEventListener('input', () => {
      upTo.value = formatAmountInput(upTo.value);
    });
    box.appendChild(row);
    renumberBrackets();
  }

  function renumberBrackets() {
    $$('[data-bracket-upto]').forEach((input, i) => {
      input.dataset.bracketUpto = String(i);
      const rate = input.parentElement.querySelector('[data-bracket-rate]');
      if (rate) rate.dataset.bracketRate = String(i);
      const btn = input.parentElement.querySelector('[data-action="remove-bracket"]');
      if (btn) btn.dataset.index = String(i);
    });
  }

  document.addEventListener('input', (e) => {
    const input = e.target;
    if (input.matches('#editorForm [data-field], #employeeForm [data-num], #rulesForm [data-num], [data-bracket-upto], [data-bracket-rate]')) {
      const caret = input.selectionStart;
      const formatted = formatAmountInput(input.value);
      if (formatted !== input.value) {
        input.value = formatted;
        try {
          input.setSelectionRange(Math.min(caret, formatted.length), Math.min(caret, formatted.length));
        } catch { /* ignore */ }
      }
      if (input.closest('#editorForm')) schedulePreview(sheet.dataset.employeeId);
      return;
    }
  });

  // Escape برای بستن شیت
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheetWrap.classList.contains('hidden')) closeSheet();
  });

  // ثبت Service Worker (PWA)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // شروع
  boot();
})();
