# The auto to Mira Road station (milestone 5: the first mile)

You leave your building in Shanti Nagar, wave down a black-and-yellow auto, and ride to Mira Road
station as a passenger. You go through Sector 2's lanes, west past Sector 1, and up Poonam Sagar
Road to the junction by the station. The auto turns into the approach and stops at the forecourt,
and you walk on into the existing station. The driver drives; you look around.

Facts marked **⚠** are estimates or general knowledge, not taken from a source in this repo.

## 1. Sources

| Source | Used for |
|---|---|
| `assets/auto/external/1–6` | The auto (Bajaj RE style): black lower body and nose, twin headlamps, yellow cowl and windscreen frame, black rexine hood with white piping, round mirrors on stalks, rear quarter windows, yellow band, MH plate. Also the Mira Road street scenes: autos everywhere, MBMT buses, the LIC hoarding junction. |
| `assets/auto/internal/1–5` | The passenger's view: the driver's back filling the middle, the coloured quilted hood liner, the LED strip, the windscreen sticker strip, the mirrors either side, the rail behind the driver, the teal-green cowl inside, and the digital fare meter on the left, turned to the passenger. |
| `assets/auto/miraroad_approach/1` | Poonam Sagar Road's character: a divided road with a planted median and twin-arm lamps, trees both sides, shops and parked bikes on the left. |
| `assets/miraroad/*` (MIRA_ROAD.md) | The station, forecourt and approach the ride ends in. |
| `assets/auto/Screenshot from 2026-10-02 …` (your Street View captures) | **01-38-47** (Poonam Sagar Road at the junction, Apr 2026): the shops on the west side with tin awnings and the green Generic Medical board, the median's black-and-white kerb and dense shrubs, the signal on the median. **01-39-42, 01-41-53** (Station Road, Dec 2021): Shanti Shopping Centre facing the station, weathered salmon-pink, its arched parapet gables, its shops from the station end (Natraj, now Veg Sagar; Bikaner; Jio with Bharat Bank above; Monginis; a video-game parlour; Jumboking; Ambika; Oppo; an Udupi hotel), the dormitory board and a big banner upstairs, autos queued at the kerb behind yellow-and-black bollards. Google Maps names the junction "Corporation Bank Junction". |
| OpenStreetMap (ODbL) | The route and everything along it (§2). A second extract south-east of the station (`data/osm/mira-road-south.raw.json`, 247 more ways) adds Shanti Nagar's sectors and the rest of Poonam Sagar Road. `tools/fetch-osm-miraroad.mjs` fetches it; `tools/build-miraroad.mjs` appends it after the original data, unchanged. |

Google Street View could not be opened from this environment, so the Street View work comes from
your captures. Everything else comes from OSM and the reference photos. Where the street furniture
follows a photo's idiom rather than a survey, it is marked ⚠.

## 2. The route

About 0.9 km after the pickup, all on real OSM ways (`src/world/miraroad/AutoRoute.ts`):

1. **Shanti Nagar, Sector 2** (way 215059080): the internal lane between the long slab blocks.
   You start inside your society's gate; the auto picks you up there. It goes round the sector's
   corner, east along its north side, then up the short link (215058880).
2. **West past Sector 1** (99203763): a two-way road with shops.
3. **Right across Poonam Sagar Road's southbound carriageway** at the median break. The auto gives
   way to the oncoming traffic first.
4. **Poonam Sagar Road, northbound** (788778486): OSM maps it as two one-way carriageways, so
   there is a real median.
5. **The station junction**: the auto stops at the signal on red.
6. **Left into the station approach** (1238879349), then round the U-turn by the forecourt
   (44427767). It stops with the forecourt's south gate on your left.

The auto keeps left: 0.85 m left of a lane's centre line, 1.5–1.55 m on the roads.

## 3. What is built

**Streets beyond the station's own** (`MiraFirstMile.ts`, `MiraProps.ts`, own sign atlas):
- **Sector lanes:**
  - compound walls painted per society, with gates every 15–40 m;
  - each gate has pillars with globe lamps, steel leaves (one swung open), the society's name
    board (fictional), a paved apron, and sometimes a watchman's cabin with the watchman on a
    plastic chair;
  - trees inside the compounds leaning over the walls, and paved shoulders;
  - two-wheelers parked in clusters, and lamp posts strung with cable-TV and internet wires;
  - striped speed breakers, a vegetable handcart, a banner strung across the lane, the
    Shanti Nagar sector board.
- **Sector 1's road:** footpaths, trees and shops on the buildings facing it, parked bikes, a tea
  tapri at the corner, a pani-puri cart, a speed breaker.
- **Poonam Sagar Road:**
  - shopfronts both sides, and boundary walls with trees where OSM has an open plot;
  - the median: a raised kerb with a hedge (a railing where it is narrow), twin-arm lamps every
    34 m, and gaps at the real crossings;
  - trees on both footpaths, bikes at the kerb, the bus stop with people waiting, a coconut cart;
  - the road name board, a green "Mira Road Station" sign, banners, two hoardings.
- **The junction:** stop lines, a zebra crossing, signal poles (one with an arm over the lanes),
  and a red/green countdown. The signal runs two phases ⚠ (made-up timings): Poonam Sagar Road
  northbound, then Mira Road westbound with Shrikant Dhadwe Road southbound.

**Buildings along the route:**
- full detail and collision;
- Mira-style pastel paint;
- grilled homes on the ground floor along lanes, shops where they face a road.

**Life:**
- **Traffic routes:** autos and bikes on the sector loop both ways; traffic to and from Sector 1's
  road; Poonam Sagar Road to the station approach.
- **Traffic behaviour:**
  - vehicles follow whatever is ahead in their lane on any route;
  - they stop at the stop lines on red;
  - they never drive through the auto.
- **People:**
  - walkers on the footpaths near you and along the lane edges;
  - watchmen, neighbours at gates, customers at the stalls, people at the bus stop;
  - some cross in front of the auto: in the lane, on Sector 1's road, a jaywalker from the
    median, people on the zebra at the red light, and a hawker working the queue.

**The auto** (`src/entities/auto/HeroAuto.ts`, its body in `AutoShell.ts`):
- the exterior from the photos above, shared with every other auto in the streets:
  - a rounded black rexine hood overhanging the windscreen, with a yellow visor and white piping;
  - the nose, black below and yellow above round the windscreen base, with a white line between;
    twin round headlamps, the vent, the badge, amber indicators and the yellow front plate;
  - the cowl's sides back past the driver's knees, the yellow windscreen frame, round mirrors on
    stalks;
  - the rear body, rounded at the back corners, with the wide yellow band on its belt line and a
    red pinstripe under it; the rear quarters with their windows, the small rear window, tail
    lamps, plate and a yellow bumper strip;
  - the wheels under their mudguards;
- the interior: quilted hood liner (also inside the quarters, round their windows), pink LED strip,
  "॥ श्री गणेशाय नमः ॥" sticker strip, teal cowl, the driver's seat and handlebar, the rail behind
  him, the bar across the right side (you get in and out on the left), the maroon bench;
- the "MEGHA" fare meter (fictional maker) showing the fare, waiting time and HIRED/STOP lamps;
- a khaki-uniformed driver in a new riding pose (`POSE.drive`), his head turning into the turns,
  at you when he stops, and checking the mirror;
- wheels that turn and steer, and a body on springs: it pitches when braking, rolls in turns,
  bounces over speed breakers and shakes at idle;
- headlamps, tail lamps, brake lamps and a headlamp beam at night.

**The other autos** (the stand, the kerb by Shanti Shopping Centre, parked ones, traffic) are the
same body, instanced (`autoCrowd` in `AutoShell.ts`): about 1.3k triangles each, with the bench,
driver's seat, dash and handlebar seen through the openings. Traffic autos more than 60 m away
switch to a plainer version (about 550 triangles, same shape and colours).

**The ride** (`src/world/journey/AutoRide.ts`):
- **Walk:** you walk out of the gate. At the kerb you press E (or just wait), and an auto comes
  up the lane and stops with its doorway beside you.
- **Arrive:** the driver says *"किधर?"*, you say *"स्टेशन"*, he says *"बैठो"* (subtitled).
- **Board:** press E or step in at the left. The camera ducks in through the doorway onto the
  bench, the auto dips as you sit, and the meter goes on (₹26 minimum ⚠, 2025 tariff).
- **Ride.** Mouse look from the seat (±120°), FOV 70°. The head sways against the
  accelerations. The auto:
  - accelerates through four gears, with a pause at each change;
  - slows for corners and crawls over speed breakers;
  - follows traffic and gives way before crossing;
  - brakes and honks for people stepping out;
  - stops on red; the light is cued so you always catch it (about 25 s, with the countdown).

  N skips to the next stretch (Poonam Sagar Road, then the junction), with a dissolve and a
  place card.
- **Arrive at the forecourt:** *"स्टेशन आ गया. छब्बीस रुपये."* E pays by UPI, and the camera
  steps out onto the forecourt facing the station.
- **Walk on:** the existing Mira Road walk takes over, with the Churchgate fast due in about
  2½ minutes, and the auto drives off.

**Sound** (`src/audio/AutoAudio.ts`): the single-cylinder engine's putter following the revs, tyre
rumble, wind through the open sides, rattles, the auto's horn, the meter's beep and the thump over
a breaker. Horns from Mira Road's traffic now play through the soundscape too.

**Time of day:** the auto ride uses the existing presets (`T` cycles them). Street lamps, gate
lamps, shop boards, banners, the auto's lamps and the meter all light at night.

**The station approach** (`MiraStationShops.ts`, from your Street View captures):
- **Shanti Shopping Centre** (OSM 1063810561, the block facing the station) in weathered salmon
  plaster, with two arched gables on its parapet.
- **Its north face, from the station end:** Veg Sagar (where Natraj was), Bikaner, the building's
  entrance under its name board, Jio with Bharat Bank above, Monginis, Jumboking, an Udupi hotel,
  and further along Ambika and Oppo.
- **Upstairs:** the "Fully A/C Dormitory" board and a big festival banner (fictional greeting,
  silhouettes only), plus classes and clinics.
- **Shopfronts:** tin awnings, and autos queued at the kerb behind yellow-and-black bollards (the
  cars that parked there before now park towards the junction).
- **Its Poonam Sagar Road side:** Generic Medical at the junction, then shops under tin awnings.
- **The Union Bank** on the curved one-storey corner across the junction (the former Corporation
  Bank): red band, white curved parapet, shutters.
- The boards use the real businesses' names in their colours and lettering style; no logos are
  copied.

**More Mira Road along the way:**
- tin awnings on most of the route's shops, with classes, clinics and agents on the floor above;
- cables strung across Sector 1's road and Poonam Sagar Road on concrete poles;
- Poonam Sagar's median kerb painted black and white, with denser shrubs;
- more autos in the traffic (about 44%), more traffic on the route, and more shoppers on the
  footpaths.

**Getting in** (the second pass):
- **The gate:** you start in the passage between two of Sector 2's slab blocks, which stand right
  at the lane in OSM. The gate is cut into the wall there with both leaves open, and nothing solid
  stands between you and the lane. Before, the start point could fall inside a building, so you
  couldn't get out.
- **Hailing and boarding:** you can hail only once you're out on the lane, and E boards only from
  beside the auto's left doorway. You can't walk through the auto.
- **Two short letterboxed scenes:**
  - when you hail, an over-the-shoulder shot of the auto coming up the lane, then a shot from across
    the lane as it pulls up beside you, then back to your eyes;
  - when you press E, a shot of you stepping up to the doorway, ducking in and sitting, then the
    view from the bench.
- **Never stuck behind a person:** someone standing about blocks the auto only when they're
  squarely in its way. If anyone holds it up for 10 s, the driver honks and squeezes past.

**The cabin** (the second pass, exterior unchanged):
- tufted, piped maroon rexine on the bench, a ribbed rubber floor mat, an aluminium step strip;
- frame hoops under the hood and a chrome grab handle by the doorway;
- a towel over the driver's seat back, a framed picture with a marigold string on the dash, and
  lemon-and-chillies hanging from the windscreen;
- the fare card and a no-smoking sticker on the rail behind the driver.

## 4. Also changed

- **Two-wheelers:** rebuilt with round tyres, tank or rear cowl, seat, leg shield, fork, mirrors
  and headlamp. The packed pay-and-park keeps the old low-poly model.
- **Bike and auto drivers** in traffic now ride with their hands on the handlebar.
- **MBMT bus at the stop:** its collision box was rotated 90° (12 m across the road); fixed, as
  was the goods tempo's.
- **Traffic deadlocks:** vehicles converging at an angle could block each other for good. They
  now take turns.

## 5. Uncertain, or not modelled (⚠)

- **Gates, stalls and vendors:** placed from the photos' idiom, not surveyed. Society names, the
  route's other shops, banners and adverts are fictional. The shops facing the station (Veg Sagar,
  Bikaner, Jio, Bharat Bank, Monginis, Jumboking, Ambika, Oppo, Generic Medical, Union Bank) are the
  real ones from your captures. The road and sector boards are public signage.
- **Signal timings, the fare, and the right turn across Poonam Sagar Road:** the timings are made
  up, the fare is the 2025 minimum, and the median break at the right turn is inferred from OSM's
  junction nodes.
- **The film:** "Start journey" still begins at Mira Road station. The auto's own short scenes
  (coming up the lane, getting in) are part of the interactive ride.
- **The station approach:** the shops' order follows the captures; the widths of their units,
  their interiors and the floor above are estimates.
- **Your gate:** chosen where the OSM footprints leave room near the lane; it is not a particular
  real building.

## 6. Testing

- **Starts:** `?mode=auto` starts the ride. In dev builds:
  - `__auto.go(s, hour?)` puts the auto at s metres along the route;
  - `__auto.look(yawDeg, pitchDeg)` turns your head;
  - `__auto.state()` reports the phase, s, speed and what is holding the auto back.
- **Runs:** the whole flow was run end to end in headless Chrome at morning, golden hour and
  night, with screenshots at each stage. The second pass walks out with real key presses: from the
  start, through the gate, to the lane, then waiting, the scene, walking up to the doorway, E, the
  ride, arriving, paying, and walking onto the forecourt. Measured from 1 km south of the station on medium
  quality: 45–55 fps, 1.0–1.5 M triangles, about 200 draws (the station alone: 40–50 fps,
  1.1–1.7 M).
