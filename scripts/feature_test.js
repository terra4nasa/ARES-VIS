/* ARES-VIS 13-feature regression probe — desktop (mouse) + iPad (touch).
 * Covers: relocation (gazetteer/name/coords + validation), comms send/receive,
 * bottom dock, control cluster, view switch, beacon/location naming, map grid,
 * O2 low/critical banners, D-pad walk on touch. */
const { chromium, devices } = require("playwright");

const SHOTS = "./test-results";
const URL = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissBoot(page) {
  const dlg = page.locator('div[role="dialog"][aria-label="Mission briefing"]');
  if (await dlg.count()) {
    const btn = page.locator('button:has-text("enter visor display")');
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 10000 }).catch(() => {});
    await sleep(1200);
  }
}

async function main() {
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
  const errors = [];
  const out = {};

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push("[console] " + m.text().slice(0, 140)); });
  page.on("pageerror", (e) => errors.push("[pageerror] " + e.message.slice(0, 140)));

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(7000);
  await dismissBoot(page);
  await sleep(2500);

  /* ---- F12 map grid + F6 idle beacon + F11 topbar chip ---- */
  out.gridLabels = await page.locator(".grid-label").count();
  out.gridChip = await page.locator("text=/grid .*°/").first().isVisible().catch(() => false);
  out.idleBeacon = await page.locator(".astro-marker.idle").count();
  out.topbarLocation = await page.locator('header >> text=/Homestead Hollow/').first().isVisible().catch(() => false);
  out.viewSwitch = await page.locator('button:has-text("visor view")').count();
  await page.screenshot({ path: `${SHOTS}/ft-01-map.png` });

  /* ---- F8/F9: locations panel — gazetteer select ---- */
  await page.locator('nav[aria-label="Planner panels"] button[title="Locations"]').click();
  await sleep(900);
  out.locationsPanel = await page.locator('aside[aria-label="LOCATION CONTROL"]').count();
  await page.locator('button:has-text("Jezero Crater")').first().click();
  await sleep(2200);
  const st1 = await page.evaluate(() => window.__ARES_STORE__ && { site: window.__ARES_STORE__.getState().site.name, route: window.__ARES_STORE__.getState().route.length });
  out.jezeroRelocate = st1;
  await page.screenshot({ path: `${SHOTS}/ft-02-jezero.png` });

  /* ---- F9: manual coords (name input too) ---- */
  await page.fill('input[aria-label="Latitude"]', "22.0 N");
  await page.fill('input[aria-label="Longitude"]', "-48.0 W");
  await page.locator('button:has-text("set")').click();
  await sleep(2000);
  const st2 = await page.evaluate(() => window.__ARES_STORE__ && window.__ARES_STORE__.getState().site.name);
  out.coordsRelocate = st2; // expect Chryse Planitia (Viking 1) · … km

  /* invalid latitude must show an inline error */
  await page.fill('input[aria-label="Latitude"]', "95");
  await page.fill('input[aria-label="Longitude"]', "0");
  await page.locator('button:has-text("set")').click();
  await sleep(500);
  out.coordValidation = await page.locator("text=/within −90/").first().isVisible().catch(() => false);

  /* name search → Olympus Mons */
  await page.fill('input[aria-label="Site name"]', "olympus");
  await page.locator('aside[aria-label="LOCATION CONTROL"] button:has-text("go")').click();
  await sleep(2200);
  const st3 = await page.evaluate(() => window.__ARES_STORE__ && window.__ARES_STORE__.getState().site.name);
  out.nameRelocate = st3; // expect Olympus Mons
  await page.screenshot({ path: `${SHOTS}/ft-03-olympus.png` });

  /* ---- F10: switch to visor via segmented control ---- */
  await page.locator('button:has-text("visor view")').click();
  await sleep(3500);
  out.standbyLocation = await page.locator("text=/Olympus Mons/").first().isVisible().catch(() => false);
  await page.screenshot({ path: `${SHOTS}/ft-04-standby.png` });

  /* ---- begin marswalk → dock ---- */
  await page.locator('button:has-text("begin marswalk")').click();
  await sleep(5000);
  out.dockCards = await page.evaluate(() => ({
    location: Array.from(document.querySelectorAll(".hud-panel")).some((p) => /location · live beacon/i.test(p.textContent || "")),
    comms: Array.from(document.querySelectorAll(".hud-panel")).some((p) => /comms link/i.test(p.textContent || "")),
    control: Array.from(document.querySelectorAll(".hud-panel")).some((p) => /control panel/i.test(p.textContent || "")),
    nav: Array.from(document.querySelectorAll(".hud-panel")).some((p) => /next waypoint/i.test(p.textContent || "")),
  }));
  await page.screenshot({ path: `${SHOTS}/ft-05-walk-dock.png` });

  /* ---- F3: comms panel send/receive ---- */
  await page.locator('button:has-text("open comms")').first().click();
  await sleep(700);
  await page.fill('input[aria-label="Message to mission control"]', "status report please");
  await page.locator('button[title="Send to Mission Control"]').click();
  await sleep(800);
  out.commsSent = await page.locator("text=/status report please/").first().isVisible().catch(() => false);
  await sleep(4500);
  out.commsReply = await page.evaluate(() => {
    const s = window.__ARES_STORE__.getState();
    return { n: s.comms.messages.length, mission: s.comms.messages.some((m) => m.from === "mission"), signal: s.comms.signal, status: s.comms.status };
  });
  await page.screenshot({ path: `${SHOTS}/ft-06-comms.png` });

  /* ---- F13: O2 warnings — fresh walk + fast-burn suit ---- */
  await page.evaluate(() => {
    const s = window.__ARES_STORE__.getState();
    s.stopWalk();
    s.startWalk();
    s.setEva({ suitHours: 0.2 });
    for (let i = 0; i < 5; i++) s.cycleWalkSpeed();
  });
  /* software-rendered emulator crawls the sim clock (dt clamp at ~2 fps) — allow generous waits */
  for (let i = 0; i < 10 && !out.o2Low; i++) {
    await sleep(2500);
    out.o2Low = await page.locator("text=/O₂ LOW/").first().isVisible().catch(() => false);
  }
  out.o2StateMid = await page.evaluate(() => {
    const s = window.__ARES_STORE__.getState();
    return { o2: s.walk.readout?.o2Pct, mult: s.walk.speedMult, suit: s.eva.suitHours, fps: Math.round((window.__FPV_CAMBUS__?.fps ?? 0) * 10) / 10 };
  });
  await page.screenshot({ path: `${SHOTS}/ft-07-o2-low.png` });
  for (let i = 0; i < 10 && !out.o2Critical; i++) {
    await sleep(2500);
    out.o2Critical = await page.locator("text=/O₂ CRITICAL/").first().isVisible().catch(() => false);
  }
  out.o2Vignette = await page.locator(".o2-crit-vignette").count();
  await page.screenshot({ path: `${SHOTS}/ft-08-o2-critical.png` });

  /* ---- F10: dock "map view" switch keeps mission state ---- */
  await page.locator('button[title*="Switch to Map View"]').first().click();
  await sleep(2000);
  const st4 = await page.evaluate(() => {
    const s = window.__ARES_STORE__.getState();
    return { visor: s.visorMode, walkActive: s.walk.active, site: s.site.name, o2: s.walk.readout?.o2Pct };
  });
  out.mapReturn = st4;
  out.activeMarker = await page.locator(".astro-marker:not(.idle)").count();
  await page.screenshot({ path: `${SHOTS}/ft-09-map-return.png` });

  /* back to visor — walk resumes where it was */
  await page.locator('button:has-text("visor view")').click();
  await sleep(2500);
  out.walkResumed = await page.locator('button:has-text("begin marswalk")').count(); // should be 0 → walk HUD shown

  await ctx.close();

  /* ================= iPad touch pass ================= */
  const iPad = devices["iPad Pro 11"];
  const tctx = await browser.newContext({ ...iPad });
  const tpage = await tctx.newPage();
  tpage.on("pageerror", (e) => errors.push("[ipad pageerror] " + e.message.slice(0, 140)));
  const tcdp = await tctx.newCDPSession(tpage);
  await tpage.goto(URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await sleep(7000);
  await dismissBoot(tpage);
  await sleep(2000);
  await tpage.tap('button:has-text("visor view")');
  await sleep(3000);
  await tpage.tap('button:has-text("begin marswalk")');
  await sleep(4500);
  /* touch-HOLD the forward pad for ~1.4 s via CDP */
  const pad = await tpage.locator('button[aria-label="Walk forward (W)"]').boundingBox();
  if (pad) {
    const px = pad.x + pad.width / 2, py = pad.y + pad.height / 2;
    await tcdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: px, y: py, id: 1 }] });
    await sleep(1400);
    const mid = await tpage.evaluate(() => window.__FPV_CAMBUS__ && { speed: window.__FPV_CAMBUS__.speedMs, lon: +window.__FPV_CAMBUS__.lon.toFixed(4), lat: +window.__FPV_CAMBUS__.lat.toFixed(4) });
    out.ipadWalk = mid;
    await tcdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await tpage.screenshot({ path: `${SHOTS}/ft-10-ipad-dock.png` });
  /* D-pad must sit fully above the dock; control cluster must be on-screen */
  const padBottom = await tpage.locator('button[aria-label="Walk backward (S)"]').boundingBox();
  const ctrlBtn = await tpage.locator('button[title="End walk — exit visor"]').first().boundingBox();
  out.ipadLayout = padBottom && ctrlBtn ? { padBottomY: Math.round(padBottom.y + padBottom.height), dockTopY: Math.round(ctrlBtn.y), clear: padBottom.y + padBottom.height <= ctrlBtn.y, ctrlOnScreen: ctrlBtn.x >= 0 && ctrlBtn.x + ctrlBtn.width <= 834 } : null;
  await tctx.close();

  out.errors = errors.slice(0, 15);
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
