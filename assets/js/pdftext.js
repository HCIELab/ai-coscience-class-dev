/* PDF to text in the browser with pdf.js (vendored). Returns pages, plain text, word count.
   Lines are rebuilt from glyph positions; a larger vertical gap becomes a paragraph break. */
(function () {
  window.PdfText = {
    ready() { if (!window.pdfjsLib) throw new Error('pdf.js did not load'); pdfjsLib.GlobalWorkerOptions.workerSrc = window.PDFJS_WORKER || '../assets/js/vendor/pdf.worker.min.js'; },
    async extract(data, onProgress) {
      this.ready();
      const doc = await pdfjsLib.getDocument({ data }).promise; const out = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p); const tc = await page.getTextContent();
        const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], h: i.height || 10 }));
        // sort into columns by x (two-column papers), then by y descending
        const mid = page.getViewport({ scale: 1 }).width / 2; const cols = [items.filter(i => i.x < mid - 20), items.filter(i => i.x >= mid - 20)];
        const twoCol = cols[0].length > 20 && cols[1].length > 20 && Math.abs(cols[0].length - cols[1].length) < Math.max(cols[0].length, cols[1].length);
        const groups = twoCol ? cols : [items];
        const lines = [];
        for (const g of groups) {
          g.sort((a, b) => (Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x));
          let cur = null, lastY = null, lastH = 10;
          for (const it of g) {
            if (cur && Math.abs(it.y - lastY) <= 3) { cur.text += (cur.text.endsWith('-') ? '' : ' ') + it.s; }
            else { const gap = lastY == null ? 0 : lastY - it.y; cur = { text: it.s, para: gap > lastH * 1.8 }; lines.push(cur); }
            lastY = it.y; lastH = it.h || lastH;
          }
        }
        out.push(lines.map(l => (l.para ? '\n' : '') + l.text.replace(/-\s+$/, '')).join('\n'));
        if (onProgress) onProgress(p, doc.numPages);
      }
      let text = out.join('\n\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
      return { pages: doc.numPages, text, words: text.split(/\s+/).filter(Boolean).length };
    },
    /* Cut the reference list; keep the body. */
    body(text) {
      const i = text.search(/\n\s*#{0,6}\s*(?:\d+\.?\s*)?(references|bibliography)\s*\n/i);
      return i > text.length * 0.5 ? text.slice(0, i) : text;
    }
  };
})();
