# Class website (dev)

Static site for the research and writing track of the Fall 2027 GenAI in HCI Research course. No build step: plain HTML and one stylesheet, so it can be served by GitHub Pages or copied into the lab site at a path.

## Contents

- `index.html` the labs catalog (thirteen browser-runnable lab ideas, one wireframe each)
- `labs/lab-template.html` the student-facing lab page template: Before you start, Explore, Do, Checkoff, Write, Deliverables, What's next
- `assets/css/site.css` shared styles and design tokens (light and dark)
- `.env.example` variable reference for local scripts; `.env` itself is ignored
- `.nojekyll` tells GitHub Pages to serve files as-is

Design notes, the 13-week framework, and instructor material are **not** in this repo. They live in the course folder (`4_Research-Writing-Track/`).

## Preview locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Rules for this repo

- **Every page carries** `<meta name="robots" content="noindex, nofollow">`. This is how the site stays out of search. Do not add a `robots.txt` as well: a crawler blocked by `robots.txt` never sees the `noindex`, and a linked URL can still surface as a bare result
- **No secrets.** Keys go in `.env` (ignored) or in the student's own browser, never in a committed file or in client-side JS. Anything ever committed stays in history and in forks; fixing a leak means rewriting history and rotating the key
- **No instructor-only material.** Answer keys, grading anchors, review packets, and solutions go in a separate private repo. GitHub Pages serves every file in the repo whether linked or not
- **No student data.** Rosters, grades, and submissions live in Canvas or another MIT-sanctioned system, never in git
- `noindex` is not access control. If a page must be visible only to enrolled students, put it behind authentication instead

## Adding a page

Copy `labs/lab-template.html`, keep the `<head>` (charset, viewport, robots, fonts, stylesheet), fix the relative paths, and add it to the nav in each page.
