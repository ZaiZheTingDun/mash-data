import "./setup-data-root.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { downloadAllCraftEssences } from "../src/download-ces.js";
import { equip } from "./fixtures/ces.js";

test("craft essence image failures reject the update instead of reporting success", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith("/info")) return Response.json({ JP: { hash: "aaa", timestamp: 1 }, CN: { hash: "aaa", timestamp: 1 } });
    if (path.endsWith("basic_event.json")) return Response.json([]);
    if (path.endsWith("basic_equip.json")) return Response.json([{ id: 9400001, collectionNo: 1 }]);
    if (path.includes("/equip/")) return Response.json(equip(1));
    return new Response("unavailable", { status: 503 });
  });
  await assert.rejects(downloadAllCraftEssences({ delayMs: 0 }), /1 JP craft essence downloads failed/);
});
