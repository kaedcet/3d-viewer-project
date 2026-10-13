export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const formatBytes = b => (b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const formatDate = t => new Date(t).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

// ---------- API ----------
export async function api(url, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
    throw new Error('กรุณาเข้าสู่ระบบ');
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `เกิดข้อผิดพลาด (${res.status})`);
  return data;
}

// อัปโหลดไฟล์พร้อมแสดงความคืบหน้า
export function uploadFile(url, method, formData, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let d = {};
      try { d = JSON.parse(xhr.responseText); } catch {}
      xhr.status < 300 ? resolve(d) : reject(new Error(d.error || `อัปโหลดไม่สำเร็จ (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('การเชื่อมต่อขัดข้อง'));
    xhr.send(formData);
  });
}

// ---------- Toast ----------
export function toast(msg, type = 'success') {
  let box = document.getElementById('toasts');
  if (!box) { box = Object.assign(document.createElement('div'), { id: 'toasts' }); document.body.append(box); }
  const el = Object.assign(document.createElement('div'), { className: `toast ${type}`, textContent: msg });
  box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3200);
}

// ---------- Dialog ----------
function fieldHtml(f) {
  const hint = f.hint ? `<small class="muted">${esc(f.hint)}</small>` : '';
  const attrs = [
    f.required && 'required',
    f.minlength && `minlength="${f.minlength}"`,
    f.maxlength && `maxlength="${f.maxlength}"`,
    f.autocomplete && `autocomplete="${f.autocomplete}"`,
    f.placeholder && `placeholder="${esc(f.placeholder)}"`
  ].filter(Boolean).join(' ');
  if (f.type === 'textarea') {
    return `<label>${esc(f.label)}<textarea name="${f.name}" rows="${f.rows || 4}" ${attrs}>${esc(f.value)}</textarea>${hint}</label>`;
  }
  if (f.type === 'select') {
    const opts = f.options.map(o => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    return `<label>${esc(f.label)}<select name="${f.name}">${opts}</select>${hint}</label>`;
  }
  if (f.type === 'checkbox') {
    return `<label class="check"><input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
  }
  return `<label>${esc(f.label)}<input type="${f.type || 'text'}" name="${f.name}" value="${esc(f.value)}" ${attrs}>${hint}</label>`;
}

/** แสดงฟอร์มใน Dialog คืนค่า object ของค่าที่กรอก หรือ null ถ้ายกเลิก */
export function formDialog({ title, message = '', fields = [], submitText = 'บันทึก', danger = false, onSubmit }) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <form>
        <h2>${esc(title)}</h2>
        ${message ? `<p class="modal-msg">${esc(message)}</p>` : ''}
        ${fields.map(fieldHtml).join('')}
        <p class="form-error"></p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-cancel>ยกเลิก</button>
          <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submitText)}</button>
        </div>
      </form>`;
    document.body.append(dlg);

    const form = dlg.querySelector('form');
    const errEl = dlg.querySelector('.form-error');
    let result = null;

    dlg.querySelector('[data-cancel]').onclick = () => dlg.close();
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        values[f.name] = f.type === 'checkbox' ? el.checked : el.value;
      }
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      errEl.textContent = '';
      try {
        if (onSubmit) await onSubmit(values);
        result = values;
        dlg.close();
      } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false;
      }
    });

    dlg.showModal();
    form.querySelector('input, textarea, select')?.focus();
  });
}

export async function confirmDialog(message, { title = 'ยืนยันการทำรายการ', confirmText = 'ยืนยัน', danger = true } = {}) {
  return !!(await formDialog({ title, message, submitText: confirmText, danger }));
}

// ---------- Topbar ----------
export function setTitle(text) {
  const el = document.querySelector('.tb-title');
  if (el) el.textContent = text;
  document.title = text;
}

export async function initTopbar({ title = 'คลังโมเดล 3 มิติ', back = null } = {}) {
  const me = await api('/api/me');
  const { user } = me;
  const bar = document.getElementById('topbar');
  bar.innerHTML = `
    <div class="tb-left">
      ${back ? `<a class="btn ghost" href="${back}" title="ย้อนกลับ">←</a>` : '<a class="brand" href="/">◆</a>'}
      <h1 class="tb-title"></h1>
    </div>
    <div class="tb-right">
      <div id="topbar-actions"></div>
      ${user.role === 'admin' && location.pathname !== '/admin' ? '<a class="btn ghost" href="/admin">⚙ จัดการระบบ</a>' : ''}
      <div class="user-menu">
        <button class="btn ghost" id="user-btn">👤 ${esc(user.name || user.username)} ▾</button>
        <div class="dropdown hidden" id="user-dd">
          <div class="dd-head">@${esc(user.username)} · ${user.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ชม'}</div>
          <button id="pw-btn">🔑 เปลี่ยนรหัสผ่าน</button>
          <button id="logout-btn">🚪 ออกจากระบบ</button>
        </div>
      </div>
    </div>`;
  setTitle(title);

  const dd = document.getElementById('user-dd');
  document.getElementById('user-btn').onclick = e => { e.stopPropagation(); dd.classList.toggle('hidden'); };
  document.addEventListener('click', () => dd.classList.add('hidden'));

  document.getElementById('logout-btn').onclick = async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  };

  document.getElementById('pw-btn').onclick = async () => {
    const ok = await formDialog({
      title: 'เปลี่ยนรหัสผ่าน',
      fields: [
        { name: 'current', label: 'รหัสผ่านปัจจุบัน', type: 'password', required: true, autocomplete: 'current-password' },
        { name: 'next', label: 'รหัสผ่านใหม่', type: 'password', required: true, minlength: 8, autocomplete: 'new-password', hint: 'อย่างน้อย 8 ตัวอักษร' },
        { name: 'confirm', label: 'ยืนยันรหัสผ่านใหม่', type: 'password', required: true, autocomplete: 'new-password' }
      ],
      onSubmit: async v => {
        if (v.next !== v.confirm) throw new Error('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
        await api('/api/me/password', { method: 'POST', body: { current: v.current, next: v.next } });
      }
    });
    if (ok) toast('เปลี่ยนรหัสผ่านเรียบร้อย');
  };

  return me;
}