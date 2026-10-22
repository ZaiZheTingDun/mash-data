import type { Region } from "../mash-atlasacademy/src/types.ts";

export interface CatalogEvent {
  id: number;
  type: string;
  name: string;
  noticeAt: number;
  startedAt: number;
  endedAt: number;
  finishedAt: number;
  warIds: number[];
}

export interface EventCatalog {
  schemaVersion: 1;
  regions: Record<Region, CatalogEvent[]>;
}


export const EVENT_ITEM_TYPES = [
  "eventItem", "eventPoint", "boostItem", "dice", "eventPassiveSkillGiven",
] as const;

export interface EventItem {
  id: number;
  type: typeof EVENT_ITEM_TYPES[number];
  name: string;
  detail: string;
  background: string;
  /** Path relative to assets; shared between JP and CN. */
  icon: string | null;
  /** Set only when Atlas returns HTTP 404; retried on the next run. */
  missingIcon?: string;
}

export interface EventItemsCatalog {
  schemaVersion: 1;
  regions: Record<Region, EventItem[]>;
}

