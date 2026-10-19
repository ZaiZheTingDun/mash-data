import { requireDataRoot } from "../../shared/data-paths.ts";
import {
  fetchBasicServants,
  fetchChangeLog,
  fetchDataVersions,
} from "./api.js";
import { runWithConcurrency } from "./concurrency.js";
import {
  downloadServantImages,
  downloadServantJson,
} from "./downloader.js";
import { DATA_VERSION_FILE } from "./paths.js";
import {
  buildServantDependencyIndex,
  collectChangedServantIds,
  inspectServantCache,
  normalizeDataVersion,
  parseChangeLog,
  readDataVersions,
  selectChangeRange,
  writeDataVersions,
  type ServantCacheInspection,
} from "./servant-updates.js";
import type {
  AtlasDataVersion,
  AtlasDataVersions,
  BasicServant,
  Region,
} from "./types.js";

const SERVANT_CONCURRENCY = 3;
const SERVANT_DELAY_MS = 300;

export interface ServantDownloadDependencies {
  fetchVersions: () => Promise<AtlasDataVersions>;
  fetchBasic: (region: Region) => Promise<BasicServant[]>;
  fetchChanges: (region: Region) => Promise<string>;
  inspectCache: (
    region: Region,
    collectionNos: number[],
  ) => Promise<ServantCacheInspection>;
  downloadJson: (
    region: Region,
    collectionNo: number,
    forceRefresh: boolean,
  ) => Promise<"downloaded" | "skipped">;
  downloadImages: (collectionNo: number) => Promise<number>;
  readVersions: (filePath: string) => Promise<AtlasDataVersions>;
  writeVersions: (
    versions: AtlasDataVersions,
    filePath: string,
  ) => Promise<void>;
}

export interface DownloadAllServantsOptions {
  dataVersionFile?: string;
  dependencies?: Partial<ServantDownloadDependencies>;
}

interface RegionUpdateSummary {
  region: Region;
  previousHash: string | undefined;
  targetHash: string;
  mode: "unchanged" | "incremental" | "full";
  changeRecords: number;
  direct: number;
  dependency: number;
  missing: number;
  invalid: number;
  refreshed: number;
  failed: number;
  unassociatedEntities: number;
  imagesDownloaded: number;
  imagesFailed: number;
}

const DEFAULT_DEPENDENCIES: ServantDownloadDependencies = {
  fetchVersions: fetchDataVersions,
  fetchBasic: fetchBasicServants,
  fetchChanges: fetchChangeLog,
  inspectCache: inspectServantCache,
  downloadJson: downloadServantJson,
  downloadImages: downloadServantImages,
  readVersions: readDataVersions,
  writeVersions: writeDataVersions,
};

export async function downloadAllServants(
  options: DownloadAllServantsOptions = {},
): Promise<void> {
  const dataVersionFile = options.dataVersionFile ?? DATA_VERSION_FILE;
  const dependencies: ServantDownloadDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...options.dependencies,
  };
  const remoteVersions = await dependencies.fetchVersions();
  const localVersions = await dependencies.readVersions(dataVersionFile);
  const failures: string[] = [];

  for (const region of ["JP", "CN"] as const) {
    const targetVersion = normalizeDataVersion(remoteVersions[region]);
    if (!targetVersion) {
      failures.push(`${region}: /info did not return a valid data version`);
      continue;
    }

    try {
      const summary = await updateRegion(
        region,
        localVersions[region],
        targetVersion,
        dependencies,
      );
      localVersions[region] = targetVersion;
      await dependencies.writeVersions(localVersions, dataVersionFile);
      logRegionSummary(summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${region}: ${message}`);
      console.error(
        `[${region} servants] Update failed; previous=${localVersions[region]?.hash ?? "none"} ` +
          `target=${targetVersion.hash}; cursor not advanced:`,
        error,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`Servant updates failed:\n${failures.join("\n")}`);
  }
}

async function updateRegion(
  region: Region,
  previousVersion: AtlasDataVersion | undefined,
  targetVersion: AtlasDataVersion,
  dependencies: ServantDownloadDependencies,
): Promise<RegionUpdateSummary> {
  console.log(`Fetching ${region} basic servant list...`);
  const basicServants = await dependencies.fetchBasic(region);
  const collectionNos = [
    ...new Set(
      basicServants
        .map((servant) => servant.collectionNo)
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ].sort((a, b) => a - b);
  if (collectionNos.length === 0) {
    throw new Error("basic servant list contains no collection servants");
  }
  const currentCollectionNos = new Set(collectionNos);
  const cache = await dependencies.inspectCache(region, collectionNos);
  const dependencyIndex = buildServantDependencyIndex(cache.valid);
  const direct = new Set<number>();
  const dependency = new Set<number>();
  let mode: RegionUpdateSummary["mode"] = "unchanged";
  let changeRecords = 0;
  let unassociatedEntities = 0;

  if (!previousVersion) {
    mode = "full";
    for (const collectionNo of collectionNos) direct.add(collectionNo);
    console.warn(
      `[${region} servants] No valid local cursor; using a full JSON refresh.`,
    );
  } else if (!hashesEqual(previousVersion.hash, targetVersion.hash)) {
    const records = parseChangeLog(await dependencies.fetchChanges(region));
    const range = selectChangeRange(
      records,
      previousVersion.hash,
      targetVersion.hash,
      region,
    );
    mode = range.mode;
    changeRecords = range.records.length;

    if (range.mode === "full") {
      for (const collectionNo of collectionNos) direct.add(collectionNo);
      console.warn(
        `[${region} servants] ${range.reason}; using a full JSON refresh.`,
      );
    } else {
      const changed = collectChangedServantIds(
        range.records,
        dependencyIndex,
        currentCollectionNos,
      );
      for (const collectionNo of changed.direct) direct.add(collectionNo);
      for (const collectionNo of changed.dependency) {
        dependency.add(collectionNo);
      }
      unassociatedEntities = changed.unassociatedEntities;
    }
  }

  const refreshIds = new Set<number>([...direct, ...dependency]);
  for (const collectionNo of cache.missing) refreshIds.add(collectionNo);
  for (const collectionNo of cache.invalid) refreshIds.add(collectionNo);

  let refreshed = 0;
  let failed = 0;
  const failedIds = new Set<number>();
  const failureDetails: string[] = [];
  await runWithConcurrency(
    [...refreshIds].sort((a, b) => a - b),
    SERVANT_CONCURRENCY,
    SERVANT_DELAY_MS,
    async (collectionNo) => {
      const forceRefresh =
        direct.has(collectionNo) ||
        dependency.has(collectionNo) ||
        cache.invalid.has(collectionNo);
      try {
        await dependencies.downloadJson(region, collectionNo, forceRefresh);
        refreshed += 1;
      } catch (error) {
        failed += 1;
        failedIds.add(collectionNo);
        failureDetails.push(
          `${collectionNo}: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.error(
          `[${region} servant ${collectionNo}] JSON update failed:`,
          error,
        );
      }
    },
  );

  if (failed > 0) {
    logRegionSummary({
      region,
      previousHash: previousVersion?.hash,
      targetHash: targetVersion.hash,
      mode,
      changeRecords,
      direct: direct.size,
      dependency: dependency.size,
      missing: cache.missing.size,
      invalid: cache.invalid.size,
      refreshed,
      failed,
      unassociatedEntities,
      imagesDownloaded: 0,
      imagesFailed: 0,
    });
    throw new Error(
      `${failed} planned servant JSON downloads failed (${[...failedIds].sort((a, b) => a - b).join(", ")}): ${failureDetails.join("; ")}`,
    );
  }

  let imagesDownloaded = 0;
  let imagesFailed = 0;
  if (region === "JP") {
    await runWithConcurrency(
      collectionNos,
      SERVANT_CONCURRENCY,
      SERVANT_DELAY_MS,
      async (collectionNo) => {
        try {
          imagesDownloaded += await dependencies.downloadImages(collectionNo);
        } catch (error) {
          imagesFailed += 1;
          console.error(`[servant ${collectionNo}] Image update failed:`, error);
        }
      },
    );
  }

  return {
    region,
    previousHash: previousVersion?.hash,
    targetHash: targetVersion.hash,
    mode,
    changeRecords,
    direct: direct.size,
    dependency: dependency.size,
    missing: cache.missing.size,
    invalid: cache.invalid.size,
    refreshed,
    failed,
    unassociatedEntities,
    imagesDownloaded,
    imagesFailed,
  };
}

function hashesEqual(left: string, right: string): boolean {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function logRegionSummary(summary: RegionUpdateSummary): void {
  console.log(
    `${summary.region} servants done. previous=${summary.previousHash ?? "none"} ` +
      `target=${summary.targetHash} mode=${summary.mode} records=${summary.changeRecords} ` +
      `direct=${summary.direct} dependency=${summary.dependency} missing=${summary.missing} ` +
      `invalid=${summary.invalid} refreshed=${summary.refreshed} failed=${summary.failed} ` +
      `unassociated=${summary.unassociatedEntities} imagesDownloaded=${summary.imagesDownloaded} ` +
      `imagesFailed=${summary.imagesFailed}`,
  );
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  requireDataRoot();
  downloadAllServants().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
