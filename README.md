# Case studies

Markdown in, website out. Each case study is a folder in `studies/`; push to `main`
and GitHub Pages publishes it. The look is telemetry-by-ear's theme (`theme/`), so
every study reads as part of one site.

## Why it's built this way

- **Publishing should take nothing but the writing.** A study is a Markdown file;
  committing it, from a laptop or the GitHub website, is the whole job. Everything
  else happens in CI.
- **A bad push must never replace a good site.** The build checks every study first
  (fields, dates, colours, images, addresses) and stops on any problem, naming the
  file, the line and the fix. The check has its own tests (`test/`), because a
  check that passed everything would look exactly like one that works.
- **As little to maintain as possible.** One dependency, the Markdown parser, pinned
  to an exact version. No framework, no bundler, no theme engine: `build.mjs` is
  the whole build, and the output is static HTML.
- **One look for every study.** The theme is the one telemetry-by-ear uses, unchanged,
  so the site reads as one body of work; each study can still set its own accent
  colour.

## Add a case study

1. Make a folder: `studies/<name>/`. Lowercase letters, digits and hyphens: it
   becomes the address (`…/case-studies/<name>/`).
2. Put the text in `studies/<name>/index.md`, starting with this frontmatter:

   ```markdown
   ---
   title: Where the work happens
   description: One or two sentences. It's the standfirst and the link preview.
   date: 2026-11-09
   status: draft
   ---

   ## The first section

   Text…
   ```

3. Put its images next to it (`studies/<name>/img/…`) and use them in the text:

   ```markdown
   ![What the image shows, for screen readers.](img/board.png "The caption under it.")
   ```

   An image on its own line becomes a figure; the part in quotes is the caption.

4. When it's ready, change `status: draft` to `status: published` and push. That's
   the only switch.

Write sections with `##` (and `###` below them); the title comes from the
frontmatter. Straight quotes become curly ones by themselves.

### All the frontmatter fields

| Field | Needed | What it does |
|---|---|---|
| `title` | yes | the page title and the front-page card |
| `description` | yes | the standfirst (when the text opens on a section), the card, and the link preview; up to 220 characters |
| `date` | yes | `YYYY-MM-DD`; the front page lists newest first |
| `status` | yes | `draft` (built only in preview) or `published` |
| `kicker` | no | the small line above the title; by default "Case study · corgido · Month Year" |
| `image` | no | an image in the folder used as the link preview (`img/board.png`) |
| `accent`, `accent_dark` | no, but both or neither | the study's colour, for light and dark (`"#1e6b45"`, `"#6fcf97"`) |
| `link` | no | for a study that lives elsewhere: the card points there, and the file has no text (see `studies/telemetry-by-ear.md`) |

Anything else in the frontmatter is refused as a probable typo.

## Look at it before you push

```bash
npm install
npm run preview
```

Then open http://localhost:8000. Drafts are included in the preview.

`npm run check` only checks. Every problem is listed with its file and line, and
nothing is built until they're all fixed. The same check runs on every push, so a
broken study never replaces a working site. `npm test` proves the check itself
still refuses what it should.

## Set up once

1. Push this folder to a new repository, e.g. `corgido/case-studies`.
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Edit `site.json`: the site's title, the name in the kicker (`author`), the
   address it's published at (`url`, used for link previews) and the header links.
4. Edit `index.md` at the top level: the paragraph on the front page.

## What's where

| Path | What it is |
|---|---|
| `studies/` | the case studies, one folder each |
| `index.md` | the front page's intro paragraph |
| `site.json` | site title, author, address, header links |
| `theme/` | telemetry-by-ear's stylesheet, scripts and fonts (unchanged), plus `extra.css` for the front page |
| `build.mjs` | checks the studies and writes `_site/`; no other build tools |
| `test/` | tests that the check refuses what it should (`npm test`) |
| `.github/workflows/pages.yml` | check, build and publish on every push to `main` |

All rights reserved: see `LICENSE`. The fonts are the exception, under the SIL Open
Font License; their licences are in `theme/fonts/`.
