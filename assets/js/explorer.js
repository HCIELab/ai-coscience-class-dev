/* Related-work explorer. Plain JS plus d3 (force layout, zoom).
   All requests leave the browser directly: OpenAlex for resolution and links,
   MIT Parley (the student's own key) for the model's list. No server. */
(() => {
  if (typeof d3 === 'undefined') { const st = document.getElementById('status'); if (st) { st.textContent = 'The graph library (d3) did not load, so nothing will run. Reload the page; if it persists, check that assets/js/d3.v7.min.js is served.'; st.className = 'status err'; } return; }
  const OA = 'https://api.openalex.org';
  const PARLEY = 'https://parley.api.mit.edu/v1';
  const SELECT = 'id,display_name,publication_year,authorships,primary_location,doi,referenced_works,cited_by_count';
  const C = { seed: '#333333', bib: '#3a9d5d', model: '#3b7dd8', related: '#c4c4c4', missing: '#e74c3c', todo: '#ed8000', edge: '#d9d9d9' };
  const S = { nodes: new Map(), edges: [], clusters: [], seedId: null, log: [], cost: 0, mode: 'select', busy: false };
  const $ = s => document.querySelector(s);
  const wid = s => String(s || '').replace('https://openalex.org/', '');
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function sim(a, b) {
    const A = new Set(norm(a).split(' ').filter(w => w.length > 2)), B = new Set(norm(b).split(' ').filter(w => w.length > 2));
    if (!A.size || !B.size) return 0; let n = 0; A.forEach(w => { if (B.has(w)) n++; });
    const short = Math.min(A.size, B.size), long = Math.max(A.size, B.size);
    if (n < Math.min(2, short)) return 0;
    return 0.75 * (n / short) + 0.25 * (n / long);   // containment first, full overlap as tiebreak
  }
  function status(msg, cls) { const s = $('#status'); s.textContent = msg; s.className = 'status ' + (cls || ''); }
  function busy(on, msg) { S.busy = on; document.querySelectorAll('.panel button').forEach(b => b.disabled = on && !/mode-/.test(b.id)); if (msg) status(msg, on ? 'busy' : 'ok'); }

  // ---------- OpenAlex ----------
  async function oa(path, params = {}) {
    const u = new URL(OA + path); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await fetch(u); if (!r.ok) throw new Error('OpenAlex ' + r.status); return r.json();
  }
  function toNode(w, origin) {
    return { id: wid(w.id), title: w.display_name || '(untitled)', year: w.publication_year || null,
      authors: (w.authorships || []).map(a => a.author && a.author.display_name).filter(Boolean),
      venue: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '',
      doi: (w.doi || '').replace('https://doi.org/', ''), refs: (w.referenced_works || []).map(wid), citedBy: w.cited_by_count || 0,
      origin, status: 'related', read: false, todo: false, cluster: null, note: '' };
  }
  function extractDoi(q) { const m = String(q || '').match(/10\.\d{4,9}\/[^\s"'<>]+/); if (!m) return ''; return m[0].replace(/[.,;:)\]]+$/, ''); }
  function extractWid(q) { const m = String(q || '').match(/\b(W\d{6,})\b/); return m ? m[1] : ''; }
  async function resolveDoi(doi) { try { return await oa('/works/doi:' + encodeURIComponent(doi.trim())); } catch (e) { return null; } }
  async function resolveWid(id) { try { return await oa('/works/' + id); } catch (e) { return null; } }
  async function resolveTitle(title, year) {
    if (!title || norm(title).length < 3) return null;
    try {
      const j = await oa('/works', { search: title, 'per-page': 5, select: SELECT });
      let best = null, bs = 0;
      for (const w of j.results || []) { let s = sim(title, w.display_name); if (year && w.publication_year && Math.abs(w.publication_year - year) > 1) s -= 0.15; if (s > bs) { bs = s; best = w; } }
      return bs >= 0.6 ? { w: best, score: bs } : null;
    } catch (e) { return null; }
  }
  async function fetchByIds(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      try { const j = await oa('/works', { filter: 'openalex:' + chunk.join('|'), 'per-page': 50, select: SELECT }); out.push(...(j.results || [])); } catch (e) { }
      await sleep(120);
    }
    return out;
  }

  // ---------- graph model ----------
  const PR = { seed: 4, bib: 3, model: 2, related: 1, missing: 0 };
  function addNode(n) {
    const ex = S.nodes.get(n.id);
    if (ex) { if ((PR[n.status] || 0) > (PR[ex.status] || 0)) ex.status = n.status; if (n.read) ex.read = true; if (!ex.origin.includes(n.origin)) ex.origin += ' · ' + n.origin; if (n.note) ex.note = n.note; return ex; }
    S.nodes.set(n.id, n); return n;
  }
  function addMissing(label, origin, kind) {
    const id = 'missing:' + norm(label).slice(0, 60) + ':' + Math.random().toString(36).slice(2, 6);
    const n = { id, title: label, year: null, authors: [], venue: '', doi: '', refs: [], origin, status: 'missing', kind, read: false, todo: false, cluster: null, note: 'not found on OpenAlex' };
    S.nodes.set(id, n); return n;
  }
  function rebuildEdges() {
    S.edges = []; const deg = new Map();
    for (const n of S.nodes.values()) for (const r of n.refs) if (r !== n.id && S.nodes.has(r)) { S.edges.push({ source: n.id, target: r }); deg.set(n.id, (deg.get(n.id) || 0) + 1); deg.set(r, (deg.get(r) || 0) + 1); }
    for (const n of S.nodes.values()) n.deg = deg.get(n.id) || 0;
  }
  function afterChange(msg) { rebuildEdges(); layout(); renderClusters(); if (msg) status(msg, 'ok'); }

  // ---------- seed ----------
  async function loadSeed(q) {
    q = (q || '').trim(); if (!q) return;
    busy(true, 'Resolving seed…');
    try {
      const doi = extractDoi(q), widq = extractWid(q); const tried = []; let w = null;
      if (doi) { tried.push('DOI ' + doi); w = await resolveDoi(doi); }
      if (!w && widq) { tried.push('OpenAlex id ' + widq); w = await resolveWid(widq); }
      if (!w && !doi && !widq) { tried.push('title search "' + q + '"'); const r = await resolveTitle(q); w = r && r.w; }
      if (!w) { busy(false); status('Not found on OpenAlex. Tried: ' + tried.join('; ') + '. Check the DOI, or paste the exact title. You can look it up by hand at openalex.org.', 'err'); return; }
      const seed = toNode(w, 'seed'); seed.status = 'seed'; seed.read = true; addNode(seed); S.seedId = seed.id;
      if ($('#opt-refs').checked && seed.refs.length) { status(`Fetching ${seed.refs.length} references…`, 'busy'); (await fetchByIds(seed.refs)).forEach(x => addNode(toNode(x, 'cited by seed'))); }
      if ($('#opt-cites').checked) {
        const n = Math.max(0, Math.min(100, +$('#opt-ncites').value || 0));
        if (n) {
          status('Fetching works that cite the seed…', 'busy');
          try {
            const a = await oa('/works', { filter: 'cites:' + seed.id, 'per-page': Math.ceil(n / 2), sort: 'publication_date:desc', select: SELECT });
            const b = await oa('/works', { filter: 'cites:' + seed.id, 'per-page': Math.max(1, Math.floor(n / 2)), sort: 'cited_by_count:desc', select: SELECT });
            [...(a.results || []), ...(b.results || [])].forEach(x => addNode(toNode(x, 'cites seed')));
            $('#cites-count').textContent = a.meta ? `${a.meta.count} works cite the seed on OpenAlex; showing up to ${n} (newest and most linked).` : '';
          } catch (e) { }
        }
      }
      busy(false); starter.hidden = true; afterChange(`Seed loaded: ${seed.title} (${seed.year}). ${S.nodes.size} papers on the map.`);
    } catch (e) { busy(false); status('Could not load the seed: ' + e.message, 'err'); }
  }

  // ---------- bibliography ----------
  function parseBib(text) {
    const items = [];
    const entries = text.split(/@\w+\s*\{/).slice(1);
    if (entries.length) {
      for (const e of entries) {
        const f = k => { const m = e.match(new RegExp(k + '\\s*=\\s*[{"]([^}"]*(?:\\{[^}]*\\}[^}"]*)*)[}"]', 'i')); return m ? m[1].replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() : ''; };
        const t = f('title'), d = extractDoi(f('doi')) || f('doi'); if (t || d) items.push({ title: t, doi: d, year: +f('year') || null });
      }
      return items;
    }
    for (const raw of text.split(/\n+/)) {
      const line = raw.replace(/^\s*(?:[-*•]|\d+[.)\]])\s*/, '').trim(); if (!line) continue;
      const doi = extractDoi(line);
      const yr = (line.match(/\b(?:19|20)\d{2}\b/) || [])[0];
      let title = line.replace(/https?:\/\/\S+/g, '').replace(/\(?\b(?:19|20)\d{2}[a-z]?\b\)?/, '').trim();
      const q = line.match(/[“"]([^”"]{10,})[”"]/);
      if (q) title = q[1]; else { const parts = title.split(/\.\s+/).filter(p => p.length > 15); if (parts.length > 1) title = parts.reduce((a, b) => b.length > a.length ? b : a); }
      items.push({ title: title.replace(/[.,;:]+$/, '').trim(), doi, year: yr ? +yr : null });
    }
    return items;
  }
  async function resolveItems(items, origin, asModel) {
    let ok = 0, miss = 0, meta = 0; const rows = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i]; let w = null, score = 1;
      if (it.doi) w = await resolveDoi(it.doi);
      if (!w && it.title) { const r = await resolveTitle(it.title, it.year); if (r) { w = r.w; score = r.score; } }
      if (w) {
        const n = toNode(w, origin); n.status = asModel ? 'model' : 'bib'; n.read = !asModel;
        const yearOff = it.year && w.publication_year && Math.abs(w.publication_year - it.year) > 1;
        const parts = []; if (yearOff) parts.push(`year given ${it.year}, actual ${w.publication_year}`); if (score < 0.8) parts.push(`title match ${Math.round(score * 100)}%`);
        if (parts.length) meta++; n.note = parts.join('; '); addNode(n); ok++;
        rows.push({ claimed: it.title || it.doi, result: parts.length ? 'found, metadata differs: ' + parts.join('; ') : 'found', node: n.id });
      } else { addMissing(it.title || it.doi, origin, asModel ? 'model' : 'bib'); miss++; rows.push({ claimed: it.title || it.doi, result: 'NOT FOUND on OpenAlex' }); }
      status(`Resolving ${i + 1} of ${items.length}…`, 'busy'); await sleep(90);
    }
    return { ok, miss, meta, rows };
  }
  async function importBib() {
    const text = $('#bib').value; const items = parseBib(text); if (!items.length) { status('Nothing to add. Paste BibTeX or one paper per line.', 'err'); return; }
    busy(true, 'Resolving your bibliography…');
    const r = await resolveItems(items, 'your bibliography', false);
    busy(false); $('#bib-summary').textContent = `${r.ok} resolved · ${r.miss} not found · ${r.meta} metadata differs`;
    S.log.push({ asked: 'my bibliography (' + items.length + ' entries), resolved against OpenAlex', claimed: items.length + ' references', verified: 'OpenAlex lookup by DOI or title', result: `${r.ok} found, ${r.miss} not found, ${r.meta} metadata differs`, did: 'not-found entries stay red until I check them by hand', rows: r.rows });
    $('#bib').value = ''; starter.hidden = true; afterChange(`Bibliography added: ${r.ok} resolved, ${r.miss} not found.`);
  }

  // ---------- Parley ----------
  const keyBox = $('#key');
  try { keyBox.value = localStorage.getItem('parley_key') || ''; } catch (e) { }
  async function loadModels() {
    const key = keyBox.value.trim(); if (!key) return;
    try {
      const r = await fetch(PARLEY + '/models', { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok) { status('Parley rejected the key (' + r.status + ').', 'err'); return; }
      const ids = ((await r.json()).data || []).map(m => m.id).filter(id => !/embed|image|dall|whisper|tts/i.test(id)).sort();
      const sel = $('#model'); sel.innerHTML = ''; ids.forEach(id => sel.append(new Option(id, id)));
      const pref = ids.find(i => /haiku/.test(i)) || ids.find(i => /llama/.test(i)) || ids[0]; if (pref) sel.value = pref;
      status(`Key accepted. ${ids.length} models listed; ${pref} selected (cheap by default).`, 'ok');
    } catch (e) { status('Could not reach Parley: ' + e.message, 'err'); }
  }
  keyBox.addEventListener('change', () => { try { localStorage.setItem('parley_key', keyBox.value.trim()); } catch (e) { } loadModels(); });
  $('#btn-forget').onclick = () => { keyBox.value = ''; try { localStorage.removeItem('parley_key'); } catch (e) { } status('Key removed from this browser.', 'ok'); };
  if (keyBox.value) loadModels();

  function parseJsonList(text) {
    const t = text.replace(/```(?:json)?/gi, ''); const a = t.indexOf('['), b = t.lastIndexOf(']'); if (a < 0 || b <= a) return null;
    try { const arr = JSON.parse(t.slice(a, b + 1)); return Array.isArray(arr) ? arr : null; } catch (e) { return null; }
  }
  async function askModel() {
    const key = keyBox.value.trim(), model = $('#model').value, topic = $('#topic').value.trim(), n = Math.max(3, Math.min(25, +$('#nask').value || 10));
    if (!key) { status('Enter your Parley key first.', 'err'); return; } if (!topic) { status('Name the field or topic first.', 'err'); return; }
    const withMap = document.querySelector('input[name=mode]:checked').value === 'map';
    const mine = [...S.nodes.values()].filter(x => x.read && x.status !== 'missing').map(x => x.title).slice(0, 40);
    let prompt = `List the ${n} most important papers on "${topic}". Return a JSON array of objects with keys title, authors (string), year (number), venue, doi (string or null). Include only papers you are confident exist. No commentary.`;
    if (withMap && mine.length) prompt += `\n\nI already have these papers in my map; prefer papers that add to this set (different subcommunity, dissenting view, or more recent):\n- ` + mine.join('\n- ');
    busy(true, 'Asking ' + model + '…');
    try {
      const r = await fetch(PARLEY + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 1800, messages: [{ role: 'system', content: 'You are a careful research librarian. Answer with JSON only.' }, { role: 'user', content: prompt }] }) });
      const cost = parseFloat(r.headers.get('x-parley-v1-cost') || '0') || 0; const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || ('Parley ' + r.status));
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      $('#raw').textContent = text; S.cost += cost; $('#cost').textContent = '$' + S.cost.toFixed(4);
      const list = parseJsonList(text);
      if (!list) { busy(false); status('The model did not return parseable JSON. See the raw answer; ask again or lower the count.', 'err'); S.log.push({ asked: prompt, claimed: 'unparseable answer', verified: 'none', result: 'no JSON', did: 'nothing added' }); return; }
      const items = list.map(x => ({ title: String(x.title || ''), doi: x.doi ? String(x.doi).replace(/^https?:\/\/doi\.org\//, '') : '', year: +x.year || null, authors: x.authors, venue: x.venue }));
      const res = await resolveItems(items, `model: ${model}${withMap ? ' (given my map)' : ' (cold)'}`, true);
      busy(false);
      $('#ask-summary').textContent = `${res.ok} found · ${res.miss} not found · ${res.meta} metadata differs · $${cost.toFixed(4)}`;
      S.log.push({ asked: `${withMap ? 'given my map, ' : 'cold: '}the ${n} most important papers on "${topic}" (${model})`, claimed: `${items.length} papers`, verified: 'each resolved against OpenAlex by DOI or title', result: `${res.ok} exist, ${res.miss} not found, ${res.meta} with wrong year or title; cost $${cost.toFixed(4)}`, did: 'blue nodes added; not-found ones kept as red × for the log', rows: res.rows });
      afterChange(`Model answered: ${res.ok} real, ${res.miss} not found. Cost $${cost.toFixed(4)}.`);
    } catch (e) { busy(false); status('Model call failed: ' + e.message, 'err'); }
  }

  // ---------- drawing ----------
  const svg = d3.select('#graph'); const root = svg.append('g');
  const gClusters = root.append('g'), gEdges = root.append('g'), gNodes = root.append('g'), gLabels = root.append('g'), gAxis = root.append('g'), gDraw = root.append('g');
  const W = () => svg.node().clientWidth || 900, H = () => svg.node().clientHeight || 600;
  const zoom = d3.zoom().scaleExtent([0.2, 6]).on('zoom', e => root.attr('transform', e.transform)); svg.call(zoom);
  let simu = null, xYear = null, xMissing = 0;
  const radius = n => n.status === 'seed' ? 9 : Math.min(4.5 + (n.deg || 0) * 0.5, 10);
  const fill = n => n.status === 'missing' ? '#fff' : (n.status === 'related' && n.read ? C.bib : C[n.status] || C.related);
  const stroke = n => n.todo ? C.todo : n.status === 'missing' ? C.missing : n.status === 'seed' ? '#000' : '#fff';
  const strokeW = n => n.todo ? 2.5 : n.status === 'missing' ? 2 : 1;
  const label = n => { if (n.status === 'related' && !n.read) return ''; const a = (n.authors[0] || '').split(' ').pop() || (n.title || '').split(' ').slice(0, 2).join(' '); return a + (n.year ? ' ' + n.year : ''); };

  function layout() {
    const nodes = [...S.nodes.values()]; const years = nodes.map(n => n.year).filter(Boolean);
    const y0 = years.length ? Math.min(...years) : 2010, y1 = years.length ? Math.max(...years) : new Date().getFullYear();
    xYear = d3.scaleLinear().domain([y0 - 0.5, y1 + 0.5]).range([80, W() - 190]); xMissing = W() - 80;
    const xf = n => n.year ? xYear(n.year) : xMissing;
    nodes.forEach(n => { if (n.x == null) { n.x = xf(n) + (Math.random() - 0.5) * 30; n.y = H() / 2 + (Math.random() - 0.5) * H() * 0.6; } });
    const links = S.edges.map(e => ({ source: e.source, target: e.target }));
    if (simu) simu.stop();
    simu = d3.forceSimulation(nodes).force('x', d3.forceX(xf).strength(0.85)).force('y', d3.forceY(H() / 2 - 20).strength(0.05))
      .force('collide', d3.forceCollide(n => radius(n) + 6)).force('link', d3.forceLink(links).id(n => n.id).strength(0.02).distance(60)).alpha(0.9).on('tick', tick);
    drawAxis(y0, y1);
    gEdges.selectAll('line').data(links).join('line').attr('stroke', C.edge).attr('stroke-width', 1).attr('stroke-opacity', 0.9);
    const circ = gNodes.selectAll('circle').data(nodes, n => n.id).join('circle');
    circ.attr('r', radius).attr('fill', fill).attr('stroke', stroke).attr('stroke-width', strokeW).style('cursor', 'pointer')
      .on('mouseenter', (e, n) => tip(e, n)).on('mousemove', e => moveTip(e)).on('mouseleave', hideTip)
      .on('click', (e, n) => { if (S.mode === 'circle') return; e.stopPropagation(); if (e.shiftKey) { n.todo = !n.todo; restyle(); } else openDetails(n); });
    gLabels.selectAll('text').data(nodes, n => n.id).join('text').text(label).attr('font-family', 'Roboto Mono, Menlo, monospace').attr('font-size', 9).attr('fill', '#555').attr('pointer-events', 'none');
    gLabels.selectAll('text.x').remove();
    gNodes.selectAll('text.miss').data(nodes.filter(n => n.status === 'missing'), n => n.id).join('text').attr('class', 'miss').text('×').attr('text-anchor', 'middle').attr('dominant-baseline', 'central').attr('font-size', 11).attr('font-weight', 700).attr('fill', C.missing).attr('pointer-events', 'none');
  }
  function restyle() { gNodes.selectAll('circle').attr('fill', fill).attr('stroke', stroke).attr('stroke-width', strokeW); gLabels.selectAll('text').text(label); }
  function drawAxis(y0, y1) {
    gAxis.selectAll('*').remove(); const y = H() - 40;
    gAxis.append('line').attr('x1', xYear(y0 - 0.5)).attr('x2', xYear(y1 + 0.5)).attr('y1', y).attr('y2', y).attr('stroke', '#bbb');
    const step = (y1 - y0) > 24 ? 4 : (y1 - y0) > 12 ? 2 : 1;
    for (let yr = y0; yr <= y1; yr += step) { gAxis.append('line').attr('x1', xYear(yr)).attr('x2', xYear(yr)).attr('y1', y - 4).attr('y2', y + 4).attr('stroke', '#bbb'); gAxis.append('text').text(yr).attr('x', xYear(yr)).attr('y', y + 16).attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', '#888').attr('font-family', 'Roboto Mono, Menlo, monospace'); }
    gAxis.append('text').text('not found').attr('x', xMissing).attr('y', y + 16).attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', C.missing).attr('font-family', 'Roboto Mono, Menlo, monospace');
    gAxis.append('line').attr('x1', xMissing - 45).attr('x2', xMissing + 45).attr('y1', y).attr('y2', y).attr('stroke', C.missing).attr('stroke-dasharray', '3 3');
  }
  function tick() {
    gEdges.selectAll('line').attr('x1', l => l.source.x).attr('y1', l => l.source.y).attr('x2', l => l.target.x).attr('y2', l => l.target.y);
    gNodes.selectAll('circle').attr('cx', n => n.x).attr('cy', n => n.y);
    gNodes.selectAll('text.miss').attr('x', n => n.x).attr('y', n => n.y);
    gLabels.selectAll('text').attr('x', n => n.x + radius(n) + 3).attr('y', n => n.y + 3);
    renderClusterHulls();
  }

  // ---------- tooltip and details ----------
  const tipEl = $('#tooltip');
  function tip(e, n) { tipEl.innerHTML = `<div class="t">${esc(n.title)}</div><div class="m">${esc(n.authors.slice(0, 3).join(', '))}${n.authors.length > 3 ? ' et al.' : ''} · ${n.year || 'year unknown'} · ${esc(n.venue)}</div><div class="m">${esc(n.origin)}${n.note ? ' · ' + esc(n.note) : ''}</div>`; tipEl.hidden = false; moveTip(e); }
  function moveTip(e) { const r = $('.canvas').getBoundingClientRect(); tipEl.style.left = Math.min(e.clientX - r.left + 12, r.width - 330) + 'px'; tipEl.style.top = (e.clientY - r.top + 12) + 'px'; }
  function hideTip() { tipEl.hidden = true; }
  function openDetails(n) {
    const d = $('#details'); const doi = n.doi ? `<a href="https://doi.org/${esc(n.doi)}" target="_blank" rel="noopener">doi:${esc(n.doi)}</a>` : (n.id.startsWith('W') ? `<a href="https://openalex.org/${n.id}" target="_blank" rel="noopener">${n.id}</a>` : '');
    d.innerHTML = `<button class="x" title="close">×</button><h3>${esc(n.title)}</h3><div class="m">${esc(n.authors.join(', ')) || 'authors unknown'}</div><div class="m">${n.year || ''} ${esc(n.venue)}</div><div class="m">${doi}</div><div class="m">how it got here: ${esc(n.origin)}</div>${n.note ? `<div class="m" style="color:#e74c3c">${esc(n.note)}</div>` : ''}${n.status === 'missing' ? '<div class="m" style="color:#e74c3c">OpenAlex has no record of this as written. Search for it by hand before you trust or cite it.</div>' : ''}<div class="m">links within this map: ${n.deg || 0}</div>
      <div class="acts"><button data-a="read">${n.read ? 'Mark unread' : 'Mark read (adds to my map)'}</button><button data-a="todo">${n.todo ? 'Unflag' : 'Flag: gap to read'}</button><button data-a="remove">Remove from map</button></div>`;
    d.hidden = false; d.querySelector('.x').onclick = () => d.hidden = true;
    d.querySelectorAll('.acts button').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'read') { n.read = !n.read; if (n.status === 'related') n.status = n.read ? 'bib' : 'related'; if (!n.read && n.status === 'bib') n.status = 'related'; }
      if (a === 'todo') n.todo = !n.todo;
      if (a === 'remove') { S.nodes.delete(n.id); S.clusters.forEach(c => c.nodeIds = c.nodeIds.filter(i => i !== n.id)); d.hidden = true; afterChange('Removed.'); return; }
      restyle(); openDetails(n);
    });
  }
  svg.on('click', () => { $('#details').hidden = true; });

  // ---------- clusters (freehand loop) ----------
  let drawing = null;
  function setMode(m) { S.mode = m; $('#mode-select').classList.toggle('on', m === 'select'); $('#mode-circle').classList.toggle('on', m === 'circle'); $('.canvas').classList.toggle('circle', m === 'circle'); if (m === 'circle') svg.on('.zoom', null); else svg.call(zoom); }
  $('#mode-select').onclick = () => setMode('select'); $('#mode-circle').onclick = () => setMode('circle');
  svg.on('pointerdown', e => { if (S.mode !== 'circle') return; drawing = [d3.pointer(e, root.node())]; gDraw.selectAll('*').remove(); gDraw.append('path').attr('fill', 'rgba(231,76,60,.06)').attr('stroke', C.missing).attr('stroke-dasharray', '4 3').attr('stroke-width', 1.5); });
  svg.on('pointermove', e => { if (!drawing) return; drawing.push(d3.pointer(e, root.node())); gDraw.select('path').attr('d', 'M' + drawing.map(p => p.join(',')).join('L')); });
  svg.on('pointerup pointerleave', () => {
    if (!drawing) return; const pts = drawing; drawing = null; gDraw.selectAll('*').remove();
    if (pts.length < 8) return;
    const inside = [...S.nodes.values()].filter(n => pointIn(pts, n.x, n.y));
    if (!inside.length) { status('The loop contained no papers. Draw around a group.', 'err'); return; }
    const name = prompt(`Name this cluster (${inside.length} papers), three words or fewer:`, ''); if (name === null) return;
    const c = { id: 'c' + Date.now(), name: name.trim() || 'cluster ' + (S.clusters.length + 1), nodeIds: inside.map(n => n.id) };
    S.clusters.forEach(o => o.nodeIds = o.nodeIds.filter(i => !c.nodeIds.includes(i))); S.clusters.push(c); inside.forEach(n => n.cluster = c.id);
    renderClusters(); renderClusterHulls(); status(`Cluster "${c.name}" with ${inside.length} papers.`, 'ok'); setMode('select');
  });
  function pointIn(poly, x, y) { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) ins = !ins; } return ins; }
  function renderClusterHulls() {
    const data = S.clusters.map(c => { const pts = c.nodeIds.map(i => S.nodes.get(i)).filter(Boolean).map(n => [n.x, n.y]); return { c, pts }; }).filter(d => d.pts.length);
    const hull = d => { if (d.pts.length < 3) { const [x, y] = d.pts[0]; return `M${x - 20},${y} a20,20 0 1,0 40,0 a20,20 0 1,0 -40,0`; } const h = d3.polygonHull(d.pts); const cx = d3.mean(h, p => p[0]), cy = d3.mean(h, p => p[1]); return 'M' + h.map(([x, y]) => { const dx = x - cx, dy = y - cy, L = Math.hypot(dx, dy) || 1; return [x + dx / L * 22, y + dy / L * 22].join(','); }).join('L') + 'Z'; };
    gClusters.selectAll('path').data(data, d => d.c.id).join('path').attr('d', hull).attr('fill', 'rgba(231,76,60,.04)').attr('stroke', C.missing).attr('stroke-dasharray', '4 3').attr('stroke-width', 1.4);
    gClusters.selectAll('text').data(data, d => d.c.id).join('text').text(d => '“' + d.c.name + '”').attr('x', d => d3.mean(d.pts, p => p[0])).attr('y', d => d3.min(d.pts, p => p[1]) - 30).attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', C.missing).attr('font-family', 'Roboto Mono, Menlo, monospace');
  }
  function renderClusters() {
    const ul = $('#clusters'); ul.innerHTML = '';
    S.clusters.forEach(c => { const li = document.createElement('li'); li.innerHTML = `<b>${esc(c.name)}</b><span class="hint">${c.nodeIds.length}</span><button data-a="rename">rename</button><button data-a="del">delete</button>`; li.querySelector('[data-a=rename]').onclick = () => { const n = prompt('Cluster name', c.name); if (n) { c.name = n.trim(); renderClusters(); renderClusterHulls(); } }; li.querySelector('[data-a=del]').onclick = () => { S.clusters = S.clusters.filter(x => x !== c); c.nodeIds.forEach(i => { const n = S.nodes.get(i); if (n) n.cluster = null; }); renderClusters(); renderClusterHulls(); }; ul.append(li); });
  }

  // ---------- export ----------
  function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  $('#btn-json').onclick = () => {
    const nodes = [...S.nodes.values()].map(n => ({ id: n.id, title: n.title, authors: n.authors, year: n.year, venue: n.venue, doi: n.doi, status: n.status, read: n.read, todo: n.todo, cluster: n.cluster, origin: n.origin, note: n.note, links: n.deg || 0 }));
    const out = { tool: 'related-work-explorer', exported: new Date().toISOString(), seed: S.seedId, nodes, edges: S.edges, clusters: S.clusters, bullets: $('#bullets').value, ai_log: S.log, model_cost_usd: S.cost };
    download('related-work-map-' + stamp() + '.json', new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  };
  $('#btn-png').onclick = () => {
    const src = svg.node(); const w = W(), h = H(); const clone = src.cloneNode(true); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', w); clone.setAttribute('height', h);
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); bg.setAttribute('width', w); bg.setAttribute('height', h); bg.setAttribute('fill', '#fff'); clone.insertBefore(bg, clone.firstChild);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text'); t.textContent = 'Related-work map · ' + new Date().toLocaleDateString() + ' · green: in my map · blue: model · grey: unread · red ×: not found · orange ring: to read'; t.setAttribute('x', 12); t.setAttribute('y', 18); t.setAttribute('font-size', 11); t.setAttribute('fill', '#555'); t.setAttribute('font-family', 'Roboto Mono, Menlo, monospace'); clone.appendChild(t);
    const xml = new XMLSerializer().serializeToString(clone); const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const ctx = c.getContext('2d'); ctx.scale(2, 2); ctx.drawImage(img, 0, 0); c.toBlob(b => download('related-work-map-' + stamp() + '.png', b), 'image/png'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  };
  $('#btn-log').onclick = async () => {
    const rows = ['| # | What I asked | What it claimed | Verified? | Result | What I did with it |', '|---|---|---|---|---|---|'];
    S.log.forEach((l, i) => rows.push(`| ${i + 1} | ${l.asked.replace(/\|/g, '/').replace(/\n+/g, ' ').slice(0, 200)} | ${l.claimed} | ${l.verified} | ${l.result} | ${l.did} |`));
    const detail = S.log.flatMap(l => (l.rows || []).filter(r => /NOT FOUND|differs/.test(r.result)).map(r => `- ${r.claimed.replace(/\n+/g, ' ')} → ${r.result}`));
    const md = rows.join('\n') + (detail.length ? '\n\nEntries to check by hand:\n' + detail.join('\n') : '') + `\n\nSession model cost: $${S.cost.toFixed(4)}`;
    try { await navigator.clipboard.writeText(md); status('AI log copied as markdown (' + S.log.length + ' rows).', 'ok'); } catch (e) { download('ai-log-' + stamp() + '.md', new Blob([md], { type: 'text/markdown' })); }
  };
  $('#btn-clear').onclick = () => { if (!confirm('Clear the whole map? Export first if you want to keep it.')) return; S.nodes.clear(); S.edges = []; S.clusters = []; S.seedId = null; $('#details').hidden = true; afterChange('Map cleared. The AI log is kept until you reload.'); };

  // ---------- starter: the hook papers as sample seeds ----------
  const starter = $('#starter'), grid = $('#starter-grid');
  async function loadStarters() {
    try {
      const list = await (await fetch('../assets/data/hook-papers.json')).json();
      grid.innerHTML = '';
      list.forEach(p => {
        const b = document.createElement('button'); b.className = 'seedcard'; b.type = 'button'; b.title = 'Load as seed: ' + p.title;
        const pageMock = `<div class="sc-page"><div class="l t"></div><div class="l a"></div><div class="l"></div><div class="l" style="width:92%"></div><div class="col"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div></div>`;
        const thumb = p.thumb ? `<img src="../${esc(p.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : '';
        b.innerHTML = `<div class="sc-thumb">${pageMock}${thumb}</div><div class="sc-cap">${p.area ? `<div class="sc-area">${esc(p.area)}</div>` : ''}<div class="sc-title">${esc(p.title)}</div><div class="sc-meta">${esc((p.authors[0] || '').split(' ').pop())}${p.authors.length > 1 ? ' et al.' : ''} · ${p.year}${p.venue ? ' · ' + esc(p.venue) : ''}</div></div>`;
        b.onclick = () => { starter.hidden = true; $('#seed').value = p.doi || p.id; loadSeed(p.doi || p.id); };
        grid.append(b);
      });
    } catch (e) { grid.innerHTML = '<p class="hint">Could not load the hook paper list.</p>'; }
  }
  $('#starter-close').onclick = () => starter.hidden = true;
  $('#btn-starters').onclick = () => { starter.hidden = false; };
  loadStarters();

  // ---------- wiring ----------
  $('#btn-seed').onclick = () => loadSeed($('#seed').value); $('#seed').addEventListener('keydown', e => { if (e.key === 'Enter') loadSeed($('#seed').value); });
  $('#btn-bib').onclick = importBib; $('#btn-ask').onclick = askModel;
  window.addEventListener('resize', () => { if (S.nodes.size) layout(); });
  const qs = new URLSearchParams(location.search);
  if (qs.get('seed')) { starter.hidden = true; $('#seed').value = qs.get('seed'); loadSeed(qs.get('seed')); }
  if (qs.get('topic')) $('#topic').value = qs.get('topic');
})();
