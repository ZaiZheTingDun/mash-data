import "./setup-data-root.ts";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildEventCatalog, combineEvents } from "../src/combine-events.js";
import { writeJsonAtomic } from "../src/fs-utils.js";

const event = (id: number, name: string) => ({
  id, type: "eventQuest", name, noticeAt: 0, startedAt: 10,
  endedAt: 20, finishedAt: 30, materialOpenedAt: 999, warIds: [9001],
  upstreamExtra: "not published",
});

test("catalog preserves each region and source dates, sorts IDs, and selects directory fields", () => {
  const catalog = buildEventCatalog({ JP: [event(2, "JP 2"), event(1, "JP 1")], CN: [event(1, "CN 1")] });
  assert.equal(catalog.schemaVersion, 1);
  assert.deepEqual(catalog.regions.JP.map(({ id }) => id), [1, 2]);
  assert.equal(catalog.regions.CN[0]?.name, "CN 1");
  assert.deepEqual(catalog.regions.JP[0], {
    id: 1, type: "eventQuest", name: "JP 1", noticeAt: 0,
    startedAt: 10, endedAt: 20, finishedAt: 30, warIds: [9001],
  });
});

test("invalid or missing region cache cannot replace the published catalog", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "event-catalog-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = { JP: join(root, "jp.json"), CN: join(root, "cn.json") };
  const output = join(root, "catalog.json");
  await writeJsonAtomic(files.JP, [event(1, "JP")]);
  await writeJsonAtomic(files.CN, [event(1, "CN")]);
  await combineEvents({ eventIndexFiles: files, output });
  const before = await readFile(output, "utf8");
  const published = JSON.parse(before);
  assert.equal(published.schemaVersion, 2);
  assert.equal(published.events[0].nameCN, "CN");
  assert.equal(published.events[0].JP.startedAt, 10);
  await writeJsonAtomic(files.CN, [{ ...event(1, "CN"), warIds: [0] }]);
  await assert.rejects(combineEvents({ eventIndexFiles: files, output }), /Invalid CN event index entry/);
  assert.equal(await readFile(output, "utf8"), before);
  assert.throws(() => buildEventCatalog({ JP: [], CN: [event(1, "CN")] }), /JP event index is missing or empty/);
  assert.throws(() => buildEventCatalog({ JP: [event(1, "A"), event(1, "B")], CN: [event(1, "CN")] }), /Invalid JP event index entry/);
});
