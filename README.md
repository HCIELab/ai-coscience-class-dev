# Class website (dev)

Static site for the research and writing track of the Fall 2027 GenAI in HCI Research course. No build step: plain HTML and one stylesheet, so it can be served by GitHub Pages or copied into the lab site at a path.

## Contents

Six-item nav, no dropdowns:

- `index.html` **Schedule** (home): three sentences, a "this week" callout, one table with one row per week (Wednesday lecture, Wednesday lab, Friday lab, due). Grey italic cells are proposed and not yet reviewed
- `project.html` **Project**: two tracks for choosing ideas, idea seeds, feasibility gate, milestones (tool track and paper track), LBW format, tool requirements
- `tools.html` **Tools**: the browser tools reused across weeks (explorer, outline builder, tagger, prediction sheet, AI log)
- `guides/` **Guides**: working with AI, reading a field, writing the paper, reviewing and responding
- `readings.html` **Readings**: course readings, the annotated overview by research stage, hook paper slots, strong LBWs
- `syllabus.html` **Syllabus**: about, team, grading, policies, links

Unlisted: `iap-2027.html`, the IAP 2027 proposal page (Research with AI, skill deliverable). Not in the nav, not linked from any page, `noindex` like the rest; reachable by URL only. Source draft lives in `6_IAP-Version/C_research-skill.md`

Also: `labs-catalog.html` (all thirteen lab ideas with wireframes), `labs/lab-template.html` (student-facing lab page template), `assets/css/site.css` (styles, light only, matching hcie.csail.mit.edu). Pages are generated from a build script kept outside the repo; edit the HTML directly or ask for the script
- `.env.example` variable reference for local scripts; `.env` itself is ignored
- `.nojekyll` tells GitHub Pages to serve files as-is

Design notes, the 13-week framework, and instructor material are **not** in this repo. They live in the course folder (`4_Research-Writing-Track/`).

## Edit locally, inline

```bash
python3 dev/edit.py          # serves the site at http://127.0.0.1:8765/?edit=1 and opens it
```

With editing on, click any paragraph, heading, list item, or table cell and type. Clicking away writes the change straight into the HTML file. Esc cancels. Alt-click a link to change its address. Focus a list item or table row for duplicate and delete buttons. "Changes" shows the uncommitted git diff; "Commit and push" runs git, or ask Claude to publish. The editor binds to localhost only and is standard-library Python.

Plain preview without the editor: `python3 -m http.server 8000`.

## Rules for this repo

- **Every page carries** `<meta name="robots" content="noindex, nofollow">`. This is how the site stays out of search. Do not add a `robots.txt` as well: a crawler blocked by `robots.txt` never sees the `noindex`, and a linked URL can still surface as a bare result
- **No secrets.** Keys go in `.env` (ignored) or in the student's own browser, never in a committed file or in client-side JS. Anything ever committed stays in history and in forks; fixing a leak means rewriting history and rotating the key
- **No instructor-only material.** Answer keys, grading anchors, review packets, and solutions go in a separate private repo. GitHub Pages serves every file in the repo whether linked or not
- **No student data.** Rosters, grades, and submissions live in Canvas or another MIT-sanctioned system, never in git
- `noindex` is not access control. If a page must be visible only to enrolled students, put it behind authentication instead

## Adding a page

Copy `labs/lab-template.html`, keep the `<head>` and the nav block (charset, viewport, robots, fonts, stylesheet), fix the relative paths, and add it to the nav in each page.

## Hook papers in the explorer

`assets/data/hook-papers.json` lists the hook papers shown as sample seeds in `tools/explorer.html`. Each entry may name a `thumb` image; the card shows it when present and a styled front-page placeholder otherwise. To add a first-page screenshot for a paper, save a PNG about 360px wide as `assets/img/seeds/<OpenAlex id>.png` and set `"thumb"` to that path. Only include images you have the right to publish (open-access PDFs are fine; publisher PDFs behind the MIT license are not, on a public site).
