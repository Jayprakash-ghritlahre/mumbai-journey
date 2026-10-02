# Marine Drive → Nariman Point (milestone 3)

This milestone continues the walk from the V.N. Road junction south along the Marine Drive promenade to the tip of Nariman Point. It uses the same approach as [CHURCHGATE_TO_MARINE_DRIVE.md](CHURCHGATE_TO_MARINE_DRIVE.md):
- Real geography comes from OpenStreetMap.
- Landmarks are recognisable, built from their shapes, proportions and materials.
- Businesses stay fictional; building names are real.
- Anything not backed by a source is marked **⚠**.

Local frame as before: origin at the Churchgate buffer stops, −z up the tracks (true bearing 351°), metres. Positions along Marine Drive are given as arc length *s* on the Marine Drive centre line, with offset *o* positive landward.

## 1. Sources

| Source | Used for |
|---|---|
| **OpenStreetMap** (ODbL): `south-mumbai.geo.json` (buildings with levels, roads, coastline, areas) and `back-bay.geo.json` (land polygon, far buildings with validated heights) | Every footprint, the road layout, the coastline and tip, building levels where tagged. |
| **Reference photos** in `assets/marine_drive/Marine_Drive_Reference_Pack_v2/`: `air_india*.jpeg`, `trident_*.jpeg`, `looking_necklace.jpeg`, the night panoramas | Proportions, facade rhythm, colours, street furniture, the sunset mood. Used as reference only, never as textures (several are watermarked stock images). `looking_necklace.jpeg` looks AI-generated, so it informs mood only. |
| **General knowledge** of the area | Storey counts and dates where OSM has none. Always marked **⚠**. |

## 2. Route sequence (continuing from the V.N. Road junction sea wall)

| # | Stage | Where (s / local x, z) | What you see |
|---|---|---|---|
| 1 | **Promenade south of the junction** | s 2710 → 3150 | The same promenade, wall and tetrapods as milestone 2. The Art Deco row thins out on the left. Ahead, the Air-India Building and the Trident rise above the trees. |
| 2 | **Madame Cama Road junction** ("Air India junction") | s ≈ 3187, (−668, 419) | Marine Drive (4+4 lanes) ends. Madame Cama Road turns inland (south-east) and Barrister Rajni Patel Marg branches off. Signals, zebras and BEST buses. On the corner stands the **Air-India Building**: a 23-storey (**⚠**) white slab with rows of small dark windows and an overhanging flat roof, and a round podium drum at its foot with a billboard and palms. |
| 3 | **Sir Dorab Tata Road stretch** | s 3190 → 3550 | The road narrows to two one-way carriageways of two lanes each (OSM: 6.4 m each, ~10 m apart). The promenade widens into a broad paved walk with **Indian almond trees** (*Terminalia catappa*) and U-hoop barriers along the road edge (photos). On the left: **Express Towers** (dark, 25 storeys **⚠**), the **Trident** (tall cream slab, 35 storeys **⚠**, red "TRIDENT" letters at the top of the narrow face), then **The Oberoi** (lower, cream, ~20 storeys **⚠**). |
| 4 | **NCPA** | s 3550 → the tip | The road turns inland (NCPA Marg). Behind the NCPA apartments tower (OSM: 23 levels) lie the NCPA theatres: the **Tata Theatre** (a fan-shaped auditorium by Philip Johnson, 1980 **⚠**), the **Jamshed Bhabha Theatre** (a colonnaded front **⚠**) and the Experimental Theatre, in gardens. |
| 5 | **The tip of Nariman Point** | ≈ (−1130, 820) | The promenade ends where the coast turns sharply south-east. Sea on three sides. Looking back north you see the whole curve of the Queen's Necklace to Malabar Hill: the classic view at sunset and after dark. |

About 1.05 km from the junction crossing to the tip, 13–15 minutes at a stroll.

## 3. What changes visually

- **After the Air India junction the street opens up.** The road is half as wide, the promenade twice as wide and shaded by almond trees. The buildings on the left jump from 6–7-storey Art Deco to 1970s office and hotel towers of 15–35 storeys.
- **Materials change**: exposed concrete, white render, dark glass, fins, and grilles instead of pastel Deco.
- **The view reverses at the tip.** The whole necklace lies ahead, and the sun sets over open sea to the west.

## 4. Landmark inventory

| Building | OSM | Height used | Recognition features |
|---|---|---|---|
| Air-India Building | 358470268 (tower part 1009324337, podium part 1009324336) | OSM part: 22 levels, 105 m. Commonly quoted as 23 floors and 91 m; the OSM figure is used **⚠** | White slab. Continuous rows of small square window openings on every floor. A recessed glazed top floor under a thin overhanging roof. A round podium drum at the base. No airline branding: the building changed hands in 2024 and the rooftop sign's status in 2026 is unknown **⚠**. |
| Express Towers | 356173966 (tower part 1009324335) | OSM part: 24 levels, 105 m | Dark tinted grid, set back behind the Air-India drum. |
| Trident, Nariman Point | 753875938 (tower part 1242501114) | OSM part: 35 levels, 117 m | Cream slab with a stepped narrow end. Balcony bands and small windows. Red "TRIDENT" letters at the top. This is the building's name (OSM), not a logo. |
| The Oberoi | 753875937 (part 1009324323) | OSM part: 14 levels, modelled at 52 m on a 22 m block **⚠** | Cream block linked to the Trident, with horizontal bands. |
| NCPA apartments | 207413358 | OSM 23 levels | Tall residential tower at the tip. |
| Tata Theatre | 207413334 | ~18 m **⚠** | A low fan-shaped auditorium with a sloping copper-coloured roof **⚠**. |
| Jamshed Bhabha Theatre | 38748504 | ~25 m | A colonnaded neoclassical front **⚠**. |
| Others | OSM | levels × 3.35 m | Nariman Bhavan (15), Nirmal (21), Mafatlal Bhavan (12), Jolly Maker Chambers II (15), Mittal Court and Towers (16), Maker Chambers III–VI (14), Dalamal Towers (13), Free Press House (12) and more, from the city generator with modern facades. |

## 5. Streetscape

- **Road:**
  - Marine Drive's 4+4 lanes end in a box junction with zebras.
  - Beyond the junction, two carriageways of two lanes each, with a median. Their offsets are fitted to the OSM ways: sea-side carriageway at o −10…−9, land side at o 0…+6.
  - Kaali-peeli taxis and cars park along the kerb (photos).
- **Promenade:**
  - Same pavers and white band as milestone 2.
  - Widened to the road with a tree strip: almond trees every 11–14 m, and U-hoops along the kerb.
  - Twin-arm lamps continue.
  - No benches (there are none on this stretch); people sit on the sea wall.
- **Sea wall and tetrapods** continue unchanged to the tip. There the parapet follows the OSM coastline round the corner.
- **People:**
  - Evening walkers, joggers and couples.
  - Groups on the wall at the tip.
  - Fewer vendors than at the junction **⚠**.

## 6. Plan (first version)

1. Extend the Marine Drive centre line along the straight final stretch of coast to near the tip, and replace the land edge there with the sea wall.
2. New module `src/world/route/NarimanPoint.ts`, which builds:
   - the Air India junction
   - the narrower road
   - the widened promenade with almond trees
   - lamps and tetrapods
   - the tip platform
   - the landmark buildings
   - a second signal controller for the junction
3. City generator: add a Nariman Point area (buildings, roads, trees, lamps, collision). Exclude the hand-built landmarks. The far skyline stops drawing the same buildings as boxes.
4. Ambient-light map and walk surface enlarged to cover the area. Traffic and crowd extended.
5. Film: continue from the sea wall south along the promenade, past Air India and the Trident, to the tip at sunset. The lights of the necklace come on as the camera looks back.
6. Explore mode: a "Nariman Point" start. The location label names the new zone.

## 7. Uncertainties

- **Tower heights** come from OSM building parts. For Air-India, OSM's 105 m differs from the commonly quoted 91 m. **⚠**
- **Rooftop signage in 2026:** unknown. The Air-India roof is left unbranded; the Trident keeps its name letters. **⚠**
- **Tata Theatre roof** form and colour are simplified. **⚠**
- **Vendors and the exact tree spacing** on the southern promenade are estimates from photos. **⚠**
- **Junction layout** (lane arrows, the exact zebra positions and the signal phasing) is plausible, not surveyed. **⚠**
- **The tip platform's shape** follows the OSM coastline. The real parapet line may differ by a few metres. **⚠**

## 8. Implementation status (first version)

| Part | What is in the build |
|---|---|
| **Geometry** | The Marine Drive centre line now runs along the last straight stretch of coast to ~45 m short of the tip. The sea wall replaces the land edge all the way. `src/world/route/NarimanPoint.ts` takes over from the end of the detailed Marine Drive stretch (s ≈ 3153). |
| **Air India junction** | Marine Drive's 4+4 lanes end in a box junction with zebras across Marine Drive and Sir Dorab Tata Road, stop lines, and the Madame Cama Road mouth. A second signal controller (Marine Drive / Madame Cama Road / green man) drives heads on poles and a mast arm. Traffic obeys it (a 100 s run: no red-light running). |
| **Sir Dorab Tata Road** | Two 2-lane carriageways on the OSM centre lines, a kerbed planted median with twin-arm lamps, a sea-side parking lane with taxis, a 5 m land-side footpath with palms and almonds, and a turning loop at the NCPA. |
| **Promenade** | Widens to the road edge. Indian almond trees (a new tree type with tiered branches) and U-hoops line the kerb (no benches). Twin-arm lights run along the road edge. The pavers, white band, step, sea wall and modelled tetrapods continue to the tip. A paved plaza and an end parapet close the tip. |
| **Landmarks** | Built on the OSM footprints and part heights:<br>• **Air-India:** white slab with rows of small windows, a recessed glazed top floor, an overhanging roof, and a rounded podium with a roof garden and a fictional billboard.<br>• **Express Towers:** dark grid.<br>• **Trident:** cream slab with red name letters.<br>• **The Oberoi.**<br>• **NCPA:** Tata Theatre and Jamshed Bhabha Theatre with a colonnade.<br>Their windows light up after dusk. |
| **City** | The generator now also builds the Nariman Point area: buildings, streets, trees, lamps and collision. The far skyline no longer draws it. The ambient-light map (2048², ≈0.8 m cells) and the walk surface cover it. |
| **People** | Walkers on the southern promenade, sitters along the whole wall (busier towards the tip), a standing crowd at the tip, and a traffic policeman at the promenade chowki. |
| **Film** | After the sea wall:<br>1. a stroll south<br>2. a tilt up the Air-India Building (title "Nariman Point")<br>3. a tracking shot under the almond trees<br>4. the last stretch to the tip at sunset<br>5. a 28 s view back along the necklace.<br>If the film starts in the evening, a time-lapse carries it from golden hour into night, so the Queen's Necklace lights up. The film is now about 6 min 20 s. |
| **Explore** | "Explore Nariman Point" starts at the tip facing the necklace. The location label reads "Nariman Point · नरिमन पॉइंट" south of the Air India junction. |

**Not yet done:**
- the promenade end is a straight parapet, not the rounded tip
- the Tata Theatre's fan-shaped roof is a simple raised drum
- the rest of Nariman Point inland is generic generated blocks (Vidhan Bhavan, Mantralaya, Maker Chambers)
