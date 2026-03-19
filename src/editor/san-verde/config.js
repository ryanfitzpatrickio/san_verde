import {
  CATALOG_DISTRICT_ORDER,
  CATALOG_DISTRICT_LABELS,
  CATALOG_DISTRICT_SHORT_LABELS,
  CATALOG_DISTRICT_COLORS
} from '../../game/catalog-district-config.js';

export { CATALOG_DISTRICT_ORDER, CATALOG_DISTRICT_LABELS, CATALOG_DISTRICT_SHORT_LABELS, CATALOG_DISTRICT_COLORS };

export const ROAD_STYLES = {
  boulevard: { width: 28, color: '#4a5a6a', medianWidth: 5 },
  avenue: { width: 22, color: '#3a4a5a', medianWidth: 0 },
  street: { width: 18, color: '#2a3a4a', medianWidth: 0 }
};

export const ZONE_COLORS = CATALOG_DISTRICT_COLORS;
export const ZONE_LABELS = CATALOG_DISTRICT_SHORT_LABELS;

export const ZONE_PLOT_STYLE = {
  downtown: { spacing: 36, footprintMin: 22, footprintMax: 36, depthMin: 22, depthMax: 36, setback: 8, fillChance: 0.92 },
  residential_low: { spacing: 22, footprintMin: 10, footprintMax: 16, depthMin: 10, depthMax: 15, setback: 7, fillChance: 0.78 },
  residential_mid: { spacing: 18, footprintMin: 10, footprintMax: 18, depthMin: 12, depthMax: 18, setback: 7, fillChance: 0.82 },
  residential_high: { spacing: 24, footprintMin: 16, footprintMax: 26, depthMin: 16, depthMax: 24, setback: 9, fillChance: 0.86 },
  mixed_main: { spacing: 20, footprintMin: 12, footprintMax: 20, depthMin: 14, depthMax: 22, setback: 7, fillChance: 0.84 },
  commercial_general: { spacing: 22, footprintMin: 16, footprintMax: 24, depthMin: 14, depthMax: 24, setback: 8, fillChance: 0.82 },
  commercial_regional: { spacing: 32, footprintMin: 26, footprintMax: 42, depthMin: 24, depthMax: 40, setback: 10, fillChance: 0.9 },
  industrial_light: { spacing: 26, footprintMin: 20, footprintMax: 32, depthMin: 20, depthMax: 30, setback: 10, fillChance: 0.82 },
  industrial_heavy: { spacing: 34, footprintMin: 28, footprintMax: 48, depthMin: 24, depthMax: 44, setback: 12, fillChance: 0.88 },
  civic: { spacing: 26, footprintMin: 18, footprintMax: 32, depthMin: 18, depthMax: 30, setback: 10, fillChance: 0.78 },
  park: { spacing: 40, footprintMin: 8, footprintMax: 12, depthMin: 8, depthMax: 12, setback: 15, fillChance: 0.1 }
};

export const DEFAULT_BAKE_CONFIG = Object.freeze({
  version: 1,
  chunkSize: 800,
  detailRadius: 900,
  massRadius: 2200,
  assignedGlbOnly: false,
  defaultStageMode: 'procedural_only',
  detailAssetMode: 'chunk_baked',
  midAssetMode: 'chunk_baked',
  farAssetMode: 'skyline_merged',
  glbPreviewEntries: ['bungalow_urban', 'townhouse_single']
});
