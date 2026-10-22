import "./setup-data-root.ts";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildEventItemsCatalog, downloadEventItems, EVENT_ITEM_TYPES } from "../src/download-event-items.js";
import { DownloadHttpError } from "../src/fs-utils.js";

const item = (id: number, region = "JP", type = "eventItem", iconId = id) => ({
  id, type, name: `${region} ${id}`, detail: `${region} description`, background: "gold",
  icon: `https://static.atlasacademy.io/${region}/Items/${iconId}.png`, upstreamExtra: "excluded",
});

test("keeps all five categories and regional text while sharing reused icon filenames", () => {
  const catalog = buildEventItemsCatalog({
    JP: [...EVENT_ITEM_TYPES.map((type, i) => item(i + 1, "JP", type, 10)), item(99, "JP", "qp")].reverse(),
    CN: [item(1, "CN", "eventItem", 10)],
  });
  assert.deepEqual(catalog.regions.JP.map(i => i.type), EVENT_ITEM_TYPES);
  assert.deepEqual(catalog.regions.CN[0], {
    id: 1, type: "eventItem", name: "CN 1", detail: "CN description", background: "gold", icon: "icons/items/10.png",
  });
  assert.ok(catalog.regions.JP.every(i => i.icon === catalog.regions.CN[0]?.icon));
  assert.throws(() => buildEventItemsCatalog({ JP: [item(1), item(1)], CN: [item(1, "CN")] }), /Invalid JP event item/);
  for (const icon of ["https://example.com/1.png", "https://static.atlasacademy.io/JP/Items/../1.png"]) {
    assert.throws(() => buildEventItemsCatalog({ JP: [{ ...item(1), icon }], CN: [item(1, "CN")] }), /Invalid JP event item/);
  }
});

test("downloads only JP icons once and skips existing images on subsequent metadata refresh", async t => {
  const root = await mkdtemp(join(tmpdir(), "event-items-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "items.json");
  const urls: string[] = [];
  let cnName = "国服名称";
  const options = {
    output, iconsDir: join(root, "icons"),
    fetcher: async (region: "JP" | "CN") => region === "JP"
      ? [item(1, "JP", "eventItem", 10), item(2, "JP", "eventPoint", 10)]
      : [{ ...item(1, "CN", "eventItem", 10), name: cnName }],
    downloader: async (url: string, path: string) => { urls.push(url); await writeFile(path, "image"); },
  };
  await downloadEventItems(options);
  assert.deepEqual(urls, ["https://static.atlasacademy.io/JP/Items/10.png"]);
  assert.deepEqual(await readdir(options.iconsDir), ["10.png"]);
  cnName = "更新后的名称";
  await downloadEventItems(options);
  assert.equal(urls.length, 1);
  const published = JSON.parse(await readFile(output, "utf8"));
  assert.equal(published.schemaVersion, 2);
  assert.equal(published.items[0].nameCN, cnName);
  assert.equal(published.items[0].detail, undefined);
});

test("failed or empty downloads leave no final or partial icon and preserve the old catalog", async t => {
  const root = await mkdtemp(join(tmpdir(), "event-items-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "items.json");
  const iconsDir = join(root, "icons");
  await writeFile(output, "old catalog");
  const fetcher = async () => [item(1)];
  for (const fail of [true, false]) {
    await assert.rejects(downloadEventItems({ output, iconsDir, fetcher,
      downloader: async (_url, path) => {
        await writeFile(path, fail ? "partial" : "");
        if (fail) throw new Error("interrupted");
      },
    }), /1 event item icon downloads failed/);
    assert.equal(await readFile(output, "utf8"), "old catalog");
    assert.deepEqual(await readdir(iconsDir), []);
  }
  for (const badIndex of [[], [item(1, "JP", "qp")], [{ ...item(1), name: "" }]]) {
    await assert.rejects(downloadEventItems({ output, iconsDir, fetcher: async () => badIndex }));
    assert.equal(await readFile(output, "utf8"), "old catalog");
  }
  await assert.rejects(downloadEventItems({ output, iconsDir, fetcher,
    downloader: async url => { throw new DownloadHttpError(url, 503, "Service Unavailable"); },
  }), /1 event item icon downloads failed/);
  assert.equal(await readFile(output, "utf8"), "old catalog");
});

test("upstream 404 keeps both region records with an explicit missing icon and retries next run", async t => {
  const root = await mkdtemp(join(tmpdir(), "event-items-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = {
    output: join(root, "items.json"), iconsDir: join(root, "icons"),
    fetcher: async (region: "JP" | "CN") => [item(1, region)],
  };
  let catalog = await downloadEventItems({ ...options, downloader: async url => {
    throw new DownloadHttpError(url, 404, "Not Found");
  } });
  for (const region of ["JP", "CN"] as const) {
    assert.equal(catalog.regions[region][0]?.icon, null);
    assert.equal(catalog.regions[region][0]?.missingIcon, "https://static.atlasacademy.io/JP/Items/1.png");
  }
  assert.deepEqual(await readdir(options.iconsDir), []);
  catalog = await downloadEventItems({ ...options, downloader: async (_url, path) => { await writeFile(path, "image"); } });
  assert.equal(catalog.regions.JP[0]?.icon, "icons/items/1.png");
  assert.equal(catalog.regions.JP[0]?.missingIcon, undefined);
});
