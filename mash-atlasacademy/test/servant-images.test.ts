import "./setup-data-root.ts";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { compactServant } from "../src/compact-servant.js";
import { downloadServantImages, loadOrFetchServant } from "../src/downloader.js";
import { DownloadHttpError } from "../src/fs-utils.js";
import type { NiceServant } from "../src/types.js";

const GROUPS = [
  ["commands", "card_servant"], ["faces", "face_servant"], ["narrowFigure", "narrow_servant"],
] as const;

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "mash-servant-images-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "486");
  await mkdir(dir);
  const raw: NiceServant = {
    id: 705500, collectionNo: 486, name: "松永久秀",
    profile: { costume: { "705530": { id: 1, battleCharaId: 705530, name: "costume" } } },
    extraAssets: {
      ...Object.fromEntries(GROUPS.map(([group]) => [group, {
        ascension: { "1": `https://example.com/${group}/1.png` },
        costume: { "705530": `https://example.com/${group}/11.png` },
      }])),
      charaGraph: { ascension: { "1": "graph-url" }, costume: { "705530": "costume-graph-url" } },
    },
  };
  const path = join(dir, "servant.json");
  const rawPath = join(dir, "servant-raw.json");
  await writeFile(path, JSON.stringify(compactServant(raw)));
  await writeFile(rawPath, JSON.stringify(raw));
  return { root, dir, raw, path, rawPath };
}

test("costume 404s remove only missing image references and recover without a data refresh", async (t) => {
  const { root, dir, raw, path, rawPath } = await fixture(t);
  const warnings: string[] = [];
  t.mock.method(console, "warn", (message: string) => { warnings.push(message); });
  let available = false;
  const requests: string[] = [];
  const downloader = async (url: string, dest: string) => {
    requests.push(url);
    if (url.endsWith("/11.png") && !available) throw new DownloadHttpError(url, 404, "Not Found");
    await writeFile(dest, "image");
  };
  assert.equal(await downloadServantImages(486, { servantsDir: root, downloader }), 3);
  const missing = JSON.parse(await readFile(path, "utf8")) as NiceServant;
  for (const [group, prefix] of GROUPS) {
    assert.deepEqual(missing.extraAssets?.[group]?.ascension, raw.extraAssets?.[group]?.ascension);
    assert.deepEqual(missing.extraAssets?.[group]?.costume, {});
    assert.deepEqual(missing.extraAssets?.[group]?.missingCostume, raw.extraAssets?.[group]?.costume);
    assert.ok(!(await readdir(dir)).includes(`${prefix}_705530.png`));
  }
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every(message => message.includes("will retry next update")));
  assert.deepEqual(missing.profile, raw.profile);
  assert.deepEqual(missing.extraAssets?.charaGraph, raw.extraAssets?.charaGraph);
  assert.deepEqual(compactServant(missing), missing);
  assert.equal(await readFile(rawPath, "utf8"), JSON.stringify(raw));

  // A second update must retry even when no JSON/data-version refresh is needed.
  const cached = await loadOrFetchServant("test", "JP", 486, path, {
    fetcher: async () => { throw new Error("must use cached JSON"); },
  });
  assert.equal(cached.refreshed, false);
  requests.length = 0;
  assert.equal(await downloadServantImages(486, { servantsDir: root, downloader }), 0);
  assert.equal(requests.length, 3);
  assert.equal(await readFile(path, "utf8"), JSON.stringify(missing, null, 2));

  available = true;
  requests.length = 0;
  assert.equal(await downloadServantImages(486, { servantsDir: root, downloader }), 3);
  assert.equal(requests.length, 3);
  const recovered = JSON.parse(await readFile(path, "utf8")) as NiceServant;
  assert.deepEqual(recovered, compactServant(raw));
  for (const [, prefix] of GROUPS) {
    assert.equal(await readFile(join(dir, `${prefix}_705530.png`), "utf8"), "image");
  }
  requests.length = 0;
  assert.equal(await downloadServantImages(486, { servantsDir: root, downloader }), 0);
  assert.deepEqual(requests, []);
  assert.equal(await readFile(rawPath, "utf8"), JSON.stringify(raw));
  assert.ok(!(await readdir(dir)).some(name => name.endsWith(".tmp")));
});

test("available costume images survive alongside an upstream 404", async (t) => {
  const { root, path } = await fixture(t);
  const data = JSON.parse(await readFile(path, "utf8")) as NiceServant;
  data.extraAssets!.commands!.costume!["705531"] = "https://example.com/commands/12.png";
  await writeFile(path, JSON.stringify(data));
  await downloadServantImages(486, { servantsDir: root, downloader: async (url, dest) => {
    if (url.endsWith("/11.png")) throw new DownloadHttpError(url, 404, "Not Found");
    await writeFile(dest, "image");
  } });
  const updated = JSON.parse(await readFile(path, "utf8")) as NiceServant;
  assert.deepEqual(updated.extraAssets?.commands?.costume, { "705531": "https://example.com/commands/12.png" });
});

test("ascension 404s remain fatal and leave no final or partial image", async (t) => {
  const { root, dir, path } = await fixture(t);
  const before = await readFile(path, "utf8");
  await assert.rejects(downloadServantImages(486, { servantsDir: root, downloader: async (url) => {
    throw new DownloadHttpError(url, 404, "Not Found");
  } }), /HTTP 404/);
  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual((await readdir(dir)).sort(), ["servant-raw.json", "servant.json"]);
});

for (const failure of ["403", "429", "500", "503", "network", "interrupted", "empty"]) {
  test(`costume ${failure} errors remain fatal and do not persist missing metadata or partial files`, async (t) => {
    const { root, dir, path } = await fixture(t);
    const before = await readFile(path, "utf8");
    await assert.rejects(downloadServantImages(486, { servantsDir: root, downloader: async (url, dest) => {
      if (!url.endsWith("/11.png")) { await writeFile(dest, "image"); return; }
      if (failure === "network") throw new Error("network failure");
      if (failure === "interrupted") { await writeFile(dest, "partial"); throw new Error("interrupted"); }
      if (failure === "empty") { await writeFile(dest, ""); return; }
      throw new DownloadHttpError(url, Number(failure), "test failure");
    } }), /HTTP|network failure|interrupted|Empty image download/);
    assert.equal(await readFile(path, "utf8"), before);
    assert.deepEqual((await readdir(dir)).sort(), ["card_servant_1.png", "servant-raw.json", "servant.json"]);
  });
}
