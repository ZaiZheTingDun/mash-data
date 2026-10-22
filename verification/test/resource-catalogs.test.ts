import assert from "node:assert/strict";
import test from "node:test";
import { buildEventItemResources, buildEventResources } from "../../shared/catalog-builders.ts";
import { formatResourceJson } from "../../shared/resource-json.ts";

const item = (id: number, name: string) => ({
  id, type: "eventItem" as const, name, detail: "excluded", background: "gold", icon: "icons/items/10.png",
});
const event = (id: number, name: string) => ({
  id, type: "eventQuest", name, noticeAt: 0, startedAt: 10, endedAt: 20, finishedAt: 30, warIds: [9001],
});

test("item resources merge by ID using JP metadata and CN names without descriptions", () => {
  const input = { schemaVersion: 1 as const, regions: {
    JP: [item(2, "JP 2"), { ...item(1, "JP 1"), icon: null, missingIcon: "https://static.atlasacademy.io/JP/Items/10.png" }],
    CN: [{ ...item(1, "CN 1"), background: "silver" }, item(3, "CN only")],
  } };
  const before = JSON.stringify(input);
  const result = buildEventItemResources(input);
  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(result.items, [
    { id: 1, type: "eventItem", name: "JP 1", nameCN: "CN 1", background: "gold", icon: null,
      missingIcon: "https://static.atlasacademy.io/JP/Items/10.png" },
    { id: 2, type: "eventItem", name: "JP 2", nameCN: null, background: "gold", icon: "icons/items/10.png" },
    { id: 3, type: "eventItem", name: "CN only", nameCN: "CN only", background: "gold", icon: "icons/items/10.png" },
  ]);
  assert.equal(JSON.stringify(input), before);
});

test("event resources preserve regional dates, CN-only events and differing metadata", () => {
  const input = { schemaVersion: 1 as const, regions: {
    JP: [event(2, "JP only"), event(1, "JP")],
    CN: [{ ...event(1, "CN"), type: "loginCampaignStrict", startedAt: 100, warIds: [] }, event(3, "CN only")],
  } };
  const before = JSON.stringify(input);
  const result = buildEventResources(input);
  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(result.events.map(({ id }) => id), [1, 2, 3]);
  assert.deepEqual(result.events[0], {
    id: 1, type: "eventQuest", name: "JP", nameCN: "CN", warIds: [9001],
    JP: { noticeAt: 0, startedAt: 10, endedAt: 20, finishedAt: 30 },
    CN: { noticeAt: 0, startedAt: 100, endedAt: 20, finishedAt: 30, type: "loginCampaignStrict", warIds: [] },
  });
  assert.equal(result.events[1]?.nameCN, null);
  assert.equal(result.events[1]?.CN, null);
  assert.equal(result.events[2]?.JP, null);
  assert.equal(result.events[2]?.name, "CN only");
  assert.equal(result.events[2]?.nameCN, "CN only");
  assert.equal(JSON.stringify(input), before);
  const text = formatResourceJson(result);
  const rows = text.split("\n").filter((line) => /^\s*\{"/.test(line));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((line) => JSON.parse(line.replace(/,$/, ""))), result.events);
});
