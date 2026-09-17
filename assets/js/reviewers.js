/* Reviewer predictor: independent persona reviews plus a meta-review. Frontend only; Parley is the only backend. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const status = (m, c) => { const s = $('#status'); s.textContent = m; s.className = 'status ' + (c || ''); };
  const S = { paper: null, reviews: [], meta: null, cost: 0, log: [] };
  const MAXCHARS = 70000;

  const PRESETS = [
    { id: 'fab', name: 'Fabrication and systems builder', on: true, text: 'You build things and review for UIST-style venues. You care whether the technique is new relative to prior fabrication and systems work, whether the characterization measures the real limits (tolerances, materials, failure modes, repeatability), whether the demonstrations are evidence or decoration, and whether a reader could reproduce it. You notice missing baselines and you distrust user studies bolted onto systems papers.' },
    { id: 'methods', name: 'HCI methods and statistics', on: true, text: 'You read for validity. Study design, sample size and power, preregistration, appropriate tests, effect sizes, confounds, whether claims match the analysis, whether qualitative claims are grounded in quoted data. You quote the exact sentence where a claim outruns its evidence.' },
    { id: 'design', name: 'Design research and critical HCI', on: false, text: 'You read for framing and reflexivity: who this is for, whose values are embedded, whether the motivation is earned or assumed, whether the contribution is a design-knowledge claim and how it is articulated. You push on generalization, on missing communities, and on introductions that promise more than the paper delivers.' },
    { id: 'cscw', name: 'Social computing and CSCW', on: false, text: 'You read for context and ecological validity: real settings, real stakes, consent and ethics, the gap between lab behavior and practice, and whether the related work engages the social science the paper leans on.' },
    { id: 'access', name: 'Accessibility', on: false, text: 'You read for who is excluded: participants and their representation, assumptions about bodies and abilities, deployment realities, and whether accessibility claims were tested with disabled people or merely asserted.' },
    { id: 'ai', name: 'AI and ML systems', on: true, text: 'You read the model claims: baselines, evaluation of any LLM or ML component, prompt and model-version reporting, nondeterminism, data leakage, cherry-picked examples, and whether the system\'s failure rate is measured and reported rather than described.' },
    { id: 'vis', name: 'Visualization and perception', on: false, text: 'You read the figures first: encodings, axes, what each figure claims versus what the text claims, missing uncertainty, and whether the visual results would survive a different defensible choice of chart.' },
    { id: 'cogpsy', name: 'Cognitive psychology', on: false, text: 'You read for theory and constructs: whether constructs are defined and measured validly, whether prior theory is represented correctly, replication history, and over-interpretation of small effects.' },
    { id: 'industry', name: 'Industry practitioner', on: false, text: 'You read for deployability: cost, robustness, what breaks at scale, what a team would need to adopt this, and whether the paper overclaims impact.' },
  ];
  const BASE = (venue, track, persona) => `You are a reviewer for ${venue} (${track}). ${persona}
Review the paper as this reviewer would. Rules: ground every point in the actual text and quote it where you can; attack the strongest version of the work, not a strawman; no praise padding; if something a reviewer like you would probe actually holds up, say "probed X, held up" in one line and move on. Be harsh but fair and specific.
Return JSON only, exactly this shape:
{"summary":"the contribution in your own words, two sentences","strengths":["..."],"concerns":[{"type":"claim|evidence|framing|writing|scope","severity":"high|medium|low","where":"section or paragraph","text":"the concern, concrete","check":"one specific check the authors could run to find out if this concern is real"}],"unsupported_claims":["quoted sentences that outrun the evidence"],"fix_first":"the one thing to fix first, and why","score":3,"confidence":3,"recommendation":"reject|major revision|accept with minor revisions|accept"}
score is on the ${venue} 1 to 5 scale (1 reject, 2 weak reject, 3 borderline, 4 weak accept, 5 accept); confidence 1 to 4.`;
  const META = (venue, track) => `You are the associate chair (meta-reviewer) for ${venue} (${track}). You have the paper and the reviews below (JSON). Weigh them against the paper itself; a reviewer can be wrong. Return JSON only:
{"decision":"reject|revise and resubmit|accept with minor revisions|accept","decisive":["the points that decide the outcome: raised by more than one reviewer, or fatal alone"],"disagreements":["where reviewers disagree and who is right given the paper, one line each"],"must_do":["what the authors must do, ranked"],"could_rebut":["reviewer points the authors could legitimately push back on, and the evidence to cite"],"summary":"three sentences"}`;

  // ---------- personas UI ----------
  const box = $('#personas');
  function renderPersonas() {
    box.innerHTML = '';
    PRESETS.forEach((p, i) => {
      const d = document.createElement('div'); d.className = 'persona'; d.dataset.open = '0';
      d.innerHTML = `<div class="head"><input type="checkbox" id="pc${i}" ${p.on ? 'checked' : ''}><b><label for="pc${i}">${esc(p.name)}</label></b><button data-a="edit">edit</button>${p.custom ? '<button data-a="del">remove</button>' : ''}</div><textarea>${esc(p.text)}</textarea>`;
      d.querySelector('input').onchange = e => { p.on = e.target.checked; estimate(); };
      d.querySelector('[data-a=edit]').onclick = () => d.dataset.open = d.dataset.open === '1' ? '0' : '1';
      const del = d.querySelector('[data-a=del]'); if (del) del.onclick = () => { PRESETS.splice(i, 1); renderPersonas(); estimate(); };
      d.querySelector('textarea').addEventListener('input', e => p.text = e.target.value);
      box.append(d);
    });
  }
  $('#btn-add').onclick = () => { const name = prompt('Reviewer background, in a few words:', 'e.g. Tangible interaction'); if (!name) return; PRESETS.push({ id: 'c' + Date.now(), name, on: true, custom: true, text: 'You review from the perspective of ' + name + '. Describe what you care about, what you distrust, and what you always ask for.' }); renderPersonas(); box.lastElementChild.dataset.open = '1'; estimate(); };
  renderPersonas();

  // ---------- paper input ----------
  const drop = $('#drop'), file = $('#file');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadPdf(f); });
  file.addEventListener('change', () => { if (file.files[0]) loadPdf(file.files[0]); });
  async function loadPdf(f) { status('Extracting text from ' + f.name + '…', 'busy'); try { const r = await PdfText.extract(await f.arrayBuffer(), (p, n) => status(`Extracting page ${p} of ${n}…`, 'busy')); setPaper({ title: f.name.replace(/\.pdf$/i, ''), text: r.text, pages: r.pages }); } catch (e) { status('Could not read that PDF: ' + e.message, 'err'); } }
  $('#btn-paste').onclick = () => { const t = $('#paste').value.trim(); if (t.length < 200) { status('Paste at least a few paragraphs.', 'err'); return; } setPaper({ title: (t.split('\n')[0] || 'pasted text').slice(0, 90), text: t }); };
  function setPaper(p) { S.paper = p; const words = p.text.split(/\s+/).filter(Boolean).length; $('#paper-kv').innerHTML = `<b>${esc(p.title)}</b><br>${p.pages ? p.pages + ' pages · ' : ''}${words.toLocaleString()} words${p.source ? ' · ' + esc(p.source) : ''}`; estimate(); if (!/preloaded/.test(p.source || '')) status(`Loaded: ${p.title}.`, 'ok'); }
  const bodyText = () => { let t = S.paper.text; if ($('#opt-refs').checked) t = PdfText.body(t); return t.length > MAXCHARS ? t.slice(0, MAXCHARS) : t; };
  const active = () => PRESETS.filter(p => p.on);
  function estimate() { if (!S.paper) return; const n = active().length + ($('#opt-meta').checked ? 1 : 0); const est = Parley.estimate($('#model').value, bodyText() + BASE('CHI', 'x', 'y'), 1800) * n; $('#est').textContent = '$' + est.toFixed(4) + ` (${n} calls)`; }
  ['#model', '#opt-refs', '#opt-meta'].forEach(s => $(s).addEventListener('change', estimate));
  Parley.wire({ key: $('#key'), model: $('#model'), forget: $('#btn-forget'), status: (m, c) => { status(m, c); estimate(); }, prefer: /sonnet-5|sonnet/ });

  // ---------- run ----------
  $('#btn-run').onclick = run;
  async function run() {
    if (!S.paper && S.sampleReady) { status('Loading the example paper…', 'busy'); await S.sampleReady; }
    if (!S.paper) { status('Load a paper first: drop a PDF, paste text, or click "Load the example paper".', 'err'); return; }
    const key = Parley.getKey(); if (!key) { status('Enter your Parley key.', 'err'); return; }
    const revs = active(); if (!revs.length) { status('Tick at least one reviewer.', 'err'); return; }
    const model = $('#model').value, venue = $('#venue').value, track = $('#track').value, text = bodyText();
    const est = Parley.estimate(model, text + BASE(venue, track, ''), 1800) * (revs.length + ($('#opt-meta').checked ? 1 : 0));
    if (est > 0.25 && !confirm(`Estimated cost about $${est.toFixed(2)} on ${model} for ${revs.length} reviewers${$('#opt-meta').checked ? ' plus a meta-review' : ''}. Continue?`)) return;
    $('#btn-run').disabled = true; S.reviews = []; S.meta = null; let done = 0; const prog = $('#prog'); prog.textContent = `0 of ${revs.length} reviews`;
    status(`Running ${revs.length} reviewers in parallel on ${model}…`, 'busy');
    try {
      S.reviews = await Promise.all(revs.map(async p => {
        try {
          const r = await Parley.chat({ key, model, system: BASE(venue, track, p.text), user: 'PAPER TEXT:\n\n' + text, maxTokens: 2500 });
          S.cost += r.cost; const j = Parley.parseJson(r.text); done++; prog.textContent = `${done} of ${revs.length} reviews`;
          return { persona: p, json: j, raw: r.text, cost: r.cost, truncated: r.finish === 'length' };
        } catch (e) { done++; return { persona: p, json: null, raw: 'Call failed: ' + e.message, cost: 0 }; }
      }));
      $('#cost').textContent = '$' + S.cost.toFixed(4);
      if ($('#opt-meta').checked) {
        status('Reviews in. Asking the meta-reviewer…', 'busy');
        const packet = S.reviews.filter(r => r.json).map(r => ({ reviewer: r.persona.name, review: r.json }));
        try { const m = await Parley.chat({ key, model, system: META(venue, track), user: 'PAPER TEXT:\n\n' + text + '\n\nREVIEWS (JSON):\n' + JSON.stringify(packet), maxTokens: 1800 }); S.cost += m.cost; S.meta = { json: Parley.parseJson(m.text), raw: m.text, cost: m.cost }; } catch (e) { S.meta = { json: null, raw: 'Meta-review failed: ' + e.message, cost: 0 }; }
        $('#cost').textContent = '$' + S.cost.toFixed(4);
      }
      const scores = S.reviews.filter(r => r.json && r.json.score != null).map(r => r.json.score);
      S.log.push({ asked: `${revs.length} persona reviews${$('#opt-meta').checked ? ' + meta-review' : ''} of "${S.paper.title}" for ${venue} ${track} (${model}); personas: ${revs.map(p => p.name).join(', ')}`, claimed: `scores ${scores.join(', ') || 'none'}; decision ${S.meta && S.meta.json ? S.meta.json.decision : 'n/a'}`, verified: 'quoted claims to be checked against the text by me', result: `cost $${S.cost.toFixed(4)}`, did: $('#mine').value.trim() ? 'compared with my own prediction' : 'read; no own prediction written first' });
      renderAll(); status(`Done. ${S.reviews.filter(r => r.json).length} of ${revs.length} reviews parsed. Cost $${S.cost.toFixed(4)}.`, 'ok');
    } finally { $('#btn-run').disabled = false; prog.textContent = ''; }
  }

  // ---------- render ----------
  const tabs = $('#tabs'), main = document.querySelector('.canvas');
  function showView(v) { tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); main.querySelectorAll('.view').forEach(x => x.hidden = x.id !== 'v-' + v); }
  tabs.addEventListener('click', e => { const b = e.target.closest('button'); if (b) showView(b.dataset.v); });
  function renderAll() {
    main.querySelectorAll('.view').forEach(v => { if (v.id !== 'v-intro') v.remove(); }); tabs.innerHTML = '';
    if (S.meta) { tabs.insertAdjacentHTML('beforeend', '<button data-v="meta">Meta-review</button>'); main.insertAdjacentHTML('beforeend', `<div class="view" id="v-meta" hidden>${renderMeta()}</div>`); }
    S.reviews.forEach((r, i) => { tabs.insertAdjacentHTML('beforeend', `<button data-v="r${i}">${esc(r.persona.name.split(' ').slice(0, 2).join(' '))}${r.json && r.json.score != null ? ' · ' + r.json.score : ''}</button>`); main.insertAdjacentHTML('beforeend', `<div class="view" id="v-r${i}" hidden>${renderReview(r)}</div>`); });
    tabs.insertAdjacentHTML('beforeend', '<button data-v="intro">About</button>');
    showView(S.meta ? 'meta' : 'r0');
  }
  function renderReview(r) {
    if (!r.json) return `<div class="rev"><h3>${esc(r.persona.name)}</h3><p class="hint">Could not parse this review as JSON. Raw answer:</p><pre>${esc(r.raw)}</pre></div>`;
    const j = r.json; const concerns = (j.concerns || []).map(c => `<li class="sev-${esc(c.severity || 'low')}"><span class="type">${esc(c.type || '')}</span>${c.where ? `<span class="type">${esc(c.where)}</span>` : ''}${esc(c.text)}<span class="check">check: ${esc(c.check || '')}</span></li>`).join('');
    return `<div class="rev"><h3>${esc(r.persona.name)}</h3><p><span class="score">score ${esc(j.score)} / 5</span><span class="score">confidence ${esc(j.confidence)} / 4</span><span class="score">${esc(j.recommendation || '')}</span>${r.truncated ? ' <span class="type">truncated</span>' : ''}</p>
      <h4>Summary</h4><p>${esc(j.summary)}</p>
      <h4>Strengths</h4><ul>${(j.strengths || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      <h4>Concerns, ranked</h4><ol>${concerns}</ol>
      <h4>Claims the paper cannot support</h4>${(j.unsupported_claims || []).map(q => `<blockquote>${esc(q)}</blockquote>`).join('') || '<p class="hint">none quoted</p>'}
      <h4>Fix first</h4><p>${esc(j.fix_first)}</p></div>`;
  }
  function renderMeta() {
    const m = S.meta; if (!m.json) return `<div class="rev"><h3>Meta-review</h3><pre>${esc(m.raw)}</pre></div>`; const j = m.json;
    const rows = []; S.reviews.forEach(r => (r.json && r.json.concerns || []).forEach(c => rows.push({ who: r.persona.name, type: c.type, sev: c.severity, text: c.text })));
    const table = rows.length ? `<table class="meta"><thead><tr><th>Reviewer</th><th>Type</th><th>Severity</th><th>Concern</th></tr></thead><tbody>${rows.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.sev] || 3) - ({ high: 0, medium: 1, low: 2 }[b.sev] || 3)).map(x => `<tr><td>${esc(x.who)}</td><td>${esc(x.type)}</td><td>${esc(x.sev)}</td><td>${esc(x.text)}</td></tr>`).join('')}</tbody></table>` : '';
    const mine = $('#mine').value.trim();
    return `<div class="rev"><h3>Meta-review</h3><p><span class="decision">${esc(j.decision)}</span> scores: ${S.reviews.filter(r => r.json).map(r => esc(r.json.score)).join(' · ')}</p><p>${esc(j.summary)}</p>
      <h4>Decisive points</h4><ol>${(j.decisive || []).map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      <h4>Where reviewers disagree</h4><ul>${(j.disagreements || []).map(x => `<li>${esc(x)}</li>`).join('') || '<li class="hint">none noted</li>'}</ul>
      <h4>Must do</h4><ol>${(j.must_do || []).map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      <h4>Could rebut</h4><ul>${(j.could_rebut || []).map(x => `<li>${esc(x)}</li>`).join('') || '<li class="hint">nothing flagged</li>'}</ul>
      ${mine ? `<h4>Your prediction, written before running</h4><blockquote>${esc(mine).replace(/\n/g, '<br>')}</blockquote><p class="hint">Which of your points showed up? Which decisive point did you miss?</p>` : ''}
      <h4>All concerns</h4>${table}
      <p class="hint">A model review is rehearsal, not verdict. Check every quoted sentence against the text; the model misquotes.</p></div>`;
  }

  // ---------- export ----------
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  $('#btn-json').onclick = () => { if (!S.reviews.length) return; download('reviews-' + stamp() + '.json', JSON.stringify({ paper: S.paper.title, venue: $('#venue').value, track: $('#track').value, reviews: S.reviews.map(r => ({ persona: r.persona, review: r.json, raw: r.json ? undefined : r.raw })), meta: S.meta && S.meta.json, my_prediction: $('#mine').value, ai_log: S.log, cost: S.cost }, null, 2), 'application/json'); };
  $('#btn-md').onclick = () => {
    if (!S.reviews.length) return; let md = `# Predicted reviews: ${S.paper.title}\n_${$('#venue').value}, ${$('#track').value}; model reviews are rehearsal, not verdict._\n\n`;
    if (S.meta && S.meta.json) { const j = S.meta.json; md += `## Meta-review: ${j.decision}\n${j.summary}\n\n**Decisive:**\n${(j.decisive || []).map(x => '- ' + x).join('\n')}\n\n**Must do:**\n${(j.must_do || []).map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n**Could rebut:**\n${(j.could_rebut || []).map(x => '- ' + x).join('\n')}\n\n`; }
    S.reviews.forEach(r => { if (!r.json) { md += `## ${r.persona.name}\n(unparsed)\n\n${r.raw}\n\n`; return; } const j = r.json; md += `## ${r.persona.name}: ${j.score}/5, confidence ${j.confidence}/4, ${j.recommendation}\n${j.summary}\n\n**Strengths**\n${(j.strengths || []).map(x => '- ' + x).join('\n')}\n\n**Concerns**\n${(j.concerns || []).map((c, i) => `${i + 1}. [${c.type}, ${c.severity}${c.where ? ', ' + c.where : ''}] ${c.text}\n   check: ${c.check}`).join('\n')}\n\n**Unsupported claims**\n${(j.unsupported_claims || []).map(x => '> ' + x).join('\n')}\n\n**Fix first:** ${j.fix_first}\n\n`; });
    if ($('#mine').value.trim()) md += `## My own prediction (written first)\n${$('#mine').value}\n`;
    download('reviews-' + stamp() + '.md', md, 'text/markdown');
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
