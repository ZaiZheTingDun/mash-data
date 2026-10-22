import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const names = ["servants.json", "servants_variants.json", "servants_variants_cn.json", "craft_essences.json", "events.json", "event_items.json"];

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
}

test("catalogs:generate creates all six catalogs from source data without existing summaries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mash-catalog-command-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const region of ["JP", "CN"]) {
    const servantName = region === "JP" ? "servant.json" : "servant-cn.json";
    await writeJson(join(root, "assets/servants/1", servantName), {
      id: 100, collectionNo: 1, name: `${region} servant`, rarity: 5, skills: [], noblePhantasms: [],
      extraAssets: { charaGraph: { ascension: { "1": "face" } } },
    });
    const ceName = region === "JP" ? "craft-essence-raw.json" : "craft-essence-cn-raw.json";
    await writeJson(join(root, "assets/ces/1", ceName), {
      id: 200, collectionNo: 1, name: `${region} CE`, rarity: 5, skills: [], profile: {}, extraAssets: {},
    });
    await writeJson(join(root, `state/atlas-events-${region.toLowerCase()}.json`), [{
      id: 10, type: "eventQuest", name: `${region} event`, noticeAt: 0,
      startedAt: region === "JP" ? 1 : 10, endedAt: 20, finishedAt: 30, warIds: [],
    }]);
  }
  await mkdir(join(root, "assets/icons/items"), { recursive: true });
  await writeFile(join(root, "assets/icons/items/1.png"), "cached icon");
  const mock = join(root, "mock-atlas.mjs");
  // Stub only the two item exports; unexpected network requests fail the test.
  await writeFile(mock, `
    import { appendFileSync } from "node:fs";
    globalThis.fetch = async (input) => {
      const url = String(input);
      const parsed = new URL(url);
      const region = parsed.pathname.split("/")[2];
      if (parsed.origin !== "https://api.atlasacademy.io" || !["JP", "CN"].includes(region)
          || parsed.pathname !== "/export/" + region + "/nice_item.json") throw new Error("Unexpected fetch: " + url);
      appendFileSync(new URL("./requests.txt", import.meta.url), region + "\\n");
      return new Response(JSON.stringify([{
        id: 1, type: "eventItem", name: region + " item", detail: "omit",
        background: "gold", icon: "https://static.atlasacademy.io/" + region + "/Items/1.png"
      }]));
    };
  `);
  await assert.rejects(access(join(root, "assets/catalogs")), { code: "ENOENT" });
  await execFileAsync("npm", ["run", "catalogs:generate"], {
    cwd: repoRoot,
    env: { ...process.env, MASH_DATA_ROOT: root, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(mock).href}` },
  });
  const outputs: Record<string, any> = {};
  for (const name of names) {
    const text = await readFile(join(root, "assets/catalogs", name), "utf8");
    const data = JSON.parse(text);
    outputs[name] = data;
    const records = Array.isArray(data) ? data : data.events ?? data.items;
    assert.equal(records.length, 1, name);
    assert.equal(text.split("\n").filter((line) => /^\s*\{"/.test(line)).length, 1, name);
  }
  assert.equal(outputs["servants.json"][0].nameCN, "CN servant");
  for (const name of ["servants_variants.json", "servants_variants_cn.json"]) {
    assert.equal(outputs[name][0].id, 1);
    assert.deepEqual(outputs[name][0].variants[0].ids, [1]);
  }
  assert.equal(outputs["craft_essences.json"][0].name_cn, "CN CE");
  assert.equal(outputs["events.json"].events[0].CN.startedAt, 10);
  assert.equal(outputs["event_items.json"].items[0].nameCN, "CN item");
  assert.equal(outputs["event_items.json"].items[0].detail, undefined);
  assert.deepEqual((await readFile(join(root, "requests.txt"), "utf8")).trim().split("\n").sort(), ["CN", "JP"]);
  await assert.rejects(access(join(root, "resources")), { code: "ENOENT" });
});
