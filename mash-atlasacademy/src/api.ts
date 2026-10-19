import type {
  BasicEquip,
  BasicServant,
  AtlasDataVersions,
  NiceServant,
  NiceEquip,
  BasicEvent,
  Region,
} from "./types.js";

const API_BASE = "https://api.atlasacademy.io";
const ASSETS_BASE = "https://assets.atlasacademy.io";

export async function fetchDataVersions(): Promise<AtlasDataVersions> {
  return fetchJson<AtlasDataVersions>(`${API_BASE}/info`, "data version info");
}

export async function fetchChangeLog(region: Region): Promise<string> {
  return fetchText(
    `${ASSETS_BASE}/Changes/${region}.log`,
    `${region} change log`,
  );
}

export async function fetchServant(
  region: Region,
  servantId: number,
): Promise<NiceServant> {
  const url = `${API_BASE}/nice/${region}/servant/${servantId}?lore=true`;
  return fetchJson<NiceServant>(url, `${region} servant ${servantId}`);
}

export async function fetchSkill(
  region: Region,
  skillId: number,
): Promise<Record<string, unknown>> {
  const url = `${API_BASE}/nice/${region}/skill/${skillId}`;
  return fetchJson<Record<string, unknown>>(url, `${region} skill ${skillId}`);
}

export async function fetchBasicServants(
  region: Region,
): Promise<BasicServant[]> {
  const url = `${API_BASE}/export/${region}/basic_servant.json`;
  return fetchJson<BasicServant[]>(url, `${region} basic servant list`);
}

export async function fetchBasicCraftEssences(
  region: Region,
): Promise<BasicEquip[]> {
  const fileName = "basic_equip.json";
  const url = `${API_BASE}/export/${region}/${fileName}`;
  return fetchJson<BasicEquip[]>(
    url,
    `${region} basic craft essence list`,
  );
}

export async function fetchCraftEssence(
  region: Region,
  craftEssenceId: number,
): Promise<NiceEquip> {
  const url = `${API_BASE}/nice/${region}/equip/${craftEssenceId}?lore=true`;
  return fetchJson<NiceEquip>(
    url,
    `${region} craft essence ${craftEssenceId}`,
  );
}

export async function fetchBasicEvents(region: Region): Promise<BasicEvent[]> {
  return fetchJson<BasicEvent[]>(`${API_BASE}/export/${region}/basic_event.json`, `${region} basic event list`);
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const res = await fetch(url);

  if (!res.ok) {
    const bodySnippet = (await res.text()).slice(0, 200);
    throw new Error(
      `Failed to fetch ${label}: HTTP ${res.status} ${res.statusText} - ${bodySnippet}`,
    );
  }

  return (await res.json()) as T;
}

async function fetchText(url: string, label: string): Promise<string> {
  const res = await fetch(url);

  if (!res.ok) {
    const bodySnippet = (await res.text()).slice(0, 200);
    throw new Error(
      `Failed to fetch ${label}: HTTP ${res.status} ${res.statusText} - ${bodySnippet}`,
    );
  }

  return res.text();
}
