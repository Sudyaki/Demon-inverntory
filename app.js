'use strict';
const CUR = '$'; // change for your currency
const $ = s => document.querySelector(s);
const cents = n => Math.round(Number(n) * 100);
const money = c => CUR + (c / 100).toFixed(2);
let me = null, products = [], cart = new Map(), timer;

/* ================= Local "backend" (browser localStorage) ================= */
const K = { u: 'ss_users', p: 'ss_products', s: 'ss_sales', me: 'ss_me' };
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { throw new Error('Browser storage is full. Use a smaller image or delete a product.'); } };
function hash(s) { // simple demo hash (not real security: this is a front-end only demo)
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
function seed() {
  write(K.u, [{ id: 1, username: 'admin', pw: hash('admin123'), role: 'admin' }, { id: 2, username: 'employee', pw: hash('employee123'), role: 'employee' }]);
  write(K.p, [
    { id: 1, brand: 'Nike', name: 'Air Jordan 1 All White', size: '9', price: 120.5, stock: 3, image: '' },
    { id: 2, brand: 'Nike', name: 'Dunk Low Panda', size: '10', price: 115, stock: 9, image: '' },
    { id: 3, brand: 'Nike', name: 'Air Force 1 All White', size: '8', price: 110, stock: 0, image: '' },
    { id: 4, brand: 'Jordan', name: 'Jordan 4 Retro Black Cat', size: '10.5', price: 210, stock: 2, image: '' },
    { id: 5, brand: 'Adidas', name: 'Samba OG White Green', size: '9', price: 100, stock: 6, image: '' }]);
  write(K.s, []);
}
if (!read(K.u, null) || !read(K.p, null)) seed();
const nextId = arr => arr.reduce((m, x) => Math.max(m, x.id), 0) + 1;
const publicUser = u => ({ id: u.id, username: u.username, role: u.role });
function need(role) {
  const u = JSON.parse(sessionStorage.getItem(K.me) || 'null');
  if (!u) { const e = new Error('Please log in'); e.code = 401; throw e; }
  if (role && u.role !== role) throw new Error('Admin only');
  return u;
}
function shrink(file) { // resize image so it fits in browser storage
  return new Promise((res, rej) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return rej(new Error('Image must be JPG, PNG, WEBP or GIF'));
    const r = new FileReader(); r.onerror = () => rej(new Error('Could not read image'));
    r.onload = () => {
      const i = new Image(); i.onerror = () => rej(new Error('Could not read image'));
      i.onload = () => {
        const s = Math.min(1, 480 / Math.max(i.width, i.height)), c = document.createElement('canvas');
        c.width = Math.round(i.width * s); c.height = Math.round(i.height * s);
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(i, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.8));
      };
      i.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
const handlers = {
  async login({ body }) {
    const u = read(K.u, []).find(x => x.username.toLowerCase() === String(body.username).trim().toLowerCase());
    if (!u || u.pw !== hash(String(body.password))) throw new Error('Wrong username or password');
    sessionStorage.setItem(K.me, JSON.stringify(publicUser(u))); return publicUser(u);
  },
  async logout() { sessionStorage.removeItem(K.me); return { ok: 1 }; },
  async me() { return { user: JSON.parse(sessionStorage.getItem(K.me) || 'null') }; },
  async list({ qs }) {
    need();
    const terms = (new URLSearchParams(qs).get('q') || '').toLowerCase().split(/\s+/).filter(Boolean);
    const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
    return read(K.p, []).filter(p => terms.every(t => `${p.brand} ${p.name} ${p.size}`.toLowerCase().includes(t)))
      .sort((a, b) => cmp(a.brand, b.brand) || cmp(a.name, b.name));
  },
  async save({ form }) {
    need('admin');
    const id = parseInt(form.get('id'), 10) || 0, brand = form.get('brand').trim(), name = form.get('name').trim(), size = form.get('size').trim();
    const price = Number(form.get('price')), stockRaw = String(form.get('stock')).trim(), file = form.get('image');
    if (!brand || !name) throw new Error('Brand and product name are required');
    if (form.get('price') === '' || !isFinite(price) || price < 0) throw new Error('Enter a valid price');
    if (!/^\d+$/.test(stockRaw)) throw new Error('Stock must be a whole number (0 or more)');
    const list = read(K.p, []); let p = id ? list.find(x => x.id === id) : null;
    if (id && !p) throw new Error('Product not found');
    const image = file && file.size ? await shrink(file) : (p ? p.image : '');
    const data = { brand, name, size, price: Math.round(price * 100) / 100, stock: parseInt(stockRaw, 10), image };
    if (p) Object.assign(p, data); else list.push({ id: nextId(list), ...data });
    write(K.p, list); return { ok: 1 };
  },
  async delete({ body }) { need('admin'); write(K.p, read(K.p, []).filter(p => p.id !== +body.id)); return { ok: 1 }; },
  async sell({ body }) {
    const user = need(), list = read(K.p, []), want = new Map();
    for (const i of body.items || []) { const q = parseInt(i.qty, 10); if (!(q >= 1)) throw new Error('Invalid item'); want.set(+i.id, (want.get(+i.id) || 0) + q); }
    if (!want.size) throw new Error('No items selected');
    let total = 0; const lines = [];
    for (const [id, q] of want) {
      const p = list.find(x => x.id === id); if (!p) throw new Error('A product was removed. Refresh and try again');
      const label = `${p.brand} ${p.name}${p.size ? ' (' + p.size + ')' : ''}`;
      if (p.stock < q) throw new Error(`Only ${p.stock} left of ${label}`);
      total += cents(p.price) * q; lines.push({ id, name: label, qty: q, price: p.price }); p.stock -= q;
    }
    const paid = cents(body.paid);
    if (!isFinite(paid) || paid < total) throw new Error('Payment is less than the total');
    const sales = read(K.s, []);
    sales.push({ id: nextId(sales), user: user.username, total: total / 100, paid: paid / 100, change: (paid - total) / 100, at: new Date().toLocaleString(), lines });
    write(K.p, list); write(K.s, sales);
    return { total: total / 100, paid: paid / 100, change: (paid - total) / 100 };
  },
  async sales() { need('admin'); return read(K.s, []).slice(-50).reverse().map(s => ({ ...s, created_at: s.at, items: s.lines.map(l => `${l.qty} x ${l.name}`).join(', ') })); },
  async users() { need('admin'); return read(K.u, []).map(publicUser); },
  async adduser({ body }) {
    need('admin'); const u = String(body.username || '').trim(), p = String(body.password || ''), list = read(K.u, []);
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(u)) throw new Error('Username: 3-30 letters, numbers, . _ -');
    if (p.length < 6) throw new Error('Password must be at least 6 characters');
    if (!['admin', 'employee'].includes(body.role)) throw new Error('Invalid role');
    if (list.some(x => x.username.toLowerCase() === u.toLowerCase())) throw new Error('Username already taken');
    list.push({ id: nextId(list), username: u, pw: hash(p), role: body.role }); write(K.u, list); return { ok: 1 };
  },
  async deluser({ body }) {
    const me = need('admin'); if (+body.id === me.id) throw new Error('You cannot delete your own account');
    write(K.u, read(K.u, []).filter(x => x.id !== +body.id)); return { ok: 1 };
  },
  async reset() { need('admin'); seed(); return { ok: 1 }; }
};
async function api(act, o = {}) {
  try { return await handlers[act](o); }
  catch (e) { if (e.code === 401 && act !== 'login' && act !== 'me') showLogin(); throw e; }
}

/* ================= UI ================= */
function h(tag, a = {}, ...kids) { // safe DOM builder (textContent, never innerHTML)
  const e = document.createElement(tag);
  for (const k in a) {
    if (k === 'class') e.className = a[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), a[k]);
    else if (k === 'checked' || k === 'disabled' || k === 'value') e[k] = a[k];
    else if (a[k] != null && a[k] !== false) e.setAttribute(k, a[k]);
  }
  for (const x of kids.flat()) if (x != null) e.append(x);
  return e;
}
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(t._t); t._t = setTimeout(() => t.className = '', 3500);
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

// ---------- auth ----------
function showLogin() { me = null; $('#app').hidden = true; $('#login').hidden = false; if ($('#dlg').open) $('#dlg').close(); }
function showApp() {
  $('#login').hidden = true; $('#app').hidden = false;
  $('#who').textContent = `${me.username} (${me.role})`;
  document.querySelectorAll('[data-admin]').forEach(e => e.hidden = me.role !== 'admin');
  cart.clear(); $('#paid').value = ''; $('#q').value = ''; renderCart(); load();
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#loginErr').textContent = '';
  const f = new FormData(e.target);
  try { me = await api('login', { body: { username: f.get('username'), password: f.get('password') } }); e.target.reset(); showApp(); }
  catch (er) { $('#loginErr').textContent = er.message; }
});
$('#btnLogout').onclick = guard(async () => { await api('logout'); showLogin(); });
$('#btnReset').onclick = guard(async () => {
  if (!confirm('Reset all products, sales and users back to the demo data?')) return;
  await api('reset'); await api('logout'); showLogin(); toast('Demo data restored. Log in again.');
});

// ---------- product list + search ----------
const load = guard(async () => {
  products = await api('list', { qs: 'q=' + encodeURIComponent($('#q').value) });
  for (const [id, c] of [...cart]) {
    const p = products.find(x => String(x.id) === id);
    if (p) { c.p = p; c.qty = Math.min(c.qty, p.stock); if (c.qty < 1) cart.delete(id); }
  }
  renderList(); renderCart();
});
$('#q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 200); });

function badge(s) { return h('span', { class: 'badge ' + (s === 0 ? 'zero' : s <= 3 ? 'low' : '') }, s === 0 ? 'Out of stock' : `${s} left`); }
function renderList() {
  const box = $('#list'); box.replaceChildren();
  $('#count').textContent = products.length ? `${products.length} product${products.length > 1 ? 's' : ''} · ${products.reduce((a, p) => a + p.stock, 0)} pairs in stock` : '';
  if (!products.length) box.append(h('p', { class: 'muted' }, $('#q').value ? 'No product found for that search.' : 'No products yet.'));
  for (const p of products) {
    const id = String(p.id);
    const cb = h('input', { type: 'checkbox', checked: cart.has(id), disabled: p.stock === 0, 'aria-label': 'Mark as sold',
      onchange: e => { e.target.checked ? cart.set(id, { p, qty: 1 }) : cart.delete(id); renderList(); renderCart(); } });
    const right = h('div', { class: 'right' }, h('div', { class: 'price' }, money(cents(p.price))), badge(p.stock));
    if (me.role === 'admin') right.append(h('div', { class: 'acts' },
      h('button', { class: 'btn sm', onclick: () => productForm(p) }, 'Edit'),
      h('button', { class: 'btn sm danger', onclick: guard(async () => { if (confirm(`Delete ${p.brand} ${p.name}?`)) { await api('delete', { body: { id: p.id } }); cart.delete(id); load(); } }) }, 'Delete')));
    box.append(h('div', { class: 'item' + (cart.has(id) ? ' sel' : '') + (p.stock === 0 ? ' out' : '') },
      cb,
      p.image ? h('img', { class: 'thumb', src: p.image, alt: '' }) : h('div', { class: 'thumb' }, '👟'),
      h('div', {}, h('b', {}, p.brand), p.name, p.size ? h('div', { class: 'muted' }, 'Size: ' + p.size) : null), right));
  }
}

// ---------- cart + calculator ----------
function totalC() { let t = 0; for (const { p, qty } of cart.values()) t += cents(p.price) * qty; return t; }
function renderCart() {
  const box = $('#cart'); box.replaceChildren();
  if (!cart.size) box.append(h('p', { class: 'muted' }, 'Tick the checkbox on a product to sell it.'));
  for (const [id, c] of cart) {
    box.append(h('div', { class: 'cline' },
      h('span', {}, `${c.p.brand} ${c.p.name}${c.p.size ? ' (' + c.p.size + ')' : ''}`),
      h('input', { type: 'number', min: 1, max: c.p.stock, value: c.qty, 'aria-label': 'Quantity', onchange: e => {
        let v = parseInt(e.target.value, 10); if (!(v >= 1)) v = 1; if (v > c.p.stock) { v = c.p.stock; toast(`Only ${c.p.stock} in stock`, true); }
        c.qty = v; renderCart(); } }),
      h('button', { class: 'btn sm', 'aria-label': 'Remove', onclick: () => { cart.delete(id); renderList(); renderCart(); } }, '✕')));
  }
  calc();
}
function calc() {
  const t = totalC(), raw = $('#paid').value, paid = raw === '' ? 0 : cents(raw), diff = paid - t, short = raw !== '' && diff < 0;
  $('#total').textContent = money(t);
  $('#change').textContent = money(Math.abs(diff));
  $('#chgLabel').textContent = short ? 'Still owed' : 'Change';
  $('#change').parentElement.classList.toggle('short', short);
  $('#btnSell').disabled = !cart.size || raw === '' || diff < 0 || isNaN(paid);
  const q = $('#quick'); q.replaceChildren(h('button', { class: 'btn sm', onclick: () => { $('#paid').value = (t / 100).toFixed(2); calc(); } }, 'Exact'));
  for (const v of [20, 50, 100, 500, 1000]) q.append(h('button', { class: 'btn sm', onclick: () => { $('#paid').value = v; calc(); } }, CUR + v));
}
$('#paid').addEventListener('input', calc);
$('#btnClear').onclick = () => { cart.clear(); $('#paid').value = ''; renderList(); renderCart(); };
$('#btnSell').onclick = guard(async () => {
  const r = await api('sell', { body: { items: [...cart].map(([id, c]) => ({ id: +id, qty: c.qty })), paid: $('#paid').value } });
  cart.clear(); $('#paid').value = ''; await load();
  toast(`Sale complete. Total ${money(cents(r.total))} · Change ${money(cents(r.change))}`);
});

// ---------- dialogs ----------
function openDlg(title, ...body) {
  const d = $('#dlg'); d.replaceChildren(h('div', { class: 'dh' }, h('h3', {}, title), h('button', { class: 'btn sm', onclick: () => d.close() }, '✕')), ...body);
  if (!d.open) d.showModal();
}
function productForm(p) {
  const v = k => p ? p[k] : '';
  const f = h('form', {},
    p ? h('input', { type: 'hidden', name: 'id', value: p.id }) : null,
    h('div', { class: 'g2' },
      h('label', {}, 'Brand', h('input', { name: 'brand', required: true, placeholder: 'Nike', value: v('brand'), list: 'brands' })),
      h('label', {}, 'Size', h('input', { name: 'size', placeholder: 'e.g. 9 / 42', value: v('size') }))),
    h('datalist', { id: 'brands' }, ['Nike', 'Jordan', 'Adidas', 'Puma', 'New Balance', 'Converse', 'Vans'].map(b => h('option', { value: b }))),
    h('label', {}, 'Product name / color', h('input', { name: 'name', required: true, placeholder: 'Air Jordan 1 All White', value: v('name') })),
    h('div', { class: 'g2' },
      h('label', {}, 'Price', h('input', { name: 'price', type: 'number', min: 0, step: '0.01', required: true, value: v('price') })),
      h('label', {}, 'Stock (pairs)', h('input', { name: 'stock', type: 'number', min: 0, step: 1, required: true, value: v('stock') }))),
    h('label', {}, 'Image', h('input', { name: 'image', type: 'file', accept: 'image/*' })),
    h('p', { class: 'err', id: 'pErr' }), h('button', { class: 'btn primary wide', type: 'submit' }, p ? 'Save changes' : 'Add product'));
  f.addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('save', { form: new FormData(f) }); $('#dlg').close(); load(); toast('Product saved'); }
    catch (er) { $('#pErr').textContent = er.message; }
  });
  openDlg(p ? 'Edit product' : 'Add product', f);
}
$('#btnAdd').onclick = () => productForm();
$('#btnSales').onclick = guard(async () => {
  const s = await api('sales');
  openDlg('Recent sales', s.length ? h('table', {}, h('tr', {}, ['Date', 'By', 'Items', 'Total'].map(x => h('th', {}, x))),
    s.map(r => h('tr', {}, h('td', {}, r.created_at), h('td', {}, r.user), h('td', {}, r.items || ''), h('td', {}, money(cents(r.total)))))) : h('p', { class: 'muted' }, 'No sales yet.'));
});
const usersDlg = guard(async () => {
  const list = await api('users');
  const f = h('form', {}, h('h4', {}, 'Add user'),
    h('label', {}, 'Username', h('input', { name: 'username', required: true })),
    h('label', {}, 'Password (min 6)', h('input', { name: 'password', type: 'password', required: true, minlength: 6 })),
    h('label', {}, 'Role', h('select', { name: 'role' }, h('option', { value: 'employee' }, 'Employee'), h('option', { value: 'admin' }, 'Admin'))),
    h('p', { class: 'err', id: 'uErr' }), h('button', { class: 'btn primary wide', type: 'submit' }, 'Add user'));
  f.addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('adduser', { body: Object.fromEntries(new FormData(f)) }); toast('User added'); usersDlg(); } catch (er) { $('#uErr').textContent = er.message; }
  });
  openDlg('Users', h('table', {}, list.map(u => h('tr', {}, h('td', {}, u.username), h('td', {}, u.role),
    h('td', {}, u.username === me.username ? '' : h('button', { class: 'btn sm danger', onclick: guard(async () => { if (confirm('Delete ' + u.username + '?')) { await api('deluser', { body: { id: u.id } }); usersDlg(); } }) }, 'Delete'))))), f);
});
$('#btnUsers').onclick = usersDlg;

// ---------- start ----------
api('me').then(r => { me = r.user; me ? showApp() : showLogin(); });
