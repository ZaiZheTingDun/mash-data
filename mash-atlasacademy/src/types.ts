export interface NiceServantAssetGroup {
  ascension?: Record<string, string>;
  costume?: Record<string, string>;
}

export interface NiceServantExtraAssets {
  commands?: NiceServantAssetGroup;
  faces?: NiceServantAssetGroup;
  narrowFigure?: NiceServantAssetGroup;
  charaGraph?: NiceServantAssetGroup;
}

export interface NiceServantCostume {
  id: number;
  costumeCollectionNo?: number;
  battleCharaId: number;
  shortName?: string;
  name?: string;
  [key: string]: unknown;
}

export interface NiceServantProfile {
  costume?: Record<string, NiceServantCostume>;
  [key: string]: unknown;
}

export interface NiceServant {
  id: number;
  extraAssets?: NiceServantExtraAssets;
  profile?: NiceServantProfile;
  [key: string]: unknown;
}

export interface BasicServant {
  id: number;
  collectionNo: number;
  name: string;
  originalName?: string;
  type: string;
  flag?: string;
  flags?: string[];
  classId?: number;
  className?: string;
  attribute?: string;
  rarity: number;
  atkMax: number;
  hpMax: number;
  face: string;
  [key: string]: unknown;
}

export interface BasicEquip {
  id: number;
  collectionNo: number;
  name: string;
  originalName?: string;
  type: string;
  flag?: string;
  flags?: string[];
  rarity: number;
  atkMax: number;
  hpMax: number;
  face: string;
  [key: string]: unknown;
}

export interface NiceMysticCodeAssetItem {
  male?: string;
  female?: string;
}

export interface NiceMysticCodeExtraAssets {
  item?: NiceMysticCodeAssetItem;
  masterFace?: NiceMysticCodeAssetItem;
  masterFigure?: NiceMysticCodeAssetItem;
}

export interface NiceMysticCode {
  id: number;
  name: string;
  extraAssets?: NiceMysticCodeExtraAssets;
  skills?: Array<{ icon?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export type Region = "JP" | "CN";

export interface AtlasDataVersion {
  hash: string;
  timestamp: number;
}

export type AtlasDataVersions = Partial<Record<Region, AtlasDataVersion>>;

export interface AtlasChangeEntity {
  id: number;
  collectionNo?: number;
  [key: string]: unknown;
}

export interface AtlasChangeRecord {
  commit: string;
  timestamp: number;
  changes: {
    svt: AtlasChangeEntity[];
    ce: AtlasChangeEntity[];
    skill: AtlasChangeEntity[];
    buff: AtlasChangeEntity[];
    np: AtlasChangeEntity[];
    func: AtlasChangeEntity[];
  };
}
