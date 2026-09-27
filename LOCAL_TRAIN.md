# Mira Road → Churchgate by Mumbai local (milestone 4)

Goal: the player feels they really travelled to Churchgate by Mumbai local. They:
1. start at Mira Road station and board a Churchgate-bound local
2. ride it
3. arrive in the existing Churchgate station
4. carry on to Marine Drive and Nariman Point

The build is a polished vertical slice, not the whole network. Only Mira Road (kept simple) and the existing Churchgate are modelled as stations.

Facts marked **⚠** are general knowledge or estimates, not taken from a source in this repo.

## 1. Sources

| Source | Used for |
|---|---|
| `assets/trains/external/*` (6 photos) | Livery, cab front, car proportions, roof, underframe |
| `assets/trains/doors_sides/*` (6) | Doorways, sliding door leaves, class markings, window shutters, passengers hanging out, exterior ad panels |
| `assets/trains/internal/*` (5) and `passengers/1` | Seats, floor, poles, grab rails and loops, partitions, fans, tube lights, LED displays, passenger density |
| `assets/trains/churchgate_arrival/*` (7) | Roofs from above, arrival under the Churchgate shed, the platform crowd |
| `assets/miraroad/*` and `miraroad/outside/*` (20 photos and screenshots) | Station name boards, canopies, the foot-over-bridge and deck, the arched station front with its skywalk, the war memorial, the forecourt and auto stand |
| OpenStreetMap (ODbL): `data/osm/western-line.raw.json` (tools/fetch-osm-railway.mjs) | The real Western Railway alignment. `tools/build-railway.mjs` extracts one smoothed main-track centre line from Churchgate to Mira Road: **39.97 km**, with 23 stations on it (`public/data/western-line.json`). |
| OpenStreetMap: `data/osm/mira-road.raw.json` (tools/fetch-osm-miraroad.mjs) | Mira Road's platforms (PF 1, PF 2/3 island, PF 4, each ≈360 m long), foot-over-bridges, the station deck, the skywalk to the east exit, streets |
| Existing `back-bay.geo.json` | Real buildings and coastline along the last ≈5 km into Churchgate (Grant Road → Charni Road → Marine Lines) |

Photos are used for reconstruction only, never as textures; several are watermarked.

## 2. The train: what makes it read as a Western Line local

**Exterior** (external 1, 3, 4, 6; doors_sides 2, 4, 6):
- **Body:** off-white, with a broad **violet/purple lower band**.
- **Lettering:** huge white **"WR"** letters on the purple band, **"पश्चिम रेलवे"** in white Devanagari, and **"WESTERN RAILWAY"** in small black type above the windows. Car numbers such as "6052A" at the car ends.
- **Class marks:** black **"II"** beside each second-class doorway. First-class doorways have **yellow frames**. Some cars carry vinyl ad panels between the doors.
- **Windows:** rounded rectangles in grey frames, with **horizontal louvred shutters** (often half-lowered) and a wire-mesh or bar grille. There is no glass on second class **⚠**.
- **Doorways:** three per side, ≈1.3 m wide, a metal footstep below. **Sliding door leaves are left open while running**, and passengers stand and hang out of the doorway holding the centre pole. The model has working door leaves and opens and closes them at stations. On non-AC locals in practice they mostly stay open **⚠**.
- **Cab front:**
  - yellow upper face with two large windscreens and wipers, and **twin round headlamps** above them
  - orange-on-black **destination displays** ("CHURCHGATE")
  - a black band with round marker lamps
  - the **red-dot plate** and the **red X plate**
  - a white unit number ("5006")
  - a thin purple stripe with the unit number
  - a grey skirt with a horizontal-bar **pilot grille**, buffers and a centre coupler
- **Roof:** light grey, with rows of rounded ventilator cowls. Motor coaches carry a single-arm pantograph.

**Interior** (internal 1, 3, 5):
- **Seats:** transverse bays. Two facing benches either side of an aisle, three seats each (a fourth person squeezes in). Benches are **navy-blue** with a lighter stripe, on stainless steel frames, and their backs are stainless panels.
- **Floor:** aluminium **chequer plate**.
- **Walls and ceiling:** pale grey/cream laminate walls. The ceiling is white, with **caged ceiling fans** in two rows and fluorescent **tube lights** in covered strips along both sides.
- **Handholds:** two stainless **longitudinal grab rails** along the ceiling with dozens of **hanging triangular handles**. Stainless **vertical poles** at bay ends and in every doorway. Curved **tube-bar partitions** separate the door vestibules from the seating bays.
- **Racks and fittings:** stainless luggage racks above the windows. A red **LED passenger information display** above the vestibule, route and notice panels, ad stickers.
- **Crowd:** evening, towards Churchgate (against the peak flow). Seats full, people standing in the aisle holding the loops, a few in the doorways, a vendor now and then **⚠**.

**Dimensions** (existing `CAR`, unchanged): car 20.5 m, pitch 21.1 m, width 3.66 m, floor 1.2 m above rail, 12-car rake. Churchgate's own trains keep their geometry; the shared livery and cab-front painters are upgraded, so every train matches.

## 3. Mira Road (kept simple; superseded by [MIRA_ROAD.md](MIRA_ROAD.md))

From OSM and the photos:
- **Platforms:** PF 1, the PF 2/3 island and PF 4, each ≈360 m long, with **corrugated-sheet canopies** on steel columns and tactile yellow edge strips.
- **Station name boards:** yellow boards reading **"मीरा रोड / MIRA ROAD"** in black, and the diamond caution board.
- **Crossings:** two foot-over-bridges and an elevated **station deck** at the south end, joined by the **skywalk** to the east exit.
- **East front:** a cream **arcade of round arches**, reached up steps from a cobbled forecourt. The forecourt holds the **war memorial** (two soldiers raising the national flag between tall curved steel blades) and an **auto stand**.

Built:
- the east forecourt and arcade (facade only)
- the memorial, simplified
- the skywalk and deck to **PF 4** **⚠** (which platform Churchgate trains use is not in the sources; PF 4 on the east side is assumed)
- PF 4's canopy and boards
- the tracks, with the other platforms beyond

No interiors beyond the passage from the arcade to the deck.

## 4. The route and the time problem

The real journey is ≈40 km and takes 60–80 minutes **⚠**. It is shown as a **controlled journey** along the **real alignment**, in five real-time stretches joined by short dissolves ("time passes"). The clock jumps by the skipped travel time, so the train leaves Mira Road at ≈17:15 and pulls into Churchgate in golden hour, ≈18:10.

| Stretch | Arc length (km from Churchgate) | Scenery |
|---|---|---|
| A. Departure | 39.96 → ≈38.3 | Mira Road platform, then the **salt pans and mangroves** towards Dahisar |
| B. Suburbs | ≈29.6 → 28.7 (Malad) | Dense 4–8-storey buildings, trackside homes with tin roofs and blue tarps, walls with ads, a road over-bridge, locals passing the other way. **Malad** platforms flash past (fast trains do not stop **⚠**) |
| C. Mahim Creek | ≈14.2 → 13.2 | The bridge over the creek and mangroves, the Bandra skyline |
| D. Mid-town | ≈7.6 → 6.6 (Lower Parel) | Old mill chimneys, new glass towers |
| E. The approach | ≈2.3 → 0 | **Real OSM buildings and coastline**: Charni Road beside Back Bay, Marine Lines, then under the Churchgate shed to PF 3 |

Since milestone 4c the train also **stops at Borivali (PF 5) and Dadar (PF 4)**, each a stretch of
its own between A and B and between C and D: it runs in, stands with its doors open while people
get off and push on, and leaves. See [HALTS.md](HALTS.md).

Stretches A–D are dressed procedurally (tracks, overhead line masts and wires, walls, trackside homes, buildings, trees), streamed around the train. Stretch E uses the existing real city data plus the same trackside dressing. The Churchgate approach tracks bend onto the real curve north of the station, instead of the straight line used in milestone 1.

## 5. Arrival and hand-over

The player's train *is* the train arriving on PF 3. The station's timetable leaves PF 3 free. The rider's train stops at the buffers, the platform crowd pours out of its doors, and the player steps off:
- **In the film:** into the existing Churchgate shots (walk down the platform, the concourse, the west exit, V.N. Road, Marine Drive, Nariman Point).
- **In the interactive ride:** into explore mode on PF 3.

## 6. Interaction

- **Film:** Mira Road → Churchgate → Marine Drive → Nariman Point, one continuous film.
- **Interactive ride ("Ride the local"):**
  - Start on the Mira Road platform and walk into the train when it stops.
  - Inside, walk the car, stand in the doorway or sit, and look around freely while it runs.
  - At Churchgate, step out onto the platform.
  - Between stretches the ride dissolves forward in time; a key skips ahead.

## 7. Uncertainties

- **Up platform at Mira Road:** PF 4. Confirmed by the hall board photo (`assets/miraroad/mira-road-station-train-schedule-board-mumbai-local.jpg`: PF 4 Churchgate, F).
- **Stops:** the train stops at Borivali and Dadar (HALTS.md). Its other stops (Dahisar, Andheri, Bandra, Mumbai Central) fall inside the dissolves. **⚠**
- **Journey time** and the exact timings. **⚠**
- **Second-class window glazing:** shown open with shutters and grilles. **⚠**
- **Door leaves:** mostly open in service; closing them at stations is a stylisation. **⚠**
- **Scenery in stretches A–D** is generic for each area (no building data beyond Grant Road). The salt pans, Mahim Creek and the mill chimneys are real features, placed approximately. **⚠**
- **Rake details:** car numbers, the ads (fictional brands) and the ladies-car position. **⚠**

## 8. Status: first version (for testing)

**Built:**
- **Railway** (`src/world/journey/Railway.ts`): the OSM alignment from north of Mira Road to Churchgate's PF 3 buffers as one path (44.4 km, sampled every metre in double precision). It carries four lines: Mira Road's real layout (OSM), then four open-line tracks 4.8 m apart **⚠**, then the fan into Churchgate's four platform roads. Churchgate's own trains now come in along the real curve instead of a straight line, and the land is cut away for the railway (it used to cover the ballast north of the shed).
- **Corridor** (`Corridor.ts`, `Journey.ts`), built for five stretches:
  - Common to all stretches: ballast and sleepers, rails, overhead-line portals with contact wire and messenger, boundary walls with painted (fictional) ads.
  - A: salt pans and mangroves, and the plate-girder bridge over the creek (OSM position, u 39.05 km).
  - B: Malad's suburbs, trackside homes (tin roofs, blue tarps, washing), a road over-bridge, and Malad's platforms.
  - C: Mahim Creek and its bridge, with mangroves.
  - D: Lower Parel's mill sheds, chimneys and towers, and its platforms.
  - E: from Grant Road on, the real OSM city beside the tracks, with Charni Road's and Marine Lines' platforms.
- **Mira Road** (`MiraRoad.ts`, from OSM):
  - The three platforms, with canopies and yellow मीरा रोड / MIRA ROAD boards.
  - The elevated deck and foot-over-bridges with their stairs, and the skywalk.
  - The booking office's arcade of round arches onto the east forecourt, a simplified war memorial with the flag, and the auto stand.
  - The town's 481 buildings, and about 260 commuters who walk to the doors and board.
- **The ride** (`Ride.ts`):
  - The 12-car rake, with car 1 drawn in detail (HeroCar).
  - Doors: closed coming into Mira Road, open at the stop, shut to start, then slid open again by passengers once running.
  - The car's sway and lean on curves, the hanging handles swinging with it, and a scrolling LED display (next station).
  - Evening passengers: seats mostly full, people standing, door hangers. Heads and door hangers show in the other cars too.
  - A down local passing on the next line, and a slow local alongside to race.
  - At Churchgate, the ride hands over to PF 3's arrival, so the station's crowd pours out of this train.
- **Film**: Mira Road front, platform, boarding, departure, then one shot per stretch with dissolves, then the arrival under the shed and the existing Churchgate → Marine Drive → Nariman Point film. The clock follows the ride: it leaves Mira Road about 1 h before the chosen time **⚠** and reaches Churchgate at that time.
- **Ride the local** (menu):
  - The train waits at Mira Road until you board.
  - Inside: walk the aisle, vestibules and doorway, sit on a free seat (`E`), and skip to the next stretch (`N`).
  - At Churchgate, walk out of a door into explore mode.
- **Sound**: rumble, clatter and traction whine from under the floor, wind at the doorway, fans, door slides, horns, passing trains, and Mira Road's PA announcement.

**Simplified / next:**
- Stretches A–D are generic per region **⚠**. Malad, Lower Parel, Charni Road and Marine Lines have platforms the train runs through; Borivali and Dadar are stops (HALTS.md); other stations are skipped by the dissolves.
- Walking in the car passes through other passengers, and nobody boards or alights at Churchgate from the ridden car itself; the station's crowd does.
- Mira Road's west side is not modelled. Since the station pass (MIRA_ROAD.md), the forecourt, hall, bridges and all four platforms are walkable, and you board by walking in.
