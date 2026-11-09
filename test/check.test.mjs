/* The check is the only thing between a push and the live site, so it is tested
   like code: each case writes a throwaway site with one thing wrong and expects
   the build to refuse it, naming the problem. A check that passes everything
   would look exactly like a check that works, until the day it mattered. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build.mjs");
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
  "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

const GOOD = `---
title: A study
description: What it was and what it showed.
date: 2026-11-09
status: published
---

## First

Some text, and a figure:

![What it shows.](img/a.png "The caption.")
`;

function site(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-test-"));
  const all = { "site.json": JSON.stringify({ title: "T", author: "A", description: "D" }), ...files };
  for (const [name, body] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

function check(files, extra = []) {
  const dir = site(files);
  const r = spawnSync(process.execPath, [BUILD, "--check", "--root", dir, ...extra], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr };
}

const withImage = body => ({ "studies/s/index.md": body, "studies/s/img/a.png": PNG });

test("a correct study passes", () => {
  const r = check(withImage(GOOD));
  assert.equal(r.code, 0, r.out);
});

const refused = [
  ["no frontmatter", { "studies/s/index.md": "just text\n" }, "no frontmatter"],
  ["a misspelt field", withImage(GOOD.replace("status:", "staus:")), 'unknown field "staus"'],
  ["a missing required field", withImage(GOOD.replace(/^title: .*\n/m, "")), '"title" is missing'],
  ["a date in the wrong form", withImage(GOOD.replace("2026-11-09", "9 Nov 2026")), "YYYY-MM-DD"],
  ["an unknown status", withImage(GOOD.replace("status: published", "status: live")), '"published" or "draft"'],
  ["an image that isn't there", { "studies/s/index.md": GOOD }, '"img/a.png" doesn\'t exist'],
  ["an accent without its dark twin", withImage(GOOD.replace("status: published", 'status: published\naccent: "#1e6b45"')), "accent and accent_dark together"],
  ["an accent that isn't a colour", withImage(GOOD.replace("status: published", "status: published\naccent: green\naccent_dark: \"#6fcf97\"")), "a colour like"],
  ["a title written as a heading", withImage(GOOD.replace("## First", "# First")), "use ## for sections"],
  ["a folder name that won't make an address", { "studies/My Study/index.md": GOOD, "studies/My Study/img/a.png": PNG }, "lowercase letters, digits and hyphens"],
  ["a linked study that also has text", { "studies/s.md": GOOD.replace("status: published", "status: published\nlink: https://example.org/") }, "points elsewhere"],
  ["a description too long for a preview", withImage(GOOD.replace("What it was and what it showed.", "x".repeat(230))), "under 220 characters"],
];

for (const [name, files, message] of refused) {
  test(`refuses ${name}`, () => {
    const r = check(files);
    assert.equal(r.code, 1, `expected a refusal:\n${r.out}`);
    assert.match(r.out, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), r.out);
    assert.match(r.out, /nothing was built/);
  });
}

test("a draft is checked but not counted as one to build", () => {
  const r = check(withImage(GOOD.replace("status: published", "status: draft")));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 study \(0 to build\)/);
});
