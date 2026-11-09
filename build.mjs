#!/usr/bin/env node
/* Build the site from Markdown.

     node build.mjs              check everything, then write _site/ (published studies only)
     node build.mjs --check      check only; exit 1 on any problem, write nothing
     node build.mjs --drafts     also build studies marked `status: draft`
     node build.mjs --serve      after building, serve _site/ on http://localhost:8000

   A case study is a folder in studies/ with an index.md and anything it links to
   (images, files), or a single studies/<slug>.md that only points elsewhere with
   `link:`. The frontmatter is checked strictly: an unknown key is a typo until
   proven otherwise, and a broken image is a broken page. Any problem stops the
   build, so a bad push never replaces a good site. */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

// --root <dir> checks or builds another folder; the tests use it on throwaway studies.
const argv = process.argv.slice(2);
const rootAt = argv.indexOf("--root");
const ROOT = rootAt >= 0 ? path.resolve(argv[rootAt + 1]) : path.dirname(fileURLToPath(import.meta.url));
const THEME = path.join(path.dirname(fileURLToPath(import.meta.url)), "theme");
const OUT = path.join(ROOT, "_site");
const args = new Set(argv);
const CHECK = args.has("--check"), DRAFTS = args.has("--drafts"), SERVE = args.has("--serve");

const problems = [];
const problem = (file, line, msg) => problems.push(`${path.relative(ROOT, file)}${line ? ":" + line : ""}  ${msg}`);

// ── site settings ───────────────────────────────────────────────────────────
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "site.json"), "utf8"));
for (const k of ["title", "author", "description"]) if (!site[k]) problem(path.join(ROOT, "site.json"), 0, `"${k}" is missing`);
site.url = (site.url || "").replace(/\/+$/, "");
site.links = site.links || [];

// ── frontmatter ─────────────────────────────────────────────────────────────
const FIELDS = {
  title:       { required: true,  check: v => v.length <= 90 || "keep it under 90 characters" },
  description: { required: true,  check: v => v.length <= 220 || "keep it under 220 characters; it is the link preview" },
  date:        { required: true,  check: v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) || "write it as YYYY-MM-DD" },
  status:      { required: true,  check: v => ["published", "draft"].includes(v) || 'write "published" or "draft"' },
  kicker:      { required: false, check: v => v.length <= 80 || "keep it under 80 characters" },
  link:        { required: false, check: v => /^https:\/\/\S+$/.test(v) || "an https:// address" },
  image:       { required: false, check: () => true },
  accent:      { required: false, check: v => /^#[0-9a-fA-F]{6}$/.test(v) || "a colour like #1e6b45" },
  accent_dark: { required: false, check: v => /^#[0-9a-fA-F]{6}$/.test(v) || "a colour like #6fcf97" },
};

function readStudy(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) { problem(file, 1, "no frontmatter: start the file with --- , the fields, then --- again"); return null; }
  const meta = {}, lines = m[1].split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) { problem(file, i + 2, `can't read "${line}": write key: value`); return; }
    const [, key, rawVal] = kv;
    if (!(key in FIELDS)) { problem(file, i + 2, `unknown field "${key}" (known: ${Object.keys(FIELDS).join(", ")})`); return; }
    let val = rawVal.trim();
    if (/^(["']).*\1$/.test(val)) val = val.slice(1, -1);
    const ok = FIELDS[key].check(val);
    if (ok !== true) problem(file, i + 2, `${key}: ${ok}`);
    meta[key] = val;
  });
  for (const [key, f] of Object.entries(FIELDS)) if (f.required && !meta[key]) problem(file, 1, `"${key}" is missing`);
  if (!!meta.accent !== !!meta.accent_dark) problem(file, 1, "give accent and accent_dark together, so the dark theme stays readable");
  const body = text.slice(m[0].length).trim();
  if (!meta.link && !body) problem(file, 0, "no text after the frontmatter (or add link: to point elsewhere)");
  if (meta.link && body) problem(file, 0, "a study with link: points elsewhere, so it has no text here");
  return { meta, body, bodyLine: m[0].split("\n").length };
}

// ── typography: curly quotes and dashes in prose, never in code ─────────────
function smart(s) {
  return s
    .replace(/(\w)'(\w)/g, "$1’$2")
    .replace(/(^|[\s(\[—–-])'/g, "$1‘").replace(/'/g, "’")
    .replace(/(^|[\s(\[—–-])"/g, "$1“").replace(/"/g, "”")
    .replace(/ -- /g, " – ").replace(/\.\.\./g, "…");
}

const slugify = s => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── markdown to the theme's HTML ────────────────────────────────────────────
function render(study, file, dir) {
  const marked = new Marked({ gfm: true });
  const used = new Set();
  // Only a paragraph that opens the body is the lede; one after a heading is prose.
  let first = !/^\s*#/.test(study.body);
  marked.use({
    walkTokens(t) { if (t.type === "text" && !t.tokens) t.text = smart(t.text); },
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        if (depth === 1) { problem(file, 0, "use ## for sections: the title comes from the frontmatter"); }
        let id = slugify(text.replace(/<[^>]+>/g, "")) || "section";
        while (used.has(id)) id += "-2";
        used.add(id);
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      paragraph({ tokens }) {
        // An image on its own line is a figure; its title, if any, is the caption.
        if (tokens.length === 1 && tokens[0].type === "image") {
          const img = tokens[0];
          checkAsset(img.href, file, dir);
          const cap = img.title ? `<figcaption>${new Marked().parseInline(smart(img.title))}</figcaption>` : "";
          return `<figure><img src="${esc(img.href)}" alt="${esc(img.text)}" loading="lazy" />${cap}</figure>\n`;
        }
        const cls = first ? ' class="lede"' : "";
        first = false;
        return `<p${cls}>${this.parser.parseInline(tokens)}</p>\n`;
      },
      image({ href, text }) { checkAsset(href, file, dir); return `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy" />`; },
      link({ href, tokens }) {
        if (!/^(https?:|mailto:|#)/.test(href)) checkAsset(href, file, dir);
        return `<a href="${esc(href)}">${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  return marked.parse(study.body);
}

function checkAsset(href, file, dir) {
  if (/^(https?:|mailto:|data:|#)/.test(href)) return;
  if (!dir) { problem(file, 0, `"${href}": a single-file study can't carry files; make it a folder`); return; }
  const target = path.join(dir, decodeURI(href.split("#")[0]));
  if (!target.startsWith(dir) || !fs.existsSync(target)) problem(file, 0, `"${href}" doesn't exist next to the study`);
}

// ── pages ───────────────────────────────────────────────────────────────────
const month = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function accentStyle(meta) {
  if (!meta.accent) return "";
  return `<style>:root{--accent:${meta.accent}}:root[data-theme="dark"]{--accent:${meta.accent_dark}}` +
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--accent:${meta.accent_dark}}}</style>\n`;
}

function page({ title, description, rel, current, body, meta = {}, canonical, image }) {
  const nav = [`<a href="${rel}index.html"${current === "home" ? ' aria-current="page"' : ""}>Case studies</a>`,
    ...site.links.map(l => `<a href="${esc(l.url)}">${esc(l.label)}</a>`)].join("");
  const og = [
    `<meta property="og:type" content="${current === "home" ? "website" : "article"}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    canonical ? `<meta property="og:url" content="${esc(canonical)}" />` : "",
    image ? `<meta property="og:image" content="${esc(image)}" />` : "",
  ].filter(Boolean).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
${og}
<link rel="icon" href="${rel}theme/favicon.svg" type="image/svg+xml" />
<link rel="preload" href="${rel}theme/fonts/space-grotesk.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="${rel}theme/fonts/archivo.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="${rel}theme/style.css" />
<link rel="stylesheet" href="${rel}theme/extra.css" />
${accentStyle(meta)}<script src="${rel}theme/theme.js"></script>
<script src="${rel}theme/site.js" defer></script>
</head>
<body>
<header class="site" id="top"><a class="mark" href="${rel}index.html">${esc(site.title)}</a><nav aria-label="Site">${nav}</nav><button type="button" class="theme" id="theme" aria-label="Switch to dark mode" hidden>Dark</button></header>
<div class="pinbar" id="pinbar"><span class="pin-where">${esc(title)}</span><button type="button" class="pin-theme" data-theme-toggle aria-label="Switch to dark mode" hidden>Dark</button><a class="pin-top" href="#top">Top</a><span class="pin-line" aria-hidden="true"><span class="pin-fill"></span></span></div>
<main>
${body}
</main>
<footer class="site"><nav aria-label="Site, end of page">${nav}<a class="foot-top" href="#top">Top</a></nav></footer>
</body>
</html>
`;
}

// ── collect, check, build ───────────────────────────────────────────────────
const studiesDir = path.join(ROOT, "studies");
const studies = [];
for (const name of fs.existsSync(studiesDir) ? fs.readdirSync(studiesDir).sort() : []) {
  const full = path.join(studiesDir, name);
  let file, dir = null, slug;
  if (fs.statSync(full).isDirectory()) { dir = full; file = path.join(full, "index.md"); slug = name; if (!fs.existsSync(file)) { problem(full, 0, "a study folder needs an index.md"); continue; } }
  else if (name.endsWith(".md")) { file = full; slug = name.slice(0, -3); }
  else continue;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) problem(full, 0, `"${slug}": name it in lowercase letters, digits and hyphens`);
  const s = readStudy(file);
  if (!s) continue;
  if (s.meta.image) checkAsset(s.meta.image, file, dir);
  studies.push({ ...s, file, dir, slug });
}
const live = studies.filter(s => s.meta.status === "published" || DRAFTS);
for (const s of live) if (!s.meta.link) s.html = render(s, s.file, s.dir);

if (problems.length) {
  console.error(`${problems.length} problem(s); nothing was built:\n\n  ` + problems.join("\n  ") + "\n");
  process.exit(1);
}
console.log(`ok: ${studies.length} stud${studies.length === 1 ? "y" : "ies"} (${live.length} to build${DRAFTS ? ", drafts included" : ""})`);
if (CHECK) process.exit(0);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(THEME, path.join(OUT, "theme"), { recursive: true });

for (const s of live.filter(s => !s.meta.link)) {
  const outDir = path.join(OUT, s.slug);
  if (s.dir) fs.cpSync(s.dir, outDir, { recursive: true, filter: src => !src.endsWith("index.md") });
  else fs.mkdirSync(outDir, { recursive: true });
  const kicker = s.meta.kicker || `Case study · ${site.author} · ${month(s.meta.date)}`;
  // A body that opens on a section gets the description as its lede, as a standfirst.
  const lede = /^<h[23]/.test(s.html) ? `<p class="lede">${esc(smart(s.meta.description))}</p>\n` : "";
  const body = `<p class="kicker">${esc(smart(kicker))}</p>\n<h1>${esc(smart(s.meta.title))}</h1>\n${lede}${s.html}`;
  const canonical = site.url ? `${site.url}/${s.slug}/` : "";
  const image = site.url && s.meta.image ? `${site.url}/${s.slug}/${s.meta.image}` : "";
  fs.writeFileSync(path.join(outDir, "index.html"),
    page({ title: smart(s.meta.title), description: smart(s.meta.description), rel: "../", current: s.slug, body, meta: s.meta, canonical, image }));
}

// The front page: an optional intro from index.md, then every study, newest first.
const introFile = path.join(ROOT, "index.md");
const intro = fs.existsSync(introFile) ? new Marked({ gfm: true }).parse(smart(fs.readFileSync(introFile, "utf8"))) : "";
const items = live.slice().sort((a, b) => b.meta.date.localeCompare(a.meta.date)).map(s => {
  const href = s.meta.link || `${s.slug}/index.html`;
  const draft = s.meta.status === "draft" ? ' <span class="draft">draft</span>' : "";
  const tint = s.meta.accent ? ` style="--card-light:${s.meta.accent};--card-dark:${s.meta.accent_dark}"` : "";
  return `<li${tint}><a class="study" href="${esc(href)}"><span class="study-title">${esc(smart(s.meta.title))}</span>` +
    `<span class="study-meta">${esc(month(s.meta.date))}${s.meta.link ? " · its own site" : ""}</span>` +
    `<span class="study-desc">${esc(smart(s.meta.description))}</span></a>${draft}</li>`;
}).join("\n");
const home = `<p class="kicker">${esc(site.author)}</p>\n<h1>${esc(smart(site.title))}</h1>\n${intro}\n<ul class="studies">\n${items}\n</ul>`;
fs.writeFileSync(path.join(OUT, "index.html"),
  page({ title: smart(site.title), description: smart(site.description), rel: "", current: "home", body: home, canonical: site.url ? site.url + "/" : "" }));
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
console.log(`built: ${path.relative(ROOT, OUT)}/`);

if (SERVE) {
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };
  http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(OUT, p);
    if (!f.startsWith(OUT) || !fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  }).listen(8000, () => console.log("preview: http://localhost:8000"));
}
