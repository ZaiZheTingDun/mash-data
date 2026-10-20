import { createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
  options: { arrayItemPerLine?: boolean } = {},
): Promise<void> {
  if (options.arrayItemPerLine && !Array.isArray(data)) throw new Error("Expected JSON array");
  const serialized = options.arrayItemPerLine
    ? `[\n${(data as unknown[]).map((item) => JSON.stringify(item)).join(",\n")}\n]`
    : JSON.stringify(data, null, 2);
  const dir = dirname(filePath);
  await ensureDir(dir);
  const tempPath = join(
    dir,
    `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    await writeFile(tempPath, serialized, "utf8");
    await rename(tempPath, filePath);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function downloadFile(url: string, destPath: string): Promise<void> {
  await ensureDir(dirname(destPath));

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to download ${url}: HTTP ${res.status} ${res.statusText}`,
    );
  }
  if (!res.body) {
    throw new Error(`No response body for ${url}`);
  }

  const nodeStream = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
  await pipeline(nodeStream, createWriteStream(destPath));
}
