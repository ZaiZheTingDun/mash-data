import "./setup-data-root.ts";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectAllSkillIconUrls } from "../src/download-skill-icons.js";

test("includes the fifth append icon when compact skill data has no append passives", async () => {
  const root = await mkdtemp(join(tmpdir(), "mash-append-icons-"));
  try {
    const servantsDir = join(root, "servants");
    const mysticCodesDir = join(root, "mystic-codes");
    await mkdir(join(servantsDir, "1"), { recursive: true });
    await mkdir(join(mysticCodesDir, "1"), { recursive: true });
    const existing = "https://static.atlasacademy.io/JP/SkillIcons/skill_00601.png";
    const active = "https://static.atlasacademy.io/JP/SkillIcons/skill_00304.png";
    await writeFile(join(servantsDir, "1", "servant.json"), JSON.stringify({ skills: [{ icon: existing }] }));
    await writeFile(join(mysticCodesDir, "1", "mystic-code.json"), JSON.stringify({ skills: [{ icon: active }] }));

    const urls = await collectAllSkillIconUrls(servantsDir, mysticCodesDir);
    for (const filename of ["skill_00301.png", "skill_00601.png", "skill_00300.png", "skill_00303.png", "skill_00613.png"]) {
      assert.ok(urls.includes(`https://static.atlasacademy.io/JP/SkillIcons/${filename}`));
    }
    assert.ok(urls.includes(active));
    assert.equal(urls.filter(url => url === existing).length, 1);
    assert.deepEqual(urls, [...urls].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retains all required append icons before servant assets have been downloaded", async () => {
  const root = await mkdtemp(join(tmpdir(), "mash-required-icons-"));
  try {
    const urls = await collectAllSkillIconUrls(join(root, "absent-servants"), join(root, "absent-mystic-codes"));
    assert.equal(urls.length, 5);
    assert.ok(urls.includes("https://static.atlasacademy.io/JP/SkillIcons/skill_00613.png"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
