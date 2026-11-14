// ARES-VIS mission data — InSight / Elysium Planitia
// Terrain values sampled from the real HRSC-MOLA blended DEM (see scripts/generate_assets.py)

export const SITE = {
  name: "Base Camp Alpha — InSight 'Homestead Hollow'",
  lat: 4.502388,
  lon: 135.623447,
  elevM: -2413, // NASA/JPL official landing-site elevation
  demElevM: -2615, // HRSC-MOLA blended DEM sample at the waypoint
  landed: "26 Nov 2018",
};

export interface Poi {
  id: string;
  code: string;
  name: string;
  type: "base" | "science" | "hazard";
  lon: number;
  lat: number;
  elevM: number;
  slopeDeg: number;
  objective: string;
  activity: string;
  hazard: string;
  pov?: string;
  povCredit?: string;
  durationMin: number;
}

export const POIS: Poi[] = [
  {
    id: "base",
    code: "BASE-01",
    name: "Base Camp Alpha (Homestead Hollow)",
    type: "base",
    lon: 135.6234,
    lat: 4.5024,
    elevM: -2615,
    slopeDeg: 0.4,
    objective:
      "Reference station co-located with the retired InSight lander. Surface operations hub, relay antenna mast and EVA start point.",
    activity: "Suit-up check · rover load-out · comms handshake with habitat",
    hazard: "Landing-zone debris discipline — respect the preserved InSight hardware perimeter.",
    pov: "assets/img/pov_selfie.jpg",
    povCredit: "NASA/JPL-Caltech (InSight self-portrait)",
    durationMin: 0,
  },
  {
    id: "sc1",
    code: "SC-01",
    name: "Dust Devil Track Corridor",
    type: "science",
    lon: 135.645,
    lat: 4.509,
    elevM: -2625,
    slopeDeg: 0.5,
    objective:
      "Active aeolian corridor crossed by fresh dust-devil tracks (THEMIS repeat coverage). InSight APSS recorded hundreds of passing vortices here — sample the fresh dust layer and deploy a drop-met station.",
    activity: "Regolith scoop (dust layer) · vortex logger drop · albedo photo pair",
    hazard: "Reduced traction inside fresh dust laps — test footing before crossing.",
    pov: "assets/img/pov_panorama.jpg",
    povCredit: "NASA/JPL-Caltech (InSight site panorama)",
    durationMin: 40,
  },
  {
    id: "sc2",
    code: "SC-02",
    name: "Fresh Crater & Ejecta Blanket",
    type: "science",
    lon: 135.668,
    lat: 4.498,
    elevM: -2635,
    slopeDeg: 0.6,
    objective:
      "Small fresh impact crater with rayed ejecta. InSight seismically detected meteoroid strikes in this size class (2020–21); HiRISE imaged their fresh craters. Excavated stratigraphy exposes the shallow basalt cap.",
    activity: "Ejecta stratigraphy survey · block count line · sample weldless impact glass",
    hazard: "Sharp ejecta blocks — suit-abrasion risk; keep gloves clear of glassy fragments.",
    pov: "assets/img/pov_hirise_site.jpg",
    povCredit: "NASA/JPL-Caltech/University of Arizona (HiRISE site imagery)",
    durationMin: 55,
  },
  {
    id: "sc3",
    code: "SC-03",
    name: "Boulder Field Overlook",
    type: "hazard",
    lon: 135.69,
    lat: 4.515,
    elevM: -2646,
    slopeDeg: 0.1,
    objective:
      "Block-rich ground visible in THEMIS Night IR (warm, high thermal inertia). Characterise boulder frequency for future trafficability maps and sample basalt lithology.",
    activity: "Rock-size frequency count · hand-sample basalt · hazard photomosaic",
    hazard: "Ankle-trap terrain — traverse the margin only; no route crossing the field.",
    pov: "assets/img/pov_mole.png",
    povCredit: "NASA/JPL-Caltech (InSight Instrument Deployment Camera)",
    durationMin: 35,
  },
  {
    id: "sc4",
    code: "SC-04",
    name: "Dune Field Margin",
    type: "science",
    lon: 135.612,
    lat: 4.525,
    elevM: -2614,
    slopeDeg: 0.5,
    objective:
      "Marginal sand drifts against the plain. Measure grain size and ripple migration to calibrate regional wind models from APSS/TWINS records.",
    activity: "Sand trap deployment · ripple azimuth survey · thermal conductivity probe",
    hazard: "Soft sand — wheelchair test required; crossing only on the hardened margin.",
    pov: "assets/img/pov_panorama.jpg",
    povCredit: "NASA/JPL-Caltech",
    durationMin: 30,
  },
  {
    id: "sc5",
    code: "SC-05",
    name: "Young Lava Flow Contact",
    type: "science",
    lon: 135.633,
    lat: 4.487,
    elevM: -2616,
    slopeDeg: 0.6,
    objective:
      "Contact between young flood-basalt lobes (Amazonian, related to the Cerberus Fossae / Athabasca Valles system) and older plains. Read the eruption stratigraphy of the last billion years.",
    activity: "Contact margin transect · lava-surface relative-age read · sample vesicle zone",
    hazard: "Jagged pāhoehoe ropes — walk on the older smooth unit.",
    pov: "assets/img/pov_final_location.jpg",
    povCredit: "NASA/JPL-Caltech (InSight mission context)",
    durationMin: 45,
  },
];

/** InSight Marsquake Service — Cerberus Fossae cluster (epicenters approximate) */
export const QUAKES = {
  note: "Epicenters are approximate. InSight detected >1,300 marsquakes through end of mission; the largest was M 4.7 (May 2022). Events M 3–4 cluster along the Cerberus Fossae graben, ~1,300 km ENE of the site. Source: InSight Marsquake Service catalog (NASA PDS / ETH Zurich).",
  events: [
    { lon: 155.6, lat: 6.3, mag: 3.1, label: "CF cluster event · M 3.1" },
    { lon: 156.8, lat: 7.0, mag: 3.3, label: "CF cluster event · M 3.3" },
    { lon: 157.9, lat: 7.7, mag: 3.5, label: "CF cluster event · M 3.5" },
    { lon: 159.0, lat: 8.3, mag: 3.6, label: "CF cluster event · M 3.6" },
    { lon: 160.2, lat: 8.9, mag: 4.1, label: "CF cluster event · M 4.1" },
  ],
};

/** Simplified/interpretive geology — traced from THEMIS Day IR contrast + USGS regional mapping */
export const GEOLOGY = {
  note: "Simplified interpretive units (not a formal map). Basaltic-plains unit after USGS regional geologic mapping of Elysium Planitia; flow margin and thermal-inertia patches traced from THEMIS Day/Night IR contrast.",
  features: [
    {
      kind: "polygon" as const,
      name: "Ua — Amazonian basaltic plains",
      coords: [
        [
          [127, -1], [151, -1], [151, 16], [127, 16], [127, -1],
        ],
      ],
      color: "#4b5563",
    },
    {
      kind: "line" as const,
      name: "Young flood-lava flow margin (THEMIS)",
      coords: [
        [135.05, 4.2], [135.35, 4.6], [135.5, 4.9], [135.72, 5.35], [136.0, 5.6],
      ],
      color: "#fb923c",
    },
    {
      kind: "polygon" as const,
      name: "High thermal-inertia patch (rocky)",
      coords: [
        [[135.52, 4.32], [135.86, 4.35], [135.84, 4.72], [135.5, 4.68], [135.52, 4.32]],
      ],
      color: "#f59e0b",
    },
    {
      kind: "line" as const,
      name: "Cerberus Fossae tectonic traces",
      coords: [
        [153.0, 5.5], [156.5, 7.3], [160.0, 9.2], [162.0, 10.2],
      ],
      color: "#ef4444",
    },
  ],
};

/** Landing ellipse (approximate footprint: 130 x 27 km, rotated) */
export function landingEllipseGeo(): number[][] {
  const cx = 135.623, cy = 4.47;
  const aKm = 65, bKm = 13.5; // semi-axes
  const azDeg = 24; // rotation of major axis from north (approximate)
  const mPerDegLat = 59271.4;
  const mPerDegLon = 59271.4 * Math.cos((cy * Math.PI) / 180);
  const pts: number[][] = [];
  for (let i = 0; i <= 72; i++) {
    const t = (i / 72) * 2 * Math.PI;
    const x = aKm * Math.cos(t); // along major axis
    const y = bKm * Math.sin(t);
    const az = (azDeg * Math.PI) / 180;
    // rotate: north-aligned frame → east/north offsets
    const eOff = x * Math.sin(az) + y * Math.cos(az);
    const nOff = x * Math.cos(az) - y * Math.sin(az);
    pts.push([cx + eOff / mPerDegLon, cy + nOff / mPerDegLat]);
  }
  return pts;
}

/** Typical diurnal meteorology at Homestead Hollow (InSight APSS/TWINS, illustrative) */
export const WEATHER = {
  note: "Typical sol climatology for southern Elysium Planitia compiled from InSight APSS/TWINS/PS published results. Values are illustrative planning figures, not a forecast.",
  hours: Array.from({ length: 24 }, (_, i) => i),
  airTemp: [-72, -76, -80, -84, -88, -92, -93, -90, -82, -70, -56, -44, -34, -27, -22, -19, -21, -28, -38, -48, -56, -62, -66, -69],
  groundTemp: [-64, -70, -76, -82, -87, -90, -88, -80, -64, -42, -20, -2, 8, 12, 13, 11, 6, -4, -18, -32, -44, -52, -57, -61],
  pressure: [675, 672, 670, 672, 678, 690, 700, 702, 694, 680, 666, 658, 656, 660, 668, 678, 686, 688, 684, 676, 670, 668, 670, 672],
  wind: [4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 14, 12, 10, 9, 8, 7, 6, 5, 4, 4, 4],
  dustTau: 0.45,
  solarMaxWm2: 560,
};

/** Radiation reference values (Curiosity RAD, Gale Crater — closest analogue) */
export const RADIATION = {
  note: "GCR dose calibrated to Curiosity RAD (0.64 mSv/day near solar maximum, Hassler et al. 2014); scaled by live F10.7 solar activity from NOAA SWPC. NASA career effective-dose limit ≈ 600 mSv. SPE state from GOES proton flux (S1–S5 scale); the ~16 g/cm² CO₂ column strongly attenuates protons, so surface SPE dose is a secondary contribution to the GCR baseline.",
  careerLimitMsv: 600,
};

/** Relay-pass pattern (illustrative schedule used by Mars surface missions) */
export const COMMS = {
  note: "UHF relay passes follow the pattern used by every NASA Mars surface mission: several passes per sol via Mars Reconnaissance Orbiter, Mars Odyssey and (partner) ExoMars TGO. Pass times here are a planning pattern, not a live ephemeris.",
  relays: [
    { name: "MRO / Electra", band: "UHF 400 MHz", passesPerSol: 4, dataRate: "up to 2 Mb/s surface relay" },
    { name: "Odyssey", band: "UHF", passesPerSol: 3, dataRate: "128 kb/s typical" },
    { name: "ExoMars TGO (partner)", band: "UHF", passesPerSol: 3, dataRate: "up to 2 Mb/s" },
  ],
  passPattern: [3.5, 9.0, 14.5, 20.0], // local solar time (h) illustrative pass centers
};

export interface CatalogEntry {
  name: string;
  kind: string;
  mission: string;
  instrument: string;
  resolution: string;
  coverage: string;
  source: string;
  url: string;
  usedAs: string;
  live?: boolean;
}

export const CATALOG: CatalogEntry[] = [
  {
    name: "CTX Global Mosaic",
    kind: "Optical imagery",
    mission: "Mars Reconnaissance Orbiter",
    instrument: "Context Camera (CTX)",
    resolution: "~5–6 m/px",
    coverage: "Global (controlled mosaic)",
    source: "USGS Astrogeology / Esri OnMars tile service",
    url: "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer",
    usedAs: "Primary navigation basemap",
  },
  {
    name: "Viking MDIM 2.1",
    kind: "Optical imagery",
    mission: "Viking Orbiter 1 & 2",
    instrument: "Vidicon cameras",
    resolution: "~232 m/px",
    coverage: "Global",
    source: "USGS Astrogeology / Esri OnMars",
    url: "https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer",
    usedAs: "Zoomed-out context basemap",
  },
  {
    name: "HRSC-MOLA Blended DEM v2",
    kind: "Topography",
    mission: "Mars Express + Mars Global Surveyor",
    instrument: "HRSC stereo + MOLA laser altimeter",
    resolution: "200 m/px global",
    coverage: "Global",
    source: "USGS Astrogeology (PDS archive)",
    url: "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.lbl",
    usedAs: "Elevation relief, slope-hazard overlay, route elevation profiles",
  },
  {
    name: "THEMIS Day IR Controlled Mosaic",
    kind: "Thermal",
    mission: "2001 Mars Odyssey",
    instrument: "THEMIS (IR band 9)",
    resolution: "100 m/px",
    coverage: "Elysium quad (0–30°N, 135–180°E)",
    source: "USGS Astrogeology / PDS",
    url: "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/THEMIS_controlled_mosaics/Elysium_DayIR_31July2014/THEMIS_DayIR_ControlledMosaic_Elysium_00N135E_100mpp.lbl",
    usedAs: "Thermal-inertia proxy (daytime temperature)",
  },
  {
    name: "THEMIS Night IR Controlled Mosaic",
    kind: "Thermal",
    mission: "2001 Mars Odyssey",
    instrument: "THEMIS (IR band 9, night)",
    resolution: "100 m/px",
    coverage: "Elysium quad",
    source: "USGS Astrogeology / PDS",
    url: "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/THEMIS_controlled_mosaics/Elysium_NightIR_30April2015/THEMIS_NightIR_ControlledMosaic_Elysium_00N135E_100mpp.lbl",
    usedAs: "Rock/bedrock detection (night retention)",
  },
  {
    name: "InSight APSS meteorology",
    kind: "Atmospheric",
    mission: "InSight (Mars 2018)",
    instrument: "TWINS + Pressure Sensors (APSS)",
    resolution: "Point station, continuous",
    coverage: "Homestead Hollow (4.502°N, 135.623°E)",
    source: "NASA PDS Geosciences Node",
    url: "https://pds-geosciences.wustl.edu/missions/insight/index.htm",
    usedAs: "Diurnal weather model for EVA windows",
  },
  {
    name: "InSight Marsquake catalog",
    kind: "Geophysical",
    mission: "InSight",
    instrument: "SEIS seismometer",
    resolution: "Event catalog (epicenters approximate)",
    coverage: "Global detection, Cerberus Fossae cluster",
    source: "InSight Marsquake Service (ETH Zurich / NASA PDS)",
    url: "https://www.insight.ethz.ch/seismicity/catalog-gn",
    usedAs: "Regional seismicity context layer",
  },
  {
    name: "MSL RAD dose measurements",
    kind: "Radiation",
    mission: "Curiosity (MSL) at Gale crater",
    instrument: "Radiation Assessment Detector (RAD)",
    resolution: "0.64 mSv/day GCR (solar max)",
    coverage: "Gale crater (calibration for Elysium)",
    source: "NASA PDS / Hassler et al. 2014",
    url: "https://pds-geosciences.wustl.edu/missions/msl/rad.htm",
    usedAs: "Surface radiation dose calibration",
  },
  {
    name: "NOAA SWPC space weather",
    kind: "Radiation / space weather",
    mission: "GOES + SOHO networks (Earth-based)",
    instrument: "Proton flux, F10.7, Kp",
    resolution: "Live JSON feed",
    coverage: "Solar system context",
    source: "NOAA Space Weather Prediction Center",
    url: "https://services.swpc.noaa.gov/",
    usedAs: "Live GCR/SPE EVA state via /api/spaceweather",
    live: true,
  },
  {
    name: "InSight POV imagery",
    kind: "Optical (surface)",
    mission: "InSight",
    instrument: "ICC / IDC cameras",
    resolution: "Surface photos",
    coverage: "Homestead Hollow",
    source: "NASA Image and Video Library (images-api.nasa.gov)",
    url: "https://images.nasa.gov/",
    usedAs: "Waypoint 'what to expect' visuals",
  },
];
