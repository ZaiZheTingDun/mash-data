import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export function getDataRoot(): string {
  const root = process.env.MASH_DATA_ROOT;
  if (!root?.trim()) throw new Error("MASH_DATA_ROOT is required");
  return resolve(root);
}

export function requireDataRoot(): string {
  const root = getDataRoot();
  const assets = join(root, "assets");
  if (!existsSync(assets) || !statSync(assets).isDirectory()) {
    throw new Error("MASH_DATA_ROOT must contain an assets directory");
  }
  return root;
}
