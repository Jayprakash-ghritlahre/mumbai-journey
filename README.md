# Mumbai Journey

An interactive, browser-based recreation of travelling from Mira Road to Marine Drive:

**Shanti Nagar → by auto → Mira Road station → Mumbai local → Churchgate → Marine Drive → Nariman Point**

**Milestone 1: Churchgate station.** A standalone vertical slice with a cinematic arrival,
a walkable station and the streets around it, five times of day (morning, afternoon, golden hour,
evening, night), and a procedural soundscape.

**Milestone 2: Churchgate → Marine Drive.** A continuous walk from the station's
west exit, down IMC Road and along Veer Nariman Road, across Marine Drive to the sea wall.
See [CHURCHGATE_TO_MARINE_DRIVE.md](CHURCHGATE_TO_MARINE_DRIVE.md) for the route analysis
(§11 lists the changes after the first walk-through).

**Milestone 3: Marine Drive → Nariman Point.** The promenade continues
south past the Air-India Building, Express Towers, the Trident and The Oberoi to the tip by the
NCPA, where the film ends looking back at the Queen's Necklace as the lights come on.
See [NARIMAN_POINT.md](NARIMAN_POINT.md).

**Milestone 4 (this build, first version): Mira Road → Churchgate by Mumbai local.** Catch the
Churchgate fast on Mira Road's platform 4, board through an open door and ride the real Western
Railway alignment (OpenStreetMap) in five stretches: the salt pans and the creek before Dahisar,
the suburbs at Malad, Mahim Creek, the mill lands at Lower Parel, and Charni Road and
Marine Lines. The train rolls in under Churchgate's shed on PF 3, and you step off into the
existing station. See [LOCAL_TRAIN.md](LOCAL_TRAIN.md).

**Borivali and Dadar stops (this build, first version).** On the way the fast stops at
Borivali (PF 5) and Dadar (PF 4). You stay aboard and watch it brake along the platform. The
doors open on a crowd bunched where they stop; people get off and push on, the PA calls the
train, the guard's bell rings, and the train pulls out. Borivali has its tan name board over the
canopy end, diamond boards on the columns, red-and-cream paving and the pier at the Churchgate
end. Dadar has its blue boards, its mustard name board over the canopy coming in and the yellow
board at the far end going out, narrow packed islands, Tilak Bridge and the Central Railway
beside it. See [HALTS.md](HALTS.md).

**Mira Road station pass (this build, first version).** Mira Road is now an explorable suburban
station: the sandstone arcade with its pediment and plaque, the forecourt with the war memorial,
the auto stand, the pay-and-park, the bus stop, and shop-lined streets with traffic. Inside are
the booking hall with its ticket windows, ATVMs and train board, and four numbered platforms with
live indicators, clocks and benches. The foot-over-bridges, deck and skywalk are all walkable.
Locals call at PF 1–3 and crowds pour off them; you catch the Churchgate fast on PF 4 by walking
aboard. See [MIRA_ROAD.md](MIRA_ROAD.md).

**The auto to the station (milestone 5, first version).** Leave your building in Shanti Nagar,
Sector 2, and wave down a black-and-yellow auto. Ride it as a passenger through the sector's lanes,
west past Sector 1 and up Poonam Sagar Road, past its median and shops, to the signal at the
station junction. The auto turns into the approach and drops you at the forecourt; you pay and walk
into the station. The route follows the real streets (OpenStreetMap). See [AUTO_RIDE.md](AUTO_RIDE.md).

## Run it

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm run build        # type-check + production bundle in dist/
npm run preview      # serve the production bundle
```

Requires Node 18+ and a WebGL2 browser (Chrome, Edge, Firefox or Safari 16+).

## Controls

| | |
|---|---|
| **Start journey** | Cinematic (~10 min): Mira Road station, the Churchgate fast coming in, boarding, the ride down the Western line (dissolves skip the hour-long journey), and the arrival on Churchgate's PF 3. You get off, walk down the platform and out of the west exit, then along V.N. Road into the sunset. You wait for the green man, cross Marine Drive and reach the sea wall, then stroll on to Nariman Point as night falls. `Esc` / Skip ends it; the end card offers **Keep walking from here**. |
| **Auto to the station** | Start inside your society's gate in Shanti Nagar. Walk out to the lane; at the kerb press `E` (or wait) and an auto pulls up beside you. `E` (or step in on the left) to get in. Then you ride: mouse to look round from the seat, `N` to skip to the next stretch. At the forecourt `E` pays ₹26 and you step out to carry on on foot (the Churchgate fast is due in about 2½ minutes). `T` changes the time of day. |
| **Explore Mira Road** | Start on the station forecourt. Walk up the steps into the booking hall, over the bridges to any platform, along the skywalk or out to the auto stand. The Churchgate fast is due on PF 4 in about 2½ minutes (the boards show it). It waits while you are on PF 4; board it through an open door of the second coach from the south end. Miss it, and the next one comes in 7 minutes. |
| **Ride the local** | Start on Mira Road's PF 4 as the train comes in; it waits for you. Walk in through an open door of your coach (the second from the south end). Inside: `W A S D` move (the aisle, the vestibules, the open doorway), mouse look, `E` sit on a free seat or stand up, `N` skip to the next stretch. The train stops at Borivali and Dadar (you stay aboard). At Churchgate, walk out of a door onto the platform and carry on on foot. |
| **Explore Churchgate / Marine Drive / Nariman Point** | Click to capture the mouse. `W A S D` walk, `Shift` run, mouse look, `T` cycle time of day, `F` fly mode (`E`/`Q` up/down), `` ` `` performance stats, `Esc` menu. Touch: left third of the screen moves, the rest looks. The whole route is walkable. |

## Technology

**Three.js (r186) + TypeScript + Vite**, with `postprocessing` and N8AO.

- Almost everything here is generated from code: architecture from real footprints,
  crowds, trains, traffic and signage. Three.js gives direct control over geometry,
  instancing and shaders, without an editor or asset pipeline in the way.
- Instancing, custom shader patches, and screen-space AO give the look at a frame rate
  integrated GPUs can hold. Babylon.js would also work; Three.js was chosen for the
  lighter runtime and the post-processing ecosystem.
- Downloads are about 385 KB of gzipped JS plus about 680 KB of map data. Every texture,
  mesh and sound is generated at startup, so there is no large asset download.

## What is real, and what is approximated

**Real (from OpenStreetMap, © OpenStreetMap contributors, ODbL):**
- The route's roads, carriageways, crossings and signals, the Marine Drive curve and
  coastline, and the Back Bay skyline (Nariman Point, Malabar Hill, Girgaon) from
  `data/osm/back-bay.raw.json`.
- The station's position, orientation (tracks at a true bearing of ~351°) and platform
  arrangement: four terminating tracks with platforms on both sides of every track.
- Every building footprint, road, footpath, tree and street-lamp line in about a 1 km area.
  This includes the station building, the Western Railway HQ, Eros Cinema, the
  Veer Nariman Road / M.K. Road junction, IMC Road and the Oval Maidan.
- Building heights, where OSM has `building:levels`.

**Real (computed):** sun position via the NOAA solar algorithm for Churchgate. The
journey is set on 20 April, when the sunset lines up with Veer Nariman Road towards
Marine Drive.

**Modelled from reference photographs (original geometry, no copied imagery):**
- The long pointed-arch steel train shed, with green-grey lattice trusses, skylight
  strips and louvred clerestories.
- Platforms: tactile strip, white coping edge and yellow line.
- Stainless buffer-stop railings, Indian Railways trilingual yellow boards, blue platform
  numbers, and dot-matrix train indicators showing a live timetable.
- The WR Siemens EMU livery (cream and violet, yellow cab), fans, pendant lamps, and
  clutter (paan stains, gum, litter).

**Approximated:**
- Generic buildings use a facade generator (Art Deco, 1970s grille, Indo-Saracenic stone,
  shopfronts), not per-building detail.
- Crowds are procedural people with a simple walk cycle. Build, face, skin, hair and clothes vary
  per person, and couples, friends and families go about together (CHURCHGATE_TO_MARINE_DRIVE.md §12).
- All brands and adverts are fictional, except the shops facing Mira Road station on the auto ride's
  approach, which are the real businesses there (AUTO_RIDE.md).
- Only the Eros Cinema and the WR HQ dome are hand-modelled landmarks so far.

## Architecture

```
src/
  app/App.ts                 modes (menu / cinematic / explore), game clock, test API
  core/                      Engine (renderer, post chain, shadows, dynamic resolution),
                             Input, Collision (floors + oriented boxes), Solar, RNG/noise
  gfx/                       sky, time-of-day palettes, fog + volumetric sun shafts, grading,
                             procedural textures (concrete, tiles, ballast, roofing, decals),
                             signage and LED atlases, facade texture array, "ambient volume"
                             (top-down baked sky-visibility / lamp map used by every material)
  world/churchgate/          Layout (all station dimensions), Shed, Platforms, Hangings,
                             StationBuilding, Landmarks, ChurchgateJourney (the cinematic)
  world/city/                OSM-driven buildings, roads, kerbs, trees (incl. banyan, palm), street lamps
  world/journey/             The local-train ride: Railway (the OSM alignment Churchgate → Mira Road
                             as one double-precision path, track layout and throat fan), Corridor
                             (tracks, OHE, walls, bridges, platforms, region dressing, per stretch),
                             MiraRoad (assembles Mira Road), Halts + HaltLife (the Borivali and
                             Dadar stops and their crowds), Ride (schedule, rake, car sway, doors,
                             passengers, stops, Churchgate hand-over), RideJourney (the film's ride shots)
  world/miraroad/            AutoRoute (the auto's lane path on OSM ways), MiraFirstMile + MiraProps (the
                             auto ride's streets: lanes, gates, median, signal, stalls, its traffic and people);
                             Mira Road station: front and booking hall, platforms, decks and stairs,
                             streets and forecourt, signs, LED boards and timetable, vehicles,
                             and the life (locals calling, crowds, traffic); own collision + light map
  world/route/               Churchgate → Marine Drive: RouteLayout (fitted road geometry), VNRoad,
                             MarineDrive (promenade, sea wall, tetrapods), Ocean, Skyline, Signals,
                             DecoDressing (Art Deco corridor, Soona Mahal), props, RouteJourney (film)
  entities/auto/             HeroAuto: the auto you ride, inside and out, its driver and fare meter
  entities/train/            EMU geometry + livery, HeroCar (the detailed coach you ride), Timetable,
                             TrainSystem (arrive → dwell → depart, free trains, the approach curve)
  entities/crowd/            GPU-skinned instanced people, steering, boarding/alighting
  entities/traffic/          left-hand traffic on the OSM road graph, taxis, BEST buses
  audio/                     Web Audio: HRTF-positioned trains, horns, crowd, PA chime + speech
  camera/                    cinematic shot player, first-person walking controls, RideControls (in the car)
tools/
  fetch-osm.mjs              downloads OSM data (Overpass API)  → data/osm/
  build-geo.mjs              converts it to the local metric frame → public/data/
  fetch-osm-skyline.mjs      downloads the wider Back Bay extract (skyline, coastline)
  build-skyline-geo.mjs      builds land polygons + far buildings → public/data/back-bay.geo.json
  fetch-osm-railway.mjs      downloads the Western Railway between Churchgate and Mira Road
  build-railway.mjs          one smoothed main-line centre line + stations → public/data/western-line.json
  fetch-osm-miraroad.mjs     downloads Mira Road station and its surroundings, and Shanti Nagar / Poonam Sagar Road
  build-miraroad.mjs         trims both to public/data/mira-road.osm.json (the second appended, marked ext)
  route-map.mjs              renders docs/route-map.png (the route over OSM data)
  screenshot.mjs             headless-Chrome renderer used for visual QA
```

The TrainSystem runs a timetable that is shared by the indicator boards, announcements
and crowd. When a train arrives, 70–120 passengers pour out of every door onto both
sides. Waiting commuters board once it has stood for a few seconds, and it departs
full, with people hanging out of the doorways.

## Performance

Measured in headless Chrome on an Intel Iris Xe (TGL GT2), medium quality:

| Where | Frame rate |
|---|---|
| Concourse | ~36 fps |
| Platform | ~46 fps |
| V.N. Road | ~52 fps |
| Marine Drive | 46–60 fps |
| The full film at 1280×720 | 45–60 fps |

The scene has about 1,100 simulated people (station plus street) and ~340 vehicles.

What keeps it fast:
- Instancing for trusses, sleepers, trains, people, vehicles and trees.
- Material-bucketed geometry merging.
- CPU frustum culling for large instance sets, with LOD for people and trains.
- City geometry tiled into 180 m chunks.
- Half-resolution SSAO and volumetrics.
- Distance- and frustum-culled traffic.
- Near-only modelled tetrapods, with a rubble band beyond.
- The distant skyline trimmed to tall or near buildings.
- Zone visibility between the train shed and the street.
- Dynamic resolution scaling.

The menu offers Low / Medium / High quality. Low drops SSAO, SMAA and volumetrics.

## Audio

Everything is synthesised with Web Audio, with no recordings:
- **Trains:** inverter whine, rail clatter, brake squeal and hiss, two-tone horn.
- **People and street:** crowd babble, footsteps, car horns, crows, pigeons in the roof.
- **Station:** a PA chime, then the departure announcement in Marathi, Hindi and English
  through the browser's speech synthesis, shown as subtitles. Speech is only heard where
  the browser has those voices (Chrome uses Google's online voices); when the browser's speech
  fails, a notice says so once and the captions carry on.
- **The ride:** the car's rumble, wheel clatter and traction whine under the floor, wind that
  grows with speed near the open doorway, ceiling fans, door leaves sliding, horns, locals passing
  on the next line, and Mira Road's announcement of the incoming Churchgate fast.

## Developer URL parameters

`?mode=explore|cinematic|mira|auto` · `time=morning|afternoon|golden|evening|night|<hour>` · `q=low|medium|high` ·
`cam=x,y,z,yawDeg,pitchDeg` · `hud=0` · `freeze=1` · `stats=1` · `sound=1` · `ao=0`

`node tools/screenshot.mjs --query "mode=explore&hud=0" --shots shots.json --outdir out/` renders
a list of camera positions through the dev server. `window.__mj.seek(seconds)` scrubs the cinematic.
`window.__mj.lineup(n)` stands n women drawn as on the promenade in a row in front of the camera
(`lineup(n, 'all')` for everyone). `window.__mj.groups()` lists the couples, friends and families
and where they are.

## Next milestones

1. Your feedback on Mira Road (MIRA_ROAD.md) and the Borivali and Dadar stops (HALTS.md), then polish of the ride (LOCAL_TRAIN.md §8).
2. Your feedback on the auto ride (AUTO_RIDE.md); the auto ride in the film.
3. Monsoon weather.

## Licences

- **Map data:** © OpenStreetMap contributors, ODbL 1.0 (attribution shown in-app).
- **Fonts:** Inter and Noto Sans / Noto Sans Devanagari, SIL OFL, via @fontsource.
- **Everything else:** procedurally generated by this code.
