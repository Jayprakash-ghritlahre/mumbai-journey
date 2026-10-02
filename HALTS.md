# Borivali and Dadar: stops on the way (milestone 4c)

Goal: make the ride feel like a real Western Railway journey to Churchgate. The fast now stops at
**Borivali** and **Dadar** on the way:

Mira Road → Borivali (stop) → Dadar (stop) → Churchgate.

You stay aboard at both stops. The stations are not walkable. They are short, living railway
moments seen from inside the train:

1. the station comes up
2. the train brakes along the platform
3. the doors open
4. people get off and push on
5. the station PA calls the train
6. the guard's bell rings
7. the doors close and the train pulls out

Each station has its own look, taken from its own references, so neither reads as a generic
platform.

Facts marked **⚠** are estimates or general knowledge, not taken from a source in this repo.

## 1. Sources

| Source | Used for |
|---|---|
| `assets/borivali_entrace_from_miraroad.png` | The tan corrugated board over the north end of the canopy, reading "बोरीवली  BORIVALI  बोरीवली". It is the first thing you see coming in from Mira Road. Also the dark steel canopy on teal-grey box columns, the red fence between the tracks, and the tall towers close by. |
| `assets/Borivali_platformboard.jpg` | The WR diamond board on a column: a white diamond with a red ring, a navy bar with a white "बोरीवली" on it, "बोरीवली" above and "BORIVALI" below, on a grey backing plate. The pillar number is painted beneath ("31"). Also the red-brown fences between the tracks. |
| `assets/borivali_exit_towards_churchgate.jpg` | The Churchgate end: the yellow "बोरीवली / बोरीवली BORIVALI" board on white posts, the red-and-cream paving, the big concrete pier, the barrel-roofed canopy with its orange underside, and the platform tapering off. |
| `assets/dadar.jpeg` | Dadar: the blue board with a white border and cream "दादर / DADAR" lettering hung from the canopy trusses, the old steel-truss canopy with its white valance, a green train indicator, and the packed, narrow platform. |
| `assets/dadar_entry.png` | Coming into Dadar: the mustard corrugated board over the canopy end reading "दादर  DADAR  दादर", and in front of it the yellow "दादर / दादर DADAR" board in a dark-brown frame on yellow posts. |
| `assets/dadar_exit.jpg` | Leaving Dadar: the rounded yellow "दादर / दादर DADAR" board on white posts with black feet, where the platform runs out into the open. |
| Western Railway, via [Borivali railway station (Wikipedia)](https://en.wikipedia.org/wiki/Borivali_railway_station) and [Mumbai Wiki](https://mumbai.fandom.com/wiki/Borivali_Railway_Station) | Borivali has 10 platforms, numbered west to east. **PF 5 takes the Churchgate-bound fast locals** (as you asked). |
| [Dadar railway station (Wikipedia)](https://en.wikipedia.org/wiki/Dadar_railway_station), [Free Press Journal on Dadar PF 4](https://www.freepressjournal.in/mumbai/dadar-station-platform-4-to-be-extended-for-15-coach-fast-locals-under-western-railway-expansion-plan) | Dadar has 7 Western and 7 Central platforms. Fast locals use PF 4, and 15-car fasts use PF 5 for now. The ride stops at **PF 4**. |
| OpenStreetMap, `public/data/western-line.json` | Where the stations are on the real line: Borivali at 34.07 km from Churchgate, Dadar at 10.27 km. |

The photos are used for reconstruction only, never as textures. Every sign is painted in code.

## 2. What happens at each stop

The stop sequence is the same at both stations. It is scripted from the ride's clock, so the film
and the interactive ride show the same thing every time.

1. **Coming in.** After the dissolve, the train runs in at 17 m/s (≈ 60 km/h) and brakes hard
   along the platform ⚠. It stops with its front near the Churchgate end, where the exits are.
   The car's PA says "पुढील स्टेशन बोरीवली · अगला स्टेशन बोरीवली · Next station Borivali. Doors will
   open on the left side" ⚠. Facing Churchgate, the platform is on your left.
2. **Doors.** On non-AC locals the leaves are mostly left open. Here they slide shut as the
   train comes into the platform, and the door hangers step back inside. The doors open at the
   stop, shut before the start, and are pushed open again as soon as the train rolls. The same
   stylisation is used at Mira Road ⚠.
3. **Standing.** 28 s at Borivali and 32 s at Dadar ⚠.
   - The waiting crowd stands bunched where each door will stop, as commuters do. They leave
     the middle of the doorway clear.
   - People get off first, one after another, and head for the bridges or the platform ends.
   - Then the push on. Anyone still outside when the doors start closing is left behind.
   - In your own car, a few standers make for the doors before the stop and step off. New
     passengers come in and take the free standing room, so the car changes from stop to stop.
     Borivali sends in more than it takes. At Dadar many get off for the Central line ⚠.
4. **The station.** The PA chimes and calls the train, in Marathi, Hindi and English:
   - Borivali: "…platform number five is a Churchgate fast local, halting at Andheri, Bandra,
     Dadar and Mumbai Central" ⚠.
   - Dadar: "…for Central Railway trains, please use the foot over bridge".

   The green indicators show your train ("C 17:29 F 12") and the next one on the other face.
5. **Leaving.** The guard's bell rings twice, the horn sounds, and the train pulls out past the
   platform end. The LED display switches to the next station: Andheri after Borivali, Mumbai
   Central after Dadar.

**Other trains:**
- **Borivali:**
  - an Andheri slow standing at PF 6, doors open, people in its doorways;
  - a Virar fast running into PF 4 while you stand;
  - a down train passing after you leave.
- **Dadar:**
  - a 15-car fast at PF 5;
  - a Virar fast pulling out of PF 3 while you are still standing. It gives the classic "are
    we moving?" moment.
  - a Central Railway local running in beyond the fence.

## 3. The stations

**Track layout** (both stations, ⚠ simplified). The ridden line stops at the west face of an
island platform. Either side of the platforms the lines step aside (turnouts are not modelled)
for:
- an island between the two western lines;
- extra roads that exist only at the station: sidings with buffer stops, and Dadar's Central
  Railway lines.

**Borivali:**
- **Platforms:** from west to east, the PF 1/2 island, the PF 3/4 island, then your train at
  **PF 5** on the PF 5/6 island (11 m wide).
- **Signs, north end:** the tan board "बोरीवली  BORIVALI  बोरीवली" over the canopy end, leaning back
  as in the photo. It also appears over PF 3/4's canopy.
- **Canopies:** long corrugated roofs on a single row of teal-grey box columns, with steel
  brackets, tube lights and fans.
- **Diamond boards:** on every third column, facing both tracks, with pillar numbers painted
  beneath. One is right outside your car's rear door, on pillar 38.
- **The Churchgate end, as in the exit photo:**
  - red-and-cream paving;
  - the yellow "बोरीवली / बोरीवली BORIVALI" board on white posts;
  - a big hammerhead concrete pier. It stands for the new deck under construction ⚠; what it
    will carry is not known from the photo.
  - PF 3/4 has the barrel-roofed canopy with its orange underside.
- **Around the tracks:**
  - red-brown fences between the tracks;
  - blue platform numbers hung at the eaves;
  - caution plates at the platform ends;
  - benches, twin bins, tea and vada-pav stalls, water coolers;
  - two foot-over-bridges with stairs down to the islands, and fictional ads on their sides.
- **Surroundings:** tall residential towers close to the station on both sides.

**Dadar:**
- **Platforms:** narrow 8 m islands.
  - PF 1 is a side platform.
  - PF 2/3 is an island.
  - Your train stands at **PF 4** on the PF 4/5 island.
  - A tall fence separates them from the Central Railway's island and its two roads to the east.
- **Canopies:** old full-length roofs with lattice trusses, pairs of slim cream posts, a white
  valance, and tube lights and fans. The Central side's posts are painted red-oxide ⚠.
- **Boards:** blue "दादर / DADAR" boards hung from the trusses facing the tracks, and a blue
  "मध्य रेल्वे · CENTRAL RAILWAY" board on the Central platform.
- **Coming in and going out, as at Borivali:** the mustard "दादर DADAR दादर" board over the north
  end of the PF 4/5 canopy, with the framed board on yellow posts in front of it on the PF 4 side
  (dadar_entry.png). Past the south end of the canopy is the rounded yellow board on black-footed
  white posts (dadar_exit.jpg). Both boards on posts face along the line, towards the train
  running at them, and read on both sides.
- **Bridges:**
  - three foot-over-bridges with stairs onto every island, landing mid-platform (the Dadar
    squeeze);
  - **Tilak Bridge**, the road bridge over the north end, which you pass under coming in ⚠
    (its position is from general knowledge).
- **Crowd:** the densest of the journey. It is packed round the doors and thick along the
  islands.
- **The flower market:** rows of stalls under blue and orange tarps with heaps of marigold and
  chrysanthemum, beyond the west wall ⚠ (placed from general knowledge).
- **Surroundings:** old 4–7 storey blocks and chawls, with a few new towers.

## 4. Interaction

- **Film:** each stop has three shots.
  1. Leaning out of the doorway as the station comes up: Borivali's name board over the canopy;
     at Dadar, under Tilak Bridge and onto the platform.
  2. The vestibule as the doors open on the rush.
  3. Pulling out past the platform end, with Borivali's yellow board and the pier.

  Each stop has a title card and a subtitle. The film is about 1:45 longer.
- **Ride the local:**
  - The stops happen as you ride.
  - Stand in the doorway to watch, or sit.
  - You cannot get off. The hint says "Borivali · platform 5 · stay aboard: this train runs on to
    Churchgate".
  - `N` still skips ahead.

## 5. Uncertain, or not modelled (⚠)

- **Platform layouts** beyond the ride's platform: which lines serve which faces, and how wide
  the islands are. Borivali's PF 7–10 and Dadar's PF 6–7 are not built. The Central platforms
  carry no numbers.
- **Dadar PF 4 for the up fast.** It is inferred from the article (fast locals use PF 4), not
  stated outright.
- **Timings:** braking, dwell times, and the time skipped by the dissolves (the clock assumes
  about 10 m/s overall).
- **Announcements:** the wording of the car's PA and the station PA, and the list of stops.
- **Door behaviour:** see §2.
- **The pier at Borivali:** what it belongs to. The flower market's exact position. Where Tilak
  Bridge crosses.
- **Names and ads:** every ad and stall name is fictional. Western Railway and Central Railway
  signs are shown as public signage.
- **Borivali's station buildings,** its skywalk and the rest of the town are not modelled beyond
  the towers.

## 6. Code

| File | What it does |
|---|---|
| `src/world/journey/Railway.ts` | `halts`: the two stations, and the track layout that spreads round the islands. Lines 5–7 are the extra roads, which exist only at the halts. |
| `src/world/journey/Halts.ts` | Builds a station: platforms, canopies, bridges and stairs, signs, fences, buffer stops, the station's own marks, the surroundings, and the live indicators. |
| `src/world/journey/StationBoards.ts` | The name boards seen coming in and going out: the corrugated fascia over a canopy end and the board on posts, drawn in each station's colours. Borivali, Dadar and Mira Road use the same boards. |
| `src/world/journey/HaltLife.ts` | The crowd, as a function of time since the stop: waiting, getting off, pushing on, pacing, going up to the bridges. |
| `src/world/journey/Ride.ts` | The two stopping legs (`BO` and `DA`): motion, doors and LED. Also who gets off and on the ridden car, and the other trains at the platforms. |
| `src/world/journey/Journey.ts` | The `BO` and `DA` stretches, each built with its station. |
| `src/world/journey/RideJourney.ts` | The film's shots at the stops. |
| `src/audio/RideAudio.ts` | The car's PA, the station PA, the guard's bell and the horns. |
| `src/camera/RideControls.ts` | The "stay aboard" hints. |
| `src/app/App.ts` | Switches the materials to a station's light map while the ride is there (as for Mira Road). |

**Lighting.** Each station has its own ambient-light map, as Mira Road does. By day it gives
shade under the canopies and bridges. At night the tube lights, and the lamp posts on the open
platform ends, light the platforms and the crowd.

## 7. Performance

Measured in headless Chrome on the same integrated GPU as the README:

| Scene | fps |
|---|---|
| Plain line (Malad) | 60 |
| Borivali stop | 45–52 |
| Dadar stop | 34–40 |

The crowd is most of the cost at Dadar. To keep it down:
- people have full detail only within 20 m;
- there are fewer of them beyond 60 m, and none beyond 125 m;
- the crowd casts no shadows (the platforms are under canopies).

The crowd renderer now uploads only the figures in use each frame. This also helps Mira Road
and the car.

## 8. Status

First version, for you to ride and watch. Everywhere else the ride is as before, with two small
changes: the car's passengers now change at the stops, and when the doors are shut the door
hangers now stand in the vestibule instead of disappearing (this shows at Mira Road too).
