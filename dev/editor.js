(function () {
  const qs = new URLSearchParams(location.search);
  const KEY = '__edit_on';
  let on = sessionStorage.getItem(KEY) === '1';
  if (qs.get('edit') === '1') on = true;
  if (qs.get('edit') === '0') on = false;
  sessionStorage.setItem(KEY, on ? '1' : '0');
  const page = (function () { let p = decodeURIComponent(location.pathname); if (p.endsWith('/')) p += 'index.html'; return p.replace(/^\//, ''); })();

  const bar = document.createElement('div'); bar.id = '__editor';
  bar.innerHTML = '<button id="__toggle"></button>' +
    '<select id="__pages" title="Open a page"></select>' +
    '<button id="__changes">Changes</button>' +
    '<button id="__publish">Commit and push</button>' +
    '<span id="__msg"></span>' +
    '<button id="__close" title="Hide the editor (reload to bring it back)">×</button>';
  document.body.appendChild(bar);
  document.documentElement.classList.add('__editor-on');
  const panel = document.createElement('div'); panel.id = '__panel'; panel.hidden = true; document.body.appendChild(panel);
  const mini = document.createElement('div'); mini.id = '__mini'; mini.hidden = true;
  mini.innerHTML = '<button data-op="dup">duplicate</button><button data-op="del">delete</button>'; document.body.appendChild(mini);
  const msgEl = bar.querySelector('#__msg');
  const msg = (t, cls) => { msgEl.textContent = t; msgEl.className = cls || ''; };

  fetch('/__pages').then(r => r.json()).then(list => {
    const sel = bar.querySelector('#__pages');
    list.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; if (p === page) o.selected = true; sel.appendChild(o); });
    sel.onchange = () => location.href = '/' + sel.value + '?edit=' + (on ? '1' : '0');
  });

  const tg = bar.querySelector('#__toggle');
  function render() {
    tg.textContent = on ? 'Editing: on' : 'Editing: off';
    tg.className = on ? 'on' : '';
    document.documentElement.classList.toggle('__editing', on);
    document.querySelectorAll('[data-eid]').forEach(el => {
      if (on) { try { el.contentEditable = 'plaintext-only'; } catch (e) { el.contentEditable = 'true'; } }
      else { el.removeAttribute('contenteditable'); }
    });
    if (on) msg('Click any text to edit. Click away to save. Esc cancels. Alt-click a link to change its address.');
    else msg('Editing is off. Links work normally.');
  }
  tg.onclick = () => { on = !on; sessionStorage.setItem(KEY, on ? '1' : '0'); mini.hidden = true; render(); };
  render();

  let cur = null;
  document.addEventListener('focusin', e => {
    const el = e.target.closest && e.target.closest('[data-eid]'); if (!el || !on) return;
    cur = el; el.__orig = el.innerHTML; el.__n = el.querySelectorAll('*').length; showMini(el);
  });
  document.addEventListener('focusout', e => {
    const el = e.target.closest && e.target.closest('[data-eid]'); if (!el || !on) return;
    if (el.innerHTML !== el.__orig) save(el);
    setTimeout(() => { if (!mini.matches(':hover') && !(document.activeElement && document.activeElement.closest('[data-eid]'))) mini.hidden = true; }, 250);
  });
  document.addEventListener('keydown', e => {
    if (!on) return; const el = e.target.closest && e.target.closest('[data-eid]'); if (!el) return;
    if (e.key === 'Enter' && !e.shiftKey && /^(H\d|TD|TH|DT)$/.test(el.tagName)) { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.innerHTML = el.__orig; el.blur(); msg('Edit cancelled.'); }
  });
  document.addEventListener('click', e => {
    if (!on) return; const a = e.target.closest && e.target.closest('[data-eid] a'); if (!a) return;
    e.preventDefault();
    if (e.altKey) { const h = prompt('Link address', a.getAttribute('href') || ''); if (h !== null) { a.setAttribute('href', h); save(a.closest('[data-eid]')); } }
    else msg('Editing the link text. Alt-click to change its address. Turn editing off to follow it.');
  }, true);
  // paste as plain text when plaintext-only is unsupported
  document.addEventListener('paste', e => {
    if (!on) return; const el = e.target.closest && e.target.closest('[data-eid]'); if (!el || el.contentEditable === 'plaintext-only') return;
    e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text'));
  });

  async function save(el) {
    const eid = +el.getAttribute('data-eid'); const html = el.innerHTML; const fp = el.__orig;
    const structural = el.querySelectorAll('*').length !== el.__n;
    try {
      const r = await fetch('/__save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: page, eid, html, fp }) });
      const j = await r.json();
      if (!j.ok) { msg('Not saved: ' + j.error, 'err'); el.classList.add('__err'); return; }
      el.__orig = html; el.classList.remove('__err'); el.classList.add('__saved'); setTimeout(() => el.classList.remove('__saved'), 900);
      msg('Saved to ' + page, 'ok');
      if (structural) reloadKeep();
    } catch (err) { msg('Not saved: is dev/edit.py still running?', 'err'); }
  }
  function reloadKeep() { sessionStorage.setItem('__scroll', String(window.scrollY)); location.reload(); }
  window.addEventListener('load', () => { const s = sessionStorage.getItem('__scroll'); if (s) { window.scrollTo(0, +s); sessionStorage.removeItem('__scroll'); } });

  function showMini(el) {
    const s = el.closest('[data-sid]'); if (!s) { mini.hidden = true; return; }
    const tag = s.tagName.toLowerCase();
    mini.dataset.sid = s.getAttribute('data-sid'); mini.dataset.tag = tag;
    mini.querySelector('[data-op=dup]').textContent = 'duplicate ' + (tag === 'tr' ? 'row' : 'item');
    mini.querySelector('[data-op=del]').textContent = 'delete ' + (tag === 'tr' ? 'row' : 'item');
    mini.hidden = false;
    const r = s.getBoundingClientRect();
    mini.style.top = (window.scrollY + r.top - 26) + 'px';
    mini.style.left = Math.max(8, window.scrollX + r.right - mini.offsetWidth) + 'px';
  }
  mini.addEventListener('mousedown', e => e.preventDefault());
  mini.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const op = b.dataset.op; if (op === 'del' && !confirm('Delete this ' + (mini.dataset.tag === 'tr' ? 'row' : 'item') + '?')) return;
    if (cur && cur.innerHTML !== cur.__orig) await save(cur);
    const j = await (await fetch('/__op', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: page, sid: +mini.dataset.sid, op }) })).json();
    if (!j.ok) { msg('Failed: ' + j.error, 'err'); return; }
    reloadKeep();
  });

  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  bar.querySelector('#__changes').onclick = async () => {
    if (!panel.hidden) { panel.hidden = true; return; }
    const j = await (await fetch('/__status')).json();
    panel.innerHTML = '<div class="__ph"><b>Uncommitted changes</b><button id="__pclose">close</button></div>' +
      (j.files.length ? '<pre>' + esc(j.files.join('\n')) + '\n' + esc(j.stat) + '\n' + esc(j.diff) + '</pre>' : '<p>No changes. Everything is committed.</p>');
    panel.hidden = false; panel.querySelector('#__pclose').onclick = () => panel.hidden = true;
  };
  bar.querySelector('#__publish').onclick = async () => {
    const j0 = await (await fetch('/__status')).json();
    if (!j0.files.length) { msg('Nothing to commit.'); return; }
    const m = prompt('Commit message (' + j0.files.length + ' file' + (j0.files.length > 1 ? 's' : '') + ')', 'Edit site content');
    if (!m) return; msg('Committing and pushing…');
    const j = await (await fetch('/__publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: m }) })).json();
    msg(j.ok ? 'Pushed. Live in a minute or two.' : 'Failed: ' + (j.error || 'see terminal'), j.ok ? 'ok' : 'err');
    panel.hidden = true;
  };
  bar.querySelector('#__close').onclick = () => { on = false; sessionStorage.setItem(KEY, '0'); render(); bar.remove(); panel.remove(); mini.remove(); document.documentElement.classList.remove('__editor-on'); };
})();
