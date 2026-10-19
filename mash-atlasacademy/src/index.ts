import { requireDataRoot } from "../../shared/data-paths.ts";
import { downloadAllCraftEssences } from "./download-ces.js";
import { downloadAllServants } from "./download-servants.js";

async function main(): Promise<void> {
  requireDataRoot();
  await downloadAllServants();
  await downloadAllCraftEssences();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
