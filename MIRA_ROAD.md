# Mira Road station (milestone 4b: the station pass)

Goal: make Mira Road a real, explorable Mumbai suburban station, and the start of the local-train
journey. It uses Churchgate as the quality benchmark but has its own suburban character. This pass
improves the first version from LOCAL_TRAIN.md §3; it does not rebuild it.

Facts marked **⚠** are estimates or general knowledge, not taken from a source in this repo.

## 1. Sources

| Source | Used for |
|---|---|
| `assets/miraroad/main_entrance.jpg`, `entrance2.jpg`, `outside/0.jpeg`, `5.jpeg`, the 04-35-25 video still | East front: yellow sandstone arcade, white columns and archivolts, white pediment with the raised "मिरा रोड / MIRA ROAD" plaque, full-width stone steps, cobbled forecourt, steel bollards, ornamental lamp posts, the MBMC no-parking sign, hoardings on the deck behind |
| `outside/0_1.jpeg` | War memorial (soldiers raising the flag between white blades), fountain with steel railing, chained bollards, fan-pattern paving |
| `auto_stand.jpg`, `mira_road_railway_station_night_auto_paths.jpg`, video stills 04-36-10/19 | Auto stand: autos queued in railed lanes towards the station, the skywalk overhead, the approach road with its lamps, the lit shops opposite |
| `outside/5.jpeg` | Two-wheeler pay-and-park beside the skywalk, with its rate board |
| `outside/3.jpeg`, `station_main_road.jpg`, video still 04-37-19 | MBMT buses and bus stop, shopfronts, poles and cables, apartment blocks |
| `mira-road-station-train-schedule-board-mumbai-local.jpg` | The all-platform board: Hindi header grid, one block per platform, yellow and cyan rows, red clock. **It confirms the platform pattern: PF 1 Virar, PF 2 Andheri/Borivali, PF 3 Virar, PF 4 Churchgate (fast).** |
| `mira-road-station-platform3-…jpg`, `…platform-4-sign-board.jpg` | Single-line green platform indicators ("C 01:17 F 01") and their printed Hindi header; blue-painted canopy undersides |
| `miraroad_exit.png` (assets/) | The exit board at the south end of the PF 2/3 island, between the two tracks: "मीरा रोड / मीरा रोड MIRA ROAD" on yellow, in a brown steel frame on two posts under a little hood |
| `2.jpeg`, `11.jpeg`, `12.jpeg`, `9.jpeg` | Yellow corrugated FOB board, blue "3"-style platform numbers, the old diamond board with "Caution 25000 volts", fences between tracks, tactile strips, twin steel bins |
| OpenStreetMap (`data/mira-road.raw.json`, ODbL) | Platforms, tracks, the deck, FOBs and skywalk with every flight of stairs, the forecourt polygon, the auto-stand lot, the approach road loop, Naya Nagar / Shrikant Dhadwe / Poonam Sagar / Mira Road streets, 480 building footprints |

Photos are used for reconstruction only, never as textures. Every surface, sign and board is painted in code.

## 2. Layout (east side, where the town is)

- **Tracks, west to east:** PF 1 | down slow, up slow | PF 2 / PF 3 island | down fast, up fast | PF 4.
  This matches left-hand running and the hall board. The platform faces follow OSM's tracks. OSM's
  platform outlines don't line up with the tracks (the old PF 1 overlapped its track, and PF 4 was
  a 17 m wide rectangle), so only their back edges are used.
- **Booking hall:** directly behind the arcade at platform level, open to PF 4 on its west side.
  Coming in from the forecourt, the booking office is on the right (north end): five windows,
  two ATVMs, queue rails, the all-platform board and clocks. At the south end, stairs lead up to
  the southern foot-over-bridge (OSM steps 1410033849).
- **Overhead:**
  - the station deck across the north end;
  - three foot-over-bridges;
  - the walkway along the east side over the hall;
  - the skywalk east over the auto stand to Shrikant Dhadwe Road, with its three exits.
  All 22 OSM flights of stairs are built. From the hall you reach every platform: via the FOB for
  PF 1–3; PF 4 is at hall level.
- **Forecourt:** the war memorial and fountain on the cobbles, bollards along the street edge
  with three gaps. The approach road loops round a planted median, kerbed on both carriageways'
  edges, its nose at the U-turn by the forecourt; footpaths run only on the loop's outside. The
  auto stand and bike lot are north of it, and the MBMT bus stop is on its north side.

## 3. What is built

- **Exterior:** the arcade (7 arches), pediment and plaque, steps, return bays, and four hoardings
  (fictional ads). Roads come from OSM with paver footpaths and yellow-and-black kerbs near the
  station, lane dashes and a zebra crossing. The approach median carries tall twin lights, and
  there's a high mast at the junction end.
  - About 280 shop units on the buildings facing the streets: fictional signboards lit at night,
    painted interiors, shutters, awnings and goods.
  - Hawkers' carts, utility poles with sagging cables, and trees.
  - The auto stand: about 90 autos in five railed lanes, with a drivers' shelter.
  - The pay-and-park: about 380 two-wheelers (with the ones at the forecourt ledge), with its rate board and booth.
  - An MBMT bus at the stop, parked cars, and the goods tempo on the forecourt.
- **Hall:** Kota stone floor, tiled dados, columns, tube lights, fans, speakers, clocks, posters. The
  PF 4 / way-out / FOB signs are hung for both directions of travel.
- **Platforms:**
  - corrugated canopies on steel columns, with tube lights and fans; cut round the stairs, which
    have their own roofs;
  - blue PF 1–4 numbers near each face;
  - green single-line indicators per platform (live);
  - yellow मीरा रोड boards facing the tracks, and diamond boards with the caution plate;
  - past the south end of the PF 2/3 island's canopy, between the tracks, the exit board in its
    steel frame, facing the trains as they pull out towards Churchgate (the same boards as
    Borivali and Dadar, `journey/StationBoards.ts`);
  - two clocks per platform, steel benches, twin bins, tea stalls, water coolers;
  - the tactile band and the yellow guide strip;
  - fences between the tracks, and overhead-line portals (the line's own portals stopped at the
    station, so its wires used to hang in the air).
- **Life:**
  - **Trains:** locals call at PF 1–3 on a made-up timetable ⚠: they approach, stand 22–34 s with
    their doors open, and pull out. PF 4 is kept for the Churchgate fast you ride.
  - **Boards:** every board reads the same timetable, and PF 4 shows your train.
  - **People:** they pour off each train (evenings: crowds onto PF 1/3) and walk the real route: to
    the stairs, over the bridge, down into the hall, out through the arches to the autos, the bus
    or a footpath. Others walk in the other way and wait on the platforms, and board when their
    train stands.
  - Queues at the windows, people at the ATVMs, sitters on the arcade steps and the forecourt
    ledge, drivers, bus waiters, shoppers.
  - Autos, bikes (with riders), cars, cabs, MBMT buses and tempos drive the approach loop, the
    junction, Naya Nagar Road and the main roads.
- **Walking:** Mira Road has its own collision world. The forecourt steps, hall, all stairs, decks,
  bridges, skywalk and platforms are walkable; the platform edges and parapets hold you back.
- **Lighting:** Mira Road has its own ambient-light map (canopies, hall, decks, lamps), and the
  station's materials switch to it there. Lamps, shop signs and hoardings light up at night.

## 4. Connection to the local train

- **Explore Mira Road** (menu): start on the forecourt. A Churchgate fast is due on PF 4 about
  2½ minutes later (the boards show it). Walk to PF 4 through the hall; it waits while you are on
  the platform. Walk in through an open door of the second coach from the front (south end; hints
  tell you) and the ride takes over. Other coaches are "packed". Miss it, and the next one comes
  7 minutes later.
- **Ride the local** (menu) now starts the same way, on PF 4 with the train coming in, but you walk
  aboard on the real platform instead of the old strip.
- **The film** is unchanged in its shots; its opening camera moved onto the median, clear of
  traffic.

## 5. Uncertain, or not modelled (⚠)

- **"Bear statue":** I read this as "near the statue/landmark". The landmark modelled is the war
  memorial in `outside/0_1` (the most recent photo). `5.jpeg` (2017) shows a white obelisk with an
  eagle and two figures on a saffron rock in the same place, which the memorial seems to have
  replaced. `outside/1.jpeg` shows an equestrian statue on a traffic island, but its location near
  the station can't be verified, so it isn't modelled.
- **Positions:** the memorial, fountain, auto lanes, bike lot, bus stop and shop units are placed from
  the photos; OSM doesn't map them.
- **Hall:** its interior layout is inferred from your description and the photos. Its 14 m depth,
  the ceiling height and the booking office's size are estimates.
- **East walkway:** OSM puts its centre line over the facade; it is moved about 4 m back behind the
  pediment, as the photos show.
- **Train service:** the timetable, frequencies and destinations are made up, following the
  photo's pattern. Platform numbering follows the hall board photo.
- **Names and ads:** every shop, advert and hoarding is fictional. Public signs (MBMC, MBMT, Western
  Railway) are shown as public signage.
- **West side:** not modelled beyond PF 1 (the town is on the east side).

## 6. Code

`src/world/miraroad/`:

| File | What it builds |
|---|---|
| `MiraCtx.ts` | Shared context, heights, helpers |
| `MiraMaterials.ts` | Textures and materials |
| `MiraSigns.ts` | All sign artwork |
| `MiraBoards.ts` | Timetable and LED boards |
| `MiraFront.ts` | Arcade, steps and hall |
| `MiraPlatforms.ts` | Platforms, canopies, dressing and portals |
| `MiraDeck.ts` | Walkways, stairs and the walking graph |
| `MiraStreets.ts` | Roads, forecourt, memorial, auto stand, bikes, bus stop, shops, lamps, trees |
| `MiraVehicles.ts` | Vehicle models |
| `MiraLife.ts` | Train service, crowd and traffic |

`src/world/journey/MiraRoad.ts` assembles them. `App.ts` handles walking there and boarding.

## 7. Performance

Measured in headless Chrome on the same integrated GPU as the README:

- Mira Road runs at 40–45 fps (up to 53 at night) at a 0.6–0.8 resolution scale. That is about
  3–4 ms per frame over the 60 fps budget at 0.8, comparable to Churchgate's concourse. The crowd,
  the station geometry and shadows each cost about 3.5 ms.
- Distant people use the low-detail model and are culled beyond 135 m.
- Small props don't cast shadows.

## 8. Status

First version of this pass, for you to explore. The local-train ride itself is unchanged apart from
how you board.
