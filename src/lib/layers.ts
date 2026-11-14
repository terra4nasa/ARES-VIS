// ARES-VIS layer registry — every map layer is defined here so new data
// sources can be added declaratively (or at runtime via the Add Layer dialog).
export type LayerType = "xyz" | "image" | "geojson";

export interface LayerDef {
  id: string;
  name: string;
  /** display group in the layers panel */
  group: "IMAGERY" | "TOPOGRAPHY" | "THERMAL" | "HAZARD" | "SCIENCE" | "GEOPHYSICS";
  type: LayerType;
  /** XYZ tile URL template ({z}/{y}/{x}) for type 'xyz' */
  url?: string;
  /** static asset path for type 'image' */
  src?: string;
  /** geographic bounds [S, W, N, E] for type 'image' */
  bounds?: [number, number, number, number];
  /** data key for type 'geojson' rendered from lib/data */
  dataKey?: "quakes" | "geology" | "pois" | "ellipse" | "routes";
  mission: string;
  instrument: string;
  resolution: string;
  citation: string;
  maxNativeZoom?: number;
  defaultVisible: boolean;
  defaultOpacity: number;
  custom?: boolean;
  /** optional footer note shown in panel */
  note?: string;
}

/** Leaflet tile geometry for the USGS OnMars (plate carrée, Mars-2000 sphere) pyramid:
 *  level 0 = 2×1 tiles of 512 px spanning 180°.  Leaflet EPSG4326 world = 512·2^z px,
 *  so app zoom Z → server level Z-1. */
export const TILE_SIZE = 512;
export const ZOOM_OFFSET = -1;
export const MAP_MIN_ZOOM = 1;
export const MAP_MAX_ZOOM = 16;

export const PRESET_LAYERS: LayerDef[] = [
  {
    id: "ctx",
    name: "CTX Global Mosaic",
    group: "IMAGERY",
    type: "xyz",
    url: "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}",
    mission: "Mars Reconnaissance Orbiter (MRO)",
    instrument: "Context Camera (CTX)",
    resolution: "~5–6 m/px (native)",
    citation: "USGS Astrogeology / Esri 'OnMars' tile service — MRO CTX controlled mosaic",
    maxNativeZoom: 12,
    defaultVisible: true,
    defaultOpacity: 1,
    note: "Primary navigation basemap — highest resolution global coverage.",
  },
  {
    id: "mdim",
    name: "Viking MDIM 2.1",
    group: "IMAGERY",
    type: "xyz",
    url: "https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer/tile/{z}/{y}/{x}",
    mission: "Viking Orbiter 1 & 2",
    instrument: "Vidicon cameras",
    resolution: "~232 m/px (global)",
    citation: "USGS Astrogeology MDIM 2.1 via Esri 'OnMars' tile service",
    maxNativeZoom: 7,
    defaultVisible: false,
    defaultOpacity: 0.85,
    note: "Classic global basemap — useful context when zoomed out.",
  },
  {
    id: "relief_regional",
    name: "Regional Elevation Relief",
    group: "TOPOGRAPHY",
    type: "image",
    src: "assets/img/relief_regional.png",
    bounds: [-6, 122, 14, 150],
    mission: "Mars Express + Mars Global Surveyor",
    instrument: "HRSC + MOLA blended DEM",
    resolution: "1.6 km/px (regional render)",
    citation: "USGS/PDS Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2",
    defaultVisible: true,
    defaultOpacity: 0.3,
    note: "Color relief + hillshade of Elysium Planitia region.",
  },
  {
    id: "relief_local",
    name: "Site Elevation Relief",
    group: "TOPOGRAPHY",
    type: "image",
    src: "assets/img/relief_local.png",
    bounds: [3.9, 134.8, 5.1, 136.4],
    mission: "Mars Express + Mars Global Surveyor",
    instrument: "HRSC + MOLA blended DEM",
    resolution: "200 m/px (native)",
    citation: "USGS/PDS Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2",
    defaultVisible: true,
    defaultOpacity: 0.35,
    note: "High-res relief around the InSight landing site.",
  },
  {
    id: "slope_hazard",
    name: "Slope Hazard Overlay",
    group: "HAZARD",
    type: "image",
    src: "assets/img/slope_hazard.png",
    bounds: [3.9, 134.8, 5.1, 136.4],
    mission: "Derived from HRSC + MOLA DEM",
    instrument: "ARES-VIS slope classification",
    resolution: "200 m/px",
    citation: "Slope classes computed from USGS/PDS HRSC-MOLA blended DEM v2",
    defaultVisible: true,
    defaultOpacity: 0.85,
    note: "yellow >1.5° · orange >3° · red >6° · dark red >12°",
  },
  {
    id: "themis_day",
    name: "THEMIS Day IR",
    group: "THERMAL",
    type: "image",
    src: "assets/img/themis_dayir.png",
    bounds: [3.8, 135.2, 5.2, 137.0],
    mission: "2001 Mars Odyssey",
    instrument: "THEMIS — Day IR controlled mosaic",
    resolution: "100 m/px",
    citation: "USGS/PDS THEMIS_DayIR_ControlledMosaic_Elysium_00N135E_100mpp (31 Jul 2014)",
    defaultVisible: false,
    defaultOpacity: 0.7,
    note: "Bright = higher daytime temperature = lower thermal inertia (dust).",
  },
  {
    id: "themis_night",
    name: "THEMIS Night IR",
    group: "THERMAL",
    type: "image",
    src: "assets/img/themis_nightir.png",
    bounds: [3.8, 135.2, 5.2, 137.0],
    mission: "2001 Mars Odyssey",
    instrument: "THEMIS — Night IR controlled mosaic",
    resolution: "100 m/px",
    citation: "USGS/PDS THEMIS_NightIR_ControlledMosaic_Elysium_00N135E_100mpp (30 Apr 2015)",
    defaultVisible: false,
    defaultOpacity: 0.75,
    note: "Bright at night = rock/bedrock retaining heat — good footings.",
  },
  {
    id: "ellipse",
    name: "InSight Landing Ellipse",
    group: "SCIENCE",
    type: "geojson",
    dataKey: "ellipse",
    mission: "InSight (Mars 2018 mission)",
    instrument: "Site-selection geometry",
    resolution: "130 × 27 km ellipse",
    citation: "Landing ellipse footprint (simplified, NASA/JPL site selection)",
    defaultVisible: true,
    defaultOpacity: 1,
  },
  {
    id: "pois",
    name: "Science Targets & Route Stops",
    group: "SCIENCE",
    type: "geojson",
    dataKey: "pois",
    mission: "ARES-VIS mission design",
    instrument: "Compiled from InSight / Odyssey / MRO data",
    resolution: "point targets",
    citation: "Mission-planning targets selected by the ARES-VIS science team",
    defaultVisible: true,
    defaultOpacity: 1,
  },
  {
    id: "quakes",
    name: "InSight Marsquake Epicenters",
    group: "GEOPHYSICS",
    type: "geojson",
    dataKey: "quakes",
    mission: "InSight (SEIS seismometer)",
    instrument: "Seismic Survey Investigation (SEIS)",
    resolution: "epicenter locations (approximate)",
    citation: "InSight Marsquake Service event catalog (NASA PDS / ETH Zurich) — epicenters approximate",
    defaultVisible: false,
    defaultOpacity: 1,
    note: "Zoom out to see the Cerberus Fossae seismic cluster ~1,300 km ENE.",
  },
  {
    id: "geology",
    name: "Geologic Interpretation",
    group: "GEOPHYSICS",
    type: "geojson",
    dataKey: "geology",
    mission: "Compiled from regional mapping",
    instrument: "USGS geologic mapping (simplified)",
    resolution: "interpretive polygons",
    citation: "Simplified/interpretive — based on USGS Elysium regional geologic mapping",
    defaultVisible: false,
    defaultOpacity: 0.65,
    note: "Interpretive units: young basalt plains, flow contacts, tectonic traces.",
  },
];

export interface CustomLayerInput {
  name: string;
  type: LayerType;
  url: string;
  bounds?: [number, number, number, number];
  maxNativeZoom?: number;
  attribution: string;
}

/** Convert a user-supplied layer into a renderable LayerDef */
export function customToLayerDef(input: CustomLayerInput, idx: number): LayerDef {
  return {
    id: `custom-${Date.now()}-${idx}`,
    name: input.name || "Custom layer",
    group: "IMAGERY",
    type: input.type,
    url: input.type === "xyz" ? input.url : undefined,
    src: input.type === "image" ? input.url : undefined,
    bounds: input.type === "image" ? input.bounds : undefined,
    mission: "User-added source",
    instrument: input.type.toUpperCase(),
    resolution: "—",
    citation: input.attribution || "User-supplied layer",
    maxNativeZoom: input.maxNativeZoom,
    defaultVisible: true,
    defaultOpacity: 0.8,
    custom: true,
  };
}

/** Future/planned integrations surfaced in the data catalog (modularity) */
export const PLANNED_ENDPOINTS = [
  { name: "HiRISE DTM (Mars 2020 TRN mosaics)", api: "USGS PDS S3 COG streaming", status: "planned" },
  { name: "CRISM targeted spectral scenes", api: "PDS Cartography & Imaging Node", status: "planned" },
  { name: "Mars Trek WMTS endpoints", api: "trek.nasa.gov", status: "planned" },
  { name: "APSS/TWINS raw met time series", api: "PDS Geosciences Node", status: "planned" },
  { name: "MAVEN solar-wind coupling", api: "PDS Planetary Plasma Node", status: "planned" },
];
