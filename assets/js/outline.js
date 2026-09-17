/* Paper outline: reverse outline + flow of an uploaded, pasted, or looked-up paper. Frontend only; Parley is the only backend. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const status = (m, c) => { const s = $('#status'); s.textContent = m; s.className = 'status ' + (c || ''); };
  const TAGS = { motivates: '#6b8fd6', narrows: '#4f7cd1', contributes: '#3a9d5d', positions: '#8e6bbf', describes: '#9a9a9a', evidences: '#2f8f6f', generalizes: '#d08a2e', limits: '#b07a3e', signposts: '#cfcfcf', other: '#bbbbbb' };
  const S = { paper: null, result: null, mine: {}, cost: 0, log: [], byHand: true };
  const MAXCHARS = 70000;

  // ---------- paper input ----------
  const drop = $('#drop'), file = $('#file');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadPdf(f); });
  file.addEventListener('change', () => { if (file.files[0]) loadPdf(file.files[0]); });
  async function loadPdf(f) {
    status('Extracting text from ' + f.name + '…', 'busy');
    try {
      const buf = await f.arrayBuffer(); const r = await PdfText.extract(buf, (p, n) => status(`Extracting page ${p} of ${n}…`, 'busy'));
      setPaper({ title: f.name.replace(/\.pdf$/i, ''), text: r.text, pages: r.pages, source: 'PDF upload' });
    } catch (e) { status('Could not read that PDF: ' + e.message, 'err'); }
  }
  $('#btn-paste').onclick = () => { const t = $('#paste').value.trim(); if (t.length < 200) { status('Paste at least a few paragraphs.', 'err'); return; } setPaper({ title: (t.split('\n')[0] || 'pasted text').slice(0, 90), text: t, pages: null, source: 'pasted text' }); };
  $('#btn-doi').onclick = lookup; $('#doi').addEventListener('keydown', e => { if (e.key === 'Enter') lookup(); });
  async function lookup() {
    const q = $('#doi').value.trim(); if (!q) return; status('Looking up on OpenAlex…', 'busy');
    try {
      const m = q.match(/10\.\d{4,9}\/[^\s"'<>]+/); let w = null;
      if (m) { const r = await fetch('https://api.openalex.org/works/doi:' + encodeURIComponent(m[0].replace(/[.,;:)\]]+$/, ''))); if (r.ok) w = await r.json(); }
      if (!w) { const r = await fetch('https://api.openalex.org/works?search=' + encodeURIComponent(q) + '&per-page=1'); const j = await r.json(); w = (j.results || [])[0]; }
      if (!w) { status('Not found on OpenAlex.', 'err'); return; }
      const inv = w.abstract_inverted_index || {}; const words = []; Object.entries(inv).forEach(([t, pos]) => pos.forEach(p => words[p] = t)); const abstract = words.join(' ');
      const meta = `${w.display_name}\n${(w.authorships || []).map(a => a.author && a.author.display_name).filter(Boolean).join(', ')}\n${w.publication_year || ''} · ${((w.primary_location || {}).source || {}).display_name || ''}\n\n`;
      let pdfText = null; const oa = (w.best_oa_location || {}).pdf_url;
      if (oa) { try { const r = await fetch(oa); if (r.ok) { const buf = await r.arrayBuffer(); const x = await PdfText.extract(buf); pdfText = x.text; } } catch (e) { /* CORS or blocked: fall through */ } }
      if (pdfText) setPaper({ title: w.display_name, text: pdfText, pages: null, source: 'open-access PDF via OpenAlex' });
      else { setPaper({ title: w.display_name, text: meta + (abstract || ''), pages: null, source: 'OpenAlex metadata and abstract only' }); status('Found it, but only the abstract is available this way. Upload the PDF for a real outline.', 'err'); }
    } catch (e) { status('Lookup failed: ' + e.message, 'err'); }
  }
  function setPaper(p) {
    S.paper = p; S.result = null; S.mine = {};
    const words = p.text.split(/\s+/).filter(Boolean).length;
    $('#paper-kv').innerHTML = `<b>${esc(p.title)}</b><br>${p.pages ? p.pages + ' pages · ' : ''}${words.toLocaleString()} words · source: ${esc(p.source)}`;
    $('#preview').textContent = p.text.slice(0, 3000) + (p.text.length > 3000 ? '\n…' : '');
    estimate(); if (!/abstract only|preloaded/.test(p.source)) status(`Loaded: ${p.title}. ${words.toLocaleString()} words.`, 'ok');
    $('#v-skeleton').innerHTML = '<p class="hint">Paper loaded. Choose a model and run the outline; the skeleton appears here with one line per paragraph and arrows for what depends on what.</p>'; $('#v-flow').innerHTML = ''; $('#v-checks').innerHTML = '';
  }
  function bodyText() { let t = S.paper.text; if ($('#opt-refs').checked) t = PdfText.body(t); if (t.length > MAXCHARS) { t = t.slice(0, MAXCHARS); } return t; }
  function estimate() { if (!S.paper) return; const full = document.querySelector('input[name=depth]:checked').value === 'full'; const est = Parley.estimate($('#model').value, bodyText() + PROMPT_FULL, full ? 7000 : 1800); $('#est').textContent = '$' + est.toFixed(4); }
  ['#model', '#opt-refs'].forEach(s => $(s).addEventListener('change', estimate)); document.querySelectorAll('input[name=depth]').forEach(r => r.addEventListener('change', estimate));

  // ---------- Parley ----------
  Parley.wire({ key: $('#key'), model: $('#model'), forget: $('#btn-forget'), status: (m, c) => { status(m, c); estimate(); }, prefer: /haiku/ });
  const PROMPT_FULL = `You are a meticulous reader doing a REVERSE OUTLINE of a research paper for a writing class. Return JSON only, no commentary.
Read the paper in order. Skip the reference list, acknowledgments, and figure captions. For every body paragraph write ONE sentence (at most 20 words) saying what the paragraph DOES for the paper's argument, never what it is about. Good: "Establishes that existing techniques cannot embed sensing in printed hinges." Bad: "Talks about related work."
Tag each paragraph with exactly one of: motivates (raises the problem), narrows (focuses to the gap), contributes (states what this paper delivers), positions (says what prior work cannot do), describes (explains the system, method, or procedure), evidences (presents results or measurements), generalizes (draws wider lessons), limits (states boundaries), signposts (transitions or roadmaps).
depends_on lists the ids of EARLIER paragraphs this one needs to make sense; leave empty if none. Flag "diary" when a paragraph narrates what the authors did in order ("we then built…") without establishing a claim. Flag "no_evidence" when it asserts a result without pointing to data, a figure, a table, or a procedure.
Return exactly this shape:
{"title":"...","genre":"system|study|theory|other","sections":[{"id":"s1","name":"Introduction","holds_up":"one sentence: which claim elsewhere in the paper this section exists to support","paragraphs":[{"id":"p1","anchor":"first 8 to 12 words of the paragraph, verbatim","does":"...","tag":"motivates","depends_on":[],"flags":[]}]}],"contribution":{"paragraph":"p6","sentence":"the contribution sentence, quoted verbatim"},"falsifier":{"stated":false,"text":"what result would have made the authors abandon the main claim; say if the paper never states one"},"notes":"one or two sentences a writing teacher would say about this skeleton"}`;
  const PROMPT_SECTIONS = PROMPT_FULL.replace('For every body paragraph write ONE sentence', 'Do NOT list paragraphs. For each section give an empty paragraphs array and put the work in holds_up. Also write ONE sentence per section in a field "does". If you were to list paragraphs, you would write ONE sentence');

  $('#btn-run').onclick = run;
  async function run() {
    if (!S.paper && S.sampleReady) { status('Loading the example paper…', 'busy'); await S.sampleReady; }
    if (!S.paper) { status('Load a paper first: drop a PDF, paste text, or click "Load the example paper".', 'err'); return; }
    const key = Parley.getKey(); if (!key) { status('Enter your Parley key.', 'err'); return; }
    const model = $('#model').value; const full = document.querySelector('input[name=depth]:checked').value === 'full';
    const text = bodyText(); const est = Parley.estimate(model, text + PROMPT_FULL, full ? 7000 : 1800);
    if (est > 0.25 && !confirm(`Estimated cost about $${est.toFixed(2)} on ${model}. Continue?`)) return;
    S.byHand = $('#opt-byhand').checked;
    status(`Asking ${model}… (${Parley.tokens(text).toLocaleString()} tokens in)`, 'busy'); $('#btn-run').disabled = true;
    try {
      const r = await Parley.chat({ key, model, system: full ? PROMPT_FULL : PROMPT_SECTIONS, user: 'PAPER TEXT:\n\n' + text, maxTokens: full ? 8000 : 2500 });
      S.cost += r.cost; $('#cost').textContent = '$' + S.cost.toFixed(4);
      const j = Parley.parseJson(r.text);
      if (!j || !j.sections) { status('The model did not return a parseable outline' + (r.finish === 'length' ? ' (answer was cut off; try sections-only or a smaller paper)' : '') + '.', 'err'); $('#v-checks').innerHTML = '<pre>' + esc(r.text) + '</pre>'; showView('checks'); return; }
      S.result = j; S.result._truncated = r.finish === 'length';
      S.log.push({ asked: `reverse outline of "${S.paper.title}" (${model}, ${full ? 'every paragraph' : 'sections only'})`, claimed: `${j.sections.length} sections, ${j.sections.reduce((a, s) => a + (s.paragraphs || []).length, 0)} paragraph lines, contribution in ${j.contribution && j.contribution.paragraph}`, verified: S.byHand ? 'compared against my own lines' : 'not yet compared', result: `cost $${r.cost.toFixed(4)}${S.result._truncated ? '; answer truncated' : ''}`, did: 'kept as the model column; my column is mine' });
      renderAll(); status(`Outline ready. ${S.byHand ? 'Write your sentence for each paragraph, then reveal the model\'s.' : ''} Cost $${r.cost.toFixed(4)}.`, 'ok');
      $('#btn-reveal').hidden = !S.byHand;
    } catch (e) { status('Model call failed: ' + e.message, 'err'); }
    finally { $('#btn-run').disabled = false; }
  }
  $('#btn-reveal').onclick = () => { S.byHand = false; document.querySelectorAll('.model.hiddenline').forEach(el => el.classList.remove('hiddenline')); $('#btn-reveal').hidden = true; status('Model lines revealed. Where you disagree about what a paragraph does, one of you is right; find out which.', 'ok'); };

  // ---------- views ----------
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showView(b.dataset.v));
  function showView(v) { document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); ['skeleton', 'flow', 'checks'].forEach(x => $('#v-' + x).hidden = x !== v); if (v === 'skeleton') requestAnimationFrame(drawArrows); }
  function renderAll() { renderSkeleton(); renderFlow(); renderChecks(); showView('skeleton'); }
  const allParas = () => S.result.sections.flatMap(s => (s.paragraphs || []).map(p => Object.assign({ section: s.id }, p)));

  function renderSkeleton() {
    const R = S.result, contribId = R.contribution && R.contribution.paragraph; const wrap = $('#v-skeleton');
    const counts = {}; allParas().forEach(p => counts[p.tag] = (counts[p.tag] || 0) + 1); const total = Math.max(1, allParas().length);
    let html = `<div class="ratio">${Object.entries(counts).map(([t, n]) => `<span style="width:${n / total * 100}%;background:${TAGS[t] || TAGS.other}" title="${t}: ${n}"></span>`).join('')}</div><div class="ratiokey">${Object.entries(counts).map(([t, n]) => `<span><i style="background:${TAGS[t] || TAGS.other}"></i>${t} ${n}</span>`).join('')}</div>`;
    if (R._truncated) html += '<p class="hint" style="color:#e74c3c">The model\'s answer was cut off; the last sections may be missing.</p>';
    html += '<div class="skel"><svg class="arrows"></svg>';
    for (const s of R.sections) {
      html += `<div class="sec"><h3>${esc(s.name)} <small>${(s.paragraphs || []).length ? (s.paragraphs.length + ' ¶') : ''}</small></h3><p class="holds"><b>holds up:</b> ${esc(s.holds_up || s.does || '')}</p>`;
      for (const p of (s.paragraphs || [])) {
        const flags = (p.flags || []).map(f => `<span>${esc(f.replace('_', ' '))}</span>`).join('');
        html += `<div class="para${p.id === contribId ? ' contrib' : ''}" data-pid="${esc(p.id)}" data-deps="${esc((p.depends_on || []).join(','))}">
          <div class="n">${esc(p.id.replace(/^p/, '¶'))}</div><div class="chip" style="background:${TAGS[p.tag] || TAGS.other}">${esc(p.tag || '')}</div>
          <div class="does"><span class="anchor">${esc(p.anchor || '')}…</span>${S.byHand ? `<span class="mine" contenteditable="plaintext-only" data-pid="${esc(p.id)}">${esc(S.mine[p.id] || '')}</span>` : ''}<span class="model${S.byHand ? ' hiddenline' : ''}">${esc(p.does || '')}</span></div>
          <div class="flags">${flags}${p.id === contribId ? '<span style="border-color:#3a9d5d;color:#3a9d5d">contribution</span>' : ''}</div></div>`;
      }
      html += '</div>';
    }
    html += '</div>'; wrap.innerHTML = html;
    wrap.querYou = null;
    wrap.querySelectorAll('.mine').forEach(el => { el.addEventListener('input', () => S.mine[el.dataset.pid] = el.textContent); try { el.contentEditable = 'plaintext-only'; } catch (e) { el.contentEditable = 'true'; } });
    requestAnimationFrame(drawArrows);
  }
  function drawArrows() {
    const skel = document.querySelector('#v-skeleton .skel'); if (!skel) return; const svg = skel.querySelector('svg.arrows'); const base = skel.getBoundingClientRect();
    svg.setAttribute('height', skel.scrollHeight); svg.setAttribute('width', 70); svg.innerHTML = '<defs><marker id="oa" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#e74c3c"/></marker></defs>';
    const rows = {}; skel.querySelectorAll('.para').forEach(r => { const b = r.getBoundingClientRect(); rows[r.dataset.pid] = b.top - base.top + b.height / 2; });
    let paths = '', orphans = 0; const referenced = new Set();
    skel.querySelectorAll('.para').forEach(r => (r.dataset.deps || '').split(',').filter(Boolean).forEach(d => { referenced.add(d); if (rows[d] == null || rows[r.dataset.pid] == null) return; const y1 = rows[d], y2 = rows[r.dataset.pid]; const dx = Math.min(60, 14 + Math.abs(y2 - y1) / 40); paths += `<path d="M66,${y1} C${66 - dx},${y1} ${66 - dx},${y2} 64,${y2}" fill="none" stroke="#e74c3c" stroke-width="1.2" opacity=".75" marker-end="url(#oa)"/>`; }));
    svg.innerHTML += paths;
    skel.querySelectorAll('.para').forEach(r => { const deps = (r.dataset.deps || '').split(',').filter(Boolean); const isTarget = referenced.has(r.dataset.pid); const p = allParas().find(x => x.id === r.dataset.pid); if (!isTarget && p && !['contributes', 'evidences', 'generalizes', 'limits'].includes(p.tag) && !deps.length && !r.querySelector('.flags .orphan')) { const f = document.createElement('span'); f.className = 'orphan'; f.textContent = 'nothing depends on this'; f.style.borderColor = '#d08a2e'; f.style.color = '#d08a2e'; r.querySelector('.flags').prepend(f); orphans++; } });
  }
  window.addEventListener('resize', () => requestAnimationFrame(drawArrows));

  function renderFlow() {
    const R = S.result, secs = R.sections; const paras = allParas(); const byId = {}; paras.forEach(p => byId[p.id] = p);
    const agg = {}; paras.forEach(p => (p.depends_on || []).forEach(d => { const from = byId[d] && byId[d].section; if (from && from !== p.section) { const k = from + '>' + p.section; agg[k] = (agg[k] || 0) + 1; } }));
    const W = 760, x0 = 40, boxW = 300, gap = 14; let y = 30; const pos = {};
    let svg = `<svg viewBox="0 0 ${W} ${secs.reduce((a, s) => a + Math.max(34, 12 + (s.paragraphs || []).length * 12) + gap, 60)}" role="img" aria-label="Section flow">`;
    svg += `<text x="${x0}" y="16" font-size="11" fill="#888" font-family="Roboto Mono, Menlo, monospace">box height = paragraphs · arrows = dependencies between sections (width = count)</text>`;
    for (const s of secs) { const h = Math.max(34, 12 + (s.paragraphs || []).length * 12); pos[s.id] = { y, h }; svg += `<rect x="${x0}" y="${y}" width="${boxW}" height="${h}" fill="#fff" stroke="#333" stroke-width="1.2"/><text x="${x0 + 10}" y="${y + 17}" font-size="12" font-weight="500" fill="#333" font-family="Lato, Roboto, sans-serif">${esc(s.name)}</text><text x="${x0 + 10}" y="${y + 31}" font-size="10" fill="#888" font-family="Roboto, sans-serif">${(s.paragraphs || []).length ? s.paragraphs.length + ' ¶ · ' : ''}${esc((s.holds_up || '').slice(0, 44))}${(s.holds_up || '').length > 44 ? '…' : ''}</text>`; svg += `<foreignObject x="${x0 + boxW + 24}" y="${y}" width="${W - x0 - boxW - 40}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="font:11px/1.35 Roboto, sans-serif;color:#555">${esc(s.holds_up || '')}</div></foreignObject>`; y += h + gap; }
    Object.entries(agg).forEach(([k, n]) => { const [a, b] = k.split('>'); if (!pos[a] || !pos[b]) return; const y1 = pos[a].y + pos[a].h / 2, y2 = pos[b].y + pos[b].h / 2; const bend = 14 + Math.min(60, Math.abs(y2 - y1) / 6); svg += `<path d="M${x0},${y1} C${x0 - bend},${y1} ${x0 - bend},${y2} ${x0},${y2}" fill="none" stroke="#e74c3c" stroke-width="${Math.min(6, 1 + n * 0.8)}" opacity=".7"/>`; });
    svg += '</svg>'; $('#v-flow').innerHTML = svg;
  }
  function renderChecks() {
    const R = S.result, paras = allParas(); const diary = paras.filter(p => (p.flags || []).includes('diary')), noev = paras.filter(p => (p.flags || []).includes('no_evidence'));
    const empty = R.sections.filter(s => !(s.holds_up || '').trim() || /nothing|none|unclear/i.test(s.holds_up || ''));
    $('#v-checks').innerHTML = `<ul class="checks">
      <li><b>Genre:</b> ${esc(R.genre || '?')}. ${esc(R.notes || '')}</li>
      <li><b>Contribution sentence</b> (${esc((R.contribution || {}).paragraph || '?')}): <blockquote>${esc((R.contribution || {}).sentence || 'not found')}</blockquote></li>
      <li><b>Could the evaluation fail?</b> ${R.falsifier && R.falsifier.stated ? 'The paper states a falsifier.' : 'The paper does not state what result would have killed the claim.'} ${esc((R.falsifier || {}).text || '')}</li>
      <li><b>Diary paragraphs</b> (narrate process, establish nothing): ${diary.length}${diary.length ? ': ' + diary.map(p => p.id.replace(/^p/, '¶')).join(', ') : ''}</li>
      <li><b>Claims without evidence:</b> ${noev.length}${noev.length ? ': ' + noev.map(p => p.id.replace(/^p/, '¶')).join(', ') : ''}</li>
      <li><b>Sections that hold up nothing</b> (ablation preview): ${empty.length ? empty.map(s => esc(s.name)).join(', ') : 'none flagged'}</li>
      <li><b>Paragraphs nothing depends on:</b> marked in the skeleton in orange. Each one is either the end of a chain (fine) or a diary entry (cut or give it a job).</li>
    </ul><p class="hint">Reverse outlining checks structure, not truth. A paper about nothing can pass every test above. Use the four tags (E, C, F, G) on the sentences themselves for that.</p>`;
  }

  // ---------- export ----------
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  $('#btn-json').onclick = () => { if (!S.result) return; download('outline-' + stamp() + '.json', JSON.stringify({ paper: S.paper.title, result: S.result, mine: S.mine, ai_log: S.log, cost: S.cost }, null, 2), 'application/json'); };
  $('#btn-md').onclick = () => {
    if (!S.result) return; const R = S.result; let md = `# Reverse outline: ${S.paper.title}\n\n`;
    for (const s of R.sections) { md += `## ${s.name}\n_holds up:_ ${s.holds_up || ''}\n\n| ¶ | tag | mine | model | flags |\n|---|---|---|---|---|\n`; for (const p of (s.paragraphs || [])) md += `| ${p.id} | ${p.tag} | ${(S.mine[p.id] || '').replace(/\|/g, '/')} | ${(p.does || '').replace(/\|/g, '/')} | ${(p.flags || []).join(', ')} |\n`; md += '\n'; }
    md += `## Checks\n- Contribution (${(R.contribution || {}).paragraph}): ${(R.contribution || {}).sentence}\n- Falsifier stated: ${R.falsifier && R.falsifier.stated ? 'yes' : 'no'}. ${(R.falsifier || {}).text || ''}\n- Notes: ${R.notes || ''}\n`;
    download('outline-' + stamp() + '.md', md, 'text/markdown');
  };
  $('#btn-log').onclick = async () => { const md = ['| # | What I asked | What it claimed | Verified? | Result | What I did with it |', '|---|---|---|---|---|---|', ...S.log.map((l, i) => `| ${i + 1} ` + Parley.logRow(l))].join('\n'); try { await navigator.clipboard.writeText(md); status('AI log copied.', 'ok'); } catch (e) { download('ai-log-' + stamp() + '.md', md, 'text/markdown'); } };
  // ---------- preloaded example: Lenticular Objects (UIST 2021), replace with your own ----------
  const SAMPLE_URL = '../assets/data/samples/lenticular-objects.md';
  async function loadSample(quiet) {
    try {
      const r = await fetch(SAMPLE_URL); if (!r.ok) throw new Error(r.status);
      const text = await r.text(); const title = (text.split('\n')[0] || '').replace(/^#\s*/, '').split(':')[0] || 'Lenticular Objects';
      setPaper({ title: title + ' (UIST 2021)', text, pages: null, source: 'preloaded example. Replace it with your own paper or draft.' });
      if (!quiet) status('Example loaded: Lenticular Objects (UIST 2021). Drop your own PDF or paste your draft to replace it.', 'ok');
    } catch (e) { if (!quiet) status('Could not load the example (' + e.message + ').', 'err'); }
  }
  const sampleBtn = document.getElementById('btn-sample'); if (sampleBtn) sampleBtn.onclick = () => loadSample(false);
  if (!new URLSearchParams(location.search).get('pdf')) S.sampleReady = loadSample(false);

  // ---------- ?pdf= : load a PDF by URL (same origin or CORS-enabled) ----------
  (async () => { const u = new URLSearchParams(location.search).get('pdf'); if (!u) return; status('Fetching PDF…', 'busy'); try { const r = await fetch(u); if (!r.ok) throw new Error(r.status); const x = await PdfText.extract(await r.arrayBuffer()); setPaper({ title: decodeURIComponent(u.split('/').pop().replace(/\.pdf$/i, '')), text: x.text, pages: x.pages, source: 'PDF by URL' }); } catch (e) { status('Could not fetch that PDF (' + e.message + '). Upload it instead.', 'err'); } })();
})();
