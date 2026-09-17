/* Shared Parley helper for the browser tools. The key lives only in this browser (localStorage),
   is sent only to parley.api.mit.edu over HTTPS, and never touches the site or its repository. */
(function () {
  const BASE = 'https://parley.api.mit.edu/v1';
  const PRICES = { // USD per million tokens, input / output; from the Parley cost guidance, for estimates only
    'claude-haiku-4-5': [1, 5], 'claude-sonnet-4-6': [3, 15], 'claude-sonnet-5': [2, 10], 'claude-opus-5': [5, 25], 'claude-opus-4-8': [5, 25], 'claude-opus-4-7': [5, 25],
    'gpt-5.4-nano': [0.2, 1.25], 'gpt-5.4-mini': [0.75, 4.5], 'gpt-5.4': [2.5, 15], 'gpt-5.5': [5, 30], 'gemini-3.0-flash': [0.5, 3], 'gemini-3.1-pro': [4, 18], 'llama-4-maverick-17b': [0, 0]
  };
  const P = {
    getKey() { try { return localStorage.getItem('parley_key') || ''; } catch (e) { return ''; } },
    setKey(k) { try { if (k) localStorage.setItem('parley_key', k.trim()); else localStorage.removeItem('parley_key'); } catch (e) { } },
    price(model) { const k = Object.keys(PRICES).find(x => (model || '').includes(x)); return k ? PRICES[k] : [3, 15]; },
    tokens(text) { return Math.ceil((text || '').length / 3.8); },
    estimate(model, inputText, outputTokens) { const [i, o] = P.price(model); return P.tokens(inputText) / 1e6 * i + (outputTokens || 0) / 1e6 * o; },
    async models(key) {
      const r = await fetch(BASE + '/models', { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok) throw new Error('Parley rejected the key (' + r.status + ')');
      return ((await r.json()).data || []).map(m => m.id).filter(id => !/embed|image|dall|whisper|tts/i.test(id)).sort();
    },
    async chat({ key, model, system, user, maxTokens = 4000, temperature = 0 }) {
      const r = await fetch(BASE + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, temperature, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
      const cost = parseFloat(r.headers.get('x-parley-v1-cost') || '0') || 0;
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || ('Parley ' + r.status));
      const ch = (j.choices && j.choices[0]) || {};
      return { text: (ch.message && ch.message.content) || '', finish: ch.finish_reason || '', cost, usage: j.usage || {} };
    },
    parseJson(text) {
      const t = String(text || '').replace(/```(?:json)?/gi, '');
      const a = Math.min(...['{', '['].map(c => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
      if (!isFinite(a)) return null;
      const close = t[a] === '{' ? '}' : ']'; const b = t.lastIndexOf(close); if (b <= a) return null;
      try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { try { return JSON.parse(t.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1')); } catch (e2) { return null; } }
    },
    /* Wires a key input, a model select, a forget button and a status callback. */
    wire({ key, model, forget, status, prefer = /haiku/ }) {
      key.value = P.getKey();
      const load = async () => {
        const k = key.value.trim(); if (!k) return;
        try { const ids = await P.models(k); model.innerHTML = ''; ids.forEach(id => model.append(new Option(id, id))); const pick = ids.find(i => prefer.test(i)) || ids[0]; if (pick) model.value = pick; status('Key accepted. ' + ids.length + ' models listed; ' + pick + ' selected.', 'ok'); }
        catch (e) { status(e.message, 'err'); }
      };
      key.addEventListener('change', () => { P.setKey(key.value); load(); });
      forget.addEventListener('click', () => { key.value = ''; P.setKey(''); status('Key removed from this browser.', 'ok'); });
      if (key.value) load();
    },
    logRow({ asked, claimed, verified, result, did }) { return `| ${asked} | ${claimed} | ${verified} | ${result} | ${did} |`.replace(/\n+/g, ' '); }
  };
  window.Parley = P;
})();
