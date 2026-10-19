import "./setup-data-root.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { downloadAllCraftEssences } from "../src/download-ces.js";

test("craft essence image failures reject the update instead of reporting success", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).endsWith("basic_equip.json")) {
      return Response.json([{ id: 1, collectionNo: 1, face: "https://example.com/Faces/1.png" }]);
    }
    return new Response("unavailable", { status: 503 });
  });
  await assert.rejects(downloadAllCraftEssences(), /1 JP craft essence downloads failed/);
});
