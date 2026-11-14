// Mars geo/math utilities for ARES-VIS
export const MARS_RADIUS_KM = 3396.19;
export const MARS_M_PER_DEG = 59271.4; // meters per degree of arc (sphere)
export const MARS_GRAVITY = 3.71; // m/s^2

export interface LngLat {
  lon: number;
  lat: number;
}

/** Great-circle distance on the Mars sphere (km) */
export function haversineKm(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const la1 = a.lat * toRad;
  const la2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function pathLengthKm(points: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i]);
  return total;
}

/** Approximate solar elevation for local solar time (equinox assumption, Ls≈0) */
export function sunElevationDeg(latDeg: number, lstHours: number): number {
  const ha = ((lstHours - 12) / 24) * 2 * Math.PI; // hour angle
  const lat = (latDeg * Math.PI) / 180;
  const sinEl = Math.sin(lat) * 0 + Math.cos(lat) * Math.cos(ha) * 1 + Math.sin(lat) * Math.sin(0);
  // declination assumed 0 (equinox): sin(el) = cos(lat)cos(ha)
  const el = Math.asin(Math.cos(lat) * Math.cos(ha));
  return (el * 180) / Math.PI;
}

/** Effective suited walking speed on slope (km/h) */
export function slopeAdjustedSpeed(baseKmh: number, slopeDeg: number): number {
  const factor = 1 - Math.min(slopeDeg / 18, 0.85) * 0.6;
  return Math.max(0.4, baseKmh * factor);
}

/** Initial bearing from a → b, degrees clockwise from grid north (0–360) */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const la1 = a.lat * toRad;
  const la2 = b.lat * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** 16-point compass name for a bearing in degrees */
export function compassPoint(deg: number): string {
  const pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return pts[Math.round(((deg % 360) / 22.5)) % 16];
}

export function fmtDist(m: number): string {
  if (m < 1000) return `${m.toFixed(0)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function fmtLonLat(lon: number, lat: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${ns} ${Math.abs(lon).toFixed(4)}°${ew}`;
}
