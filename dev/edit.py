#!/usr/bin/env python3
"""Local inline editor for the class site.

Run:   python3 dev/edit.py              (from the site folder; --port to change 8765)
Open:  http://127.0.0.1:8765/?edit=1

What it does
- Serves the site folder exactly as GitHub Pages would, plus an editing toolbar.
- With editing on, paragraphs, headings, list items and table cells are click-to-edit.
  Each edit is written straight into the HTML source file when you click away.
- List items and table rows get "duplicate" and "delete" buttons.
- "Changes" shows the uncommitted git diff. "Commit and push" runs git for you,
  or leave that to Claude.
- Binds to 127.0.0.1 only. Never expose it beyond your machine.

Standard library only.
"""
import argparse, http.server, json, os, re, subprocess, sys, urllib.parse, webbrowser
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

EDITABLE = {"p","li","td","th","h1","h2","h3","h4","h5","h6","dt","dd","figcaption","blockquote","summary","caption"}
STRUCT = {"li","tr"}
NO_EDIT_INSIDE = {"script","style","svg","nav","footer","head","template"}
VOID = {"area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"}


class Spans(HTMLParser):
    """Records source offsets of editable elements so edits patch the file exactly."""
    def __init__(self, src):
        super().__init__(convert_charrefs=False)
        self.src = src
        self.line_starts = [0]
        for i, ch in enumerate(src):
            if ch == "\n":
                self.line_starts.append(i + 1)
        self.stack, self.eids, self.sids, self.skip = [], [], [], 0
        self.feed(src); self.close()

    def off(self):
        line, col = self.getpos()
        return self.line_starts[line - 1] + col

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        start = self.off(); raw = self.get_starttag_text() or ""
        if raw.rstrip().endswith("/>"):
            return
        rec = {"tag": tag, "open_start": start, "inner_start": start + len(raw),
               "inner_end": None, "close_end": None, "eid": None, "sid": None}
        if self.skip == 0 and tag in EDITABLE:
            rec["eid"] = len(self.eids); self.eids.append(rec)
        if self.skip == 0 and tag in STRUCT:
            rec["sid"] = len(self.sids); self.sids.append(rec)
        if tag in NO_EDIT_INSIDE:
            self.skip += 1
        self.stack.append(rec)

    def handle_endtag(self, tag):
        start = self.off()
        m = re.compile(r"</\s*%s\s*>" % re.escape(tag), re.I).match(self.src, start)
        close_end = m.end() if m else start
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i]["tag"] == tag:
                rec = self.stack[i]; rec["inner_end"] = start; rec["close_end"] = close_end
                del self.stack[i:]
                break
        if tag in NO_EDIT_INSIDE:
            self.skip = max(0, self.skip - 1)


def tag_html(src):
    sp = Spans(src)
    ins = [(r["inner_start"] - 1, ' data-eid="%d"' % r["eid"]) for r in sp.eids]
    ins += [(r["inner_start"] - 1, ' data-sid="%d"' % r["sid"]) for r in sp.sids]
    ins.sort(key=lambda x: x[0])
    out, last = [], 0
    for pos, s in ins:
        out.append(src[last:pos]); out.append(s); last = pos
    out.append(src[last:])
    html = "".join(out)
    inject = '\n<link rel="stylesheet" href="/__editor.css"><script src="/__editor.js"></script>\n'
    i = html.lower().rfind("</body>")
    return html[:i] + inject + html[i:] if i >= 0 else html + inject


def norm(s):
    return re.sub(r"[\"']", "", re.sub(r"\s+", " ", s)).strip().lower()


def safe_join(rel):
    full = os.path.normpath(os.path.join(ROOT, rel))
    if not full.startswith(ROOT + os.sep) or not full.endswith(".html") or not os.path.isfile(full):
        raise ValueError("bad path")
    return full


def do_save(rel, eid, new_inner, fp):
    full = safe_join(rel)
    src = open(full, encoding="utf-8").read()
    sp = Spans(src)
    if not (0 <= eid < len(sp.eids)):
        return {"ok": False, "error": "element index out of range; reload the page"}
    r = sp.eids[eid]
    if r["inner_end"] is None:
        return {"ok": False, "error": "unclosed element in source"}
    old = src[r["inner_start"]:r["inner_end"]]
    if fp is not None and norm(old) != norm(fp):
        cands = [x for x in sp.eids if x["inner_end"] is not None and norm(src[x["inner_start"]:x["inner_end"]]) == norm(fp)]
        if len(cands) == 1:
            r = cands[0]
        else:
            return {"ok": False, "error": "page changed since it was loaded; reload and redo this edit"}
    new_src = src[:r["inner_start"]] + new_inner + src[r["inner_end"]:]
    open(full, "w", encoding="utf-8").write(new_src)
    return {"ok": True}


def do_op(rel, sid, op):
    full = safe_join(rel)
    src = open(full, encoding="utf-8").read()
    sp = Spans(src)
    if not (0 <= sid < len(sp.sids)):
        return {"ok": False, "error": "row index out of range; reload the page"}
    r = sp.sids[sid]
    if r["close_end"] is None:
        return {"ok": False, "error": "unclosed element in source"}
    outer = src[r["open_start"]:r["close_end"]]
    ls = src.rfind("\n", 0, r["open_start"]) + 1
    lead = src[ls:r["open_start"]]
    indent = lead if lead.strip() == "" else ""
    if op == "dup":
        new_src = src[:r["close_end"]] + "\n" + indent + outer + src[r["close_end"]:]
    elif op == "del":
        start = ls if indent == lead else r["open_start"]
        end = r["close_end"]
        if src[end:end + 1] == "\n":
            end += 1
        new_src = src[:start] + src[end:]
    else:
        return {"ok": False, "error": "unknown op"}
    open(full, "w", encoding="utf-8").write(new_src)
    return {"ok": True}


def git(*args):
    p = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def do_status():
    _, st = git("status", "--porcelain")
    _, stat = git("diff", "--stat")
    _, diff = git("diff")
    return {"files": [l for l in st.splitlines() if l.strip()], "stat": stat, "diff": diff[:30000]}


def do_publish(message):
    git("add", "-A")
    _, st = git("status", "--porcelain")
    if not st.strip():
        return {"ok": True, "output": "nothing to commit"}
    rc, out = git("commit", "-m", message)
    if rc != 0:
        return {"ok": False, "error": out}
    rc, out2 = git("push")
    return {"ok": rc == 0, "output": out + out2, "error": out2 if rc else ""}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, fmt, *args):
        if self.path.startswith("/__"):
            return
        sys.stderr.write("%s %s\n" % (self.command, self.path))

    def end_headers(self):
        # never let the browser cache anything from the dev server; edits must show on reload
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def _send(self, code, body, ctype):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj), "application/json")

    def _rel(self):
        p = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if p.endswith("/"):
            p += "index.html"
        return p.lstrip("/")

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/__editor.js":
            return self._send(200, open(os.path.join(HERE, "editor.js"), "rb").read(), "application/javascript")
        if path == "/__editor.css":
            return self._send(200, open(os.path.join(HERE, "editor.css"), "rb").read(), "text/css")
        if path == "/__pages":
            pages = []
            for dp, dn, fn in os.walk(ROOT):
                dn[:] = [d for d in dn if not d.startswith(".") and d not in ("dev", "node_modules")]
                for f in fn:
                    if f.endswith(".html"):
                        pages.append(os.path.relpath(os.path.join(dp, f), ROOT))
            return self._json(sorted(pages))
        if path == "/__status":
            return self._json(do_status())
        rel = self._rel()
        if rel.endswith(".html"):
            try:
                full = safe_join(rel)
            except ValueError:
                return super().do_GET()
            src = open(full, encoding="utf-8").read()
            return self._send(200, tag_html(src), "text/html; charset=utf-8")
        return super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        n = int(self.headers.get("Content-Length", "0"))
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json({"ok": False, "error": "bad json"}, 400)
        try:
            if path == "/__save":
                return self._json(do_save(data["path"], int(data["eid"]), data["html"], data.get("fp")))
            if path == "/__op":
                return self._json(do_op(data["path"], int(data["sid"]), data["op"]))
            if path == "/__publish":
                return self._json(do_publish(data.get("message") or "Edit site content"))
        except Exception as e:
            return self._json({"ok": False, "error": str(e)}, 400)
        return self._json({"ok": False, "error": "unknown endpoint"}, 404)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    url = "http://127.0.0.1:%d/?edit=1" % a.port
    print("Editing", ROOT)
    print("Open   ", url, "   (Ctrl-C to stop)")
    if not a.no_browser:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
