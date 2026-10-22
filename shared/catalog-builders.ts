import type { CatalogEvent, EventCatalog, EventItem, EventItemsCatalog } from "./event-catalogs.ts";

type ResourceEventItem = Omit<EventItem, "detail"> & { nameCN: string | null };
type EventDates = Pick<CatalogEvent, "noticeAt" | "startedAt" | "endedAt" | "finishedAt">;
type ResourceEventRegion = EventDates & Partial<Pick<CatalogEvent, "type" | "warIds">>;
type ResourceEvent = Pick<CatalogEvent, "id" | "type" | "name" | "warIds"> & {
  nameCN: string | null;
  JP: ResourceEventRegion | null;
  CN: ResourceEventRegion | null;
};

function mergedIds(regions: { JP: { id: number }[]; CN: { id: number }[] }): number[] {
  return [...new Set([...regions.JP, ...regions.CN].map(({ id }) => id))].sort((a, b) => a - b);
}

export function buildEventItemResources(catalog: EventItemsCatalog): {
  schemaVersion: 2;
  items: ResourceEventItem[];
} {
  const jp = new Map(catalog.regions.JP.map((item) => [item.id, item]));
  const cn = new Map(catalog.regions.CN.map((item) => [item.id, item]));
  const items = mergedIds(catalog.regions).map((id): ResourceEventItem => {
    const base = (jp.get(id) ?? cn.get(id))!;
    return {
      id: base.id, type: base.type, name: base.name, nameCN: cn.get(id)?.name ?? null,
      background: base.background, icon: base.icon,
      ...(base.missingIcon ? { missingIcon: base.missingIcon } : {}),
    };
  });
  return { schemaVersion: 2, items };
}

function eventRegion(event: CatalogEvent | undefined, base: CatalogEvent): ResourceEventRegion | null {
  if (!event) return null;
  return {
    noticeAt: event.noticeAt, startedAt: event.startedAt,
    endedAt: event.endedAt, finishedAt: event.finishedAt,
    ...(event.type !== base.type ? { type: event.type } : {}),
    ...(JSON.stringify(event.warIds) !== JSON.stringify(base.warIds) ? { warIds: event.warIds } : {}),
  };
}

export function buildEventResources(catalog: EventCatalog): {
  schemaVersion: 2;
  events: ResourceEvent[];
} {
  const jp = new Map(catalog.regions.JP.map((event) => [event.id, event]));
  const cn = new Map(catalog.regions.CN.map((event) => [event.id, event]));
  const events = mergedIds(catalog.regions).map((id): ResourceEvent => {
    const base = (jp.get(id) ?? cn.get(id))!;
    return {
      id: base.id, type: base.type, name: base.name, nameCN: cn.get(id)?.name ?? null,
      warIds: base.warIds,
      JP: eventRegion(jp.get(id), base), CN: eventRegion(cn.get(id), base),
    };
  });
  return { schemaVersion: 2, events };
}
