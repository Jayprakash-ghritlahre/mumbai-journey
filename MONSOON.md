# Mumbai Monsoon: a weather layer over the journey

Goal: a Mumbai monsoon over the whole journey, from the auto ride and Mira Road station through the
local and Churchgate to Marine Drive. It should feel like *Mumbai in the rains*, not the usual
scene with a particle effect. Marine Drive's rough high-tide sea is the highlight.

Weather is a separate layer from the time of day. The five time presets (morning, afternoon,
golden hour, evening, night) are unchanged. The weather is either **Clear** or **Mumbai Monsoon**,
and any time of day can have either, from the menu, `R` in play, or `?weather=monsoon` in the URL.

Facts marked **⚠** are estimates or general knowledge, not taken from a source in this repo.

## 1. How it fits the existing architecture

Nothing was rebuilt. The same world switches between clear and monsoon in a few seconds, because
every system the monsoon touches already had one shared place to hook into:

| Existing system | What the monsoon adds there |
|---|---|
| `TimeOfDay.computeLighting` (one lighting state per hour) | `applyWeather`, run after it: overcast palette, weak diffuse sun, rain haze, early lamps, a quieter grade. |
| `SkyDome` shader | An unbroken nimbostratus deck with darker rain clouds racing under it; the sun only a brighter patch. |
| `AmbientVolume.patch` (almost every lit material passes through it) | `Wet.ts`: wet surfaces and puddles everywhere at once, kept dry wherever the light map says there is a roof. |
| The post chain (`Engine`) | `WetReflections`: screen-space reflections in puddles and on the wet film, before the fog. |
| The crowd's one shared GPU shader (`CrowdMaterial`) | Umbrellas and raincoats as extra parts of every body, chosen per person in the shader. |
| `Ocean` shader | High tide, a long monsoon swell, rougher chop, and big surges running in to the wall. |
| The soundscape's ambience bus | `RainAudio`; the sea bed gets heavier and the big waves boom. |

The weather's state lives in `gfx/Weather.ts`: `WEATHER` (read by crowds, traffic, the sea) and `WX`
(uniforms shared by every weather-aware shader, so one write reaches them all).

## 2. Rain

- **The fall.** The rain drifts between moderate and heavy over minutes and has lulls. Every 35–110 s
  a heavier burst comes through for 18–45 s ⚠ (`Weather.update`). Light and heavy rain differ in how
  many drops fall, the haze, the wind and the sound.
- **Drops** (`gfx/Rain.ts`): one instanced draw of 5,000 to 16,000 streaks (by quality) in a box that
  wraps round the camera. Each drop falls at its own speed and is blown by the south-west monsoon
  wind. A streak is drawn along its velocity *relative to the camera*, so from a moving local or auto
  the rain slants past the window. Thin far streaks are faded rather than thickened, so they don't
  shimmer.
- **Not uniform:** each drop has its own width, length, brightness and lean in the wind, and a few
  are big heavy drops. Curtains of heavier rain drift through on the wind, so the density moves
  across the scene. The bursts bring more drops and stronger gusts.
- **Rain sheets** for the distance: two thin cylinders round the camera with dashed streaks falling
  in random columns.
- **Where it doesn't rain:** under any roof or canopy (from the ambient volume's ceiling and sky
  visibility: Churchgate's shed, Mira Road's canopies and booking hall, the halts' canopies), and
  inside two *dry boxes* set each frame: the coach you ride and the auto's cabin. You see the rain
  through the doors, windows and side openings.
- Streaks near lamps take the lamps' light, so at night they shine under the street lights.

## 3. Wet streets, platforms and tracks

`gfx/Wet.ts`, patched into every material the ambient volume lights (so Churchgate, the route,
Marine Drive, Nariman Point, Mira Road, the first mile, the halts, the corridor, the trains and the
auto all get it). The kind of surface comes from the material's name:

- **Ground and other open surfaces:** darker (porous ones most) and glossy. Walls darken in streaks.
- **Puddles** collect on flat open ground: about a fifth of it, a little more in a downpour ⚠. They
  are dark, mirror-smooth water with rain rings spreading on them.
- **Porous** (ballast, soil, grass, bark, sleepers): much darker, no puddles. The tracks look soaked.
- **Objects** (vehicles, autos, the EMU's body and roof, rails, leaves, shared prop paint): glossier
  and a little darker, no puddles.
- **Dry:** under roofs, under the canopies, inside the coach and the auto, and the water and glass.
- **Reflections** (`gfx/WetReflections.ts`, medium and high quality): the wet materials mark how
  mirror-like they are in the frame's alpha. A screen-space pass marches reflected rays through the
  depth buffer for those pixels only. Puddles reflect people, buses, lamp posts, shop fronts and
  headlights. On the wet film the reflection is smeared vertically, as on a real wet road.
- Vehicles have their headlights on: under the dark sky the lamps value rises, which drives the
  vehicle lights, shop signs and street lamps.

## 4. People

All crowds share one shader, so this covers the station, the streets, the platforms, the halts,
the riders in the coach and the people at Mira Road.

- **Umbrellas** (`HumanGeometry.rainGear`): eight-panel canopies held up in the right hand, the arm
  posed to hold the shaft. Sizes vary from person to person. Most are black; others are navy,
  maroon, royal blue, red, pink, green, mustard, the person's accent colour, or panels in two
  colours ⚠.
- **One umbrella per person, from street to train.** Who carries one is fixed per person, wherever
  they are. Out in the rain it is up. Walking in under the arcade, a canopy or the shed, the canopy
  folds down along the shaft and the umbrella comes down to hang from the hand at the side, then
  goes up again on the way out. It follows the open sky averaged over a few metres round the
  person, so it changes over a couple of steps and not for a short gap. Stepping aboard, it folds over
  the last few metres to the door. Anyone in a train (the coach you ride, the other coaches, trains at
  the platforms) has theirs folded and put away. Nothing appears or vanishes at a trigger line.
- **Raincoats:** hooded, to the knee, with sleeves. Most riders on two-wheelers wear one, so do many
  schoolchildren, and some adults. Hair, caps, earrings and dupattas tuck away under the hood.
  Colours are navy, black, olive, maroon, royal blue, clear grey, and yellow or red for children ⚠.
  Raincoats stay on indoors.
- **Walking differently:** people caught in the open without gear walk hunched, head down, arms in.
  Everyone walks a little quicker in the rain. Clothes out in the rain look darker; raincoats and
  umbrellas shine wet.
- **The sea wall:** when the monsoon sets in, about 60 % of the people sitting on the open sea wall
  get down, and in a heavy burst most of the rest follow ⚠. A third of them walk off along the
  promenade or over to the road. The rest stand back from the wall, 2.5–9.5 m and spread along it,
  so not in a row. Most watch the waves, some face the road or their friends, and groups stay
  together. They step away from the sea whichever way they sat. Clear weather puts them back.
- Right beside you (within about a metre and a half) people tip their open umbrella away from you, as
  they do passing close in a crowd. It stays open.

## 5. Marine Drive: the rough monsoon sea

`world/route/Ocean.ts` and `SeaSpray.ts`.

- **High tide:** the sea stands 1.5 m higher ⚠, up the tetrapods.
- **Rougher sea:** the swell is two to three times higher and a long monsoon swell (62 m) rolls in
  off the Arabian Sea. The water is churned grey-green and brown with silt near the shore. Whitecaps
  are streaked by the wind and the whitewater band at the wall is wider.
- **Big waves, with variation:** waves break on the tetrapods all along the wall every 1–3 s, small
  ones. A bigger set comes in every 6–13 s. Every 20–40 s a really big one arrives, usually in front
  of you ⚠. Big waves are seen coming: a surge in the ocean shader builds as it runs in and breaks
  white on its crest.
- **Spray, from the wall up:** when a wave hits, three things happen (instanced billboards, all
  motion on the GPU):
  - whitewater surges over the tetrapods where it breaks;
  - water is thrown up from a narrow base at the wall in a few irregular jets, each with its own
    height and lean. The droplets streak along their motion and fall back: a small wave reaches
    about the wall top, a big one 7–10 m, its plume standing for two or three seconds;
  - big waves leave a fine mist that the wind carries a little inland. It clears in three or four
    seconds.

  The ocean shows the foam churned up at the impact for a few seconds. Most of the time it is small
  hits along the wall. The big event is short. Close to the camera the spray thins, so it reads as a
  drift over you, not a white-out.
- **In view:** big waves break on a stretch of wall you can see, 30–200 m off. From the wall itself the
  near wall runs almost side-on, so that is usually further along Marine Drive's curve. In the film's
  "Arabian Sea" shot two big waves break in view while the title is up. In the monsoon its
  subtitle reads "Back Bay · monsoon high tide".
- **Sound:** each wave booms through the concrete, the thrown water roars and the falling spray
  hisses, all placed where it hit.

It stays a rough sea, not a flood. The tide, swell and surges apply only over the sea (the shore
field), and the surface is capped below road level, so the water never crosses the wall. Only spray
does.

## 6. Mira Road, the auto and the local

- **The auto:** rain outside the cabin and none inside. Beads of water gather on the windscreen and
  the clear vinyl windows: clear centres, a dark rim, a highlight. The wiper sweeps steadily in a
  downpour and every few seconds in lighter rain. Where it has just passed, the screen is clear and
  the drops gather again. The driver takes it easier: about 15 % slower ⚠ and braking earlier on the
  wet road. The traffic slows too (two-wheelers most) and keeps longer gaps.
- **Mira Road station:** the open platform ends, forecourt and tracks are wet with puddles and
  umbrellas. Under the canopies and in the booking hall it is dry. Rain falls beyond the canopy
  edges. The light is darker and grey.
- **The local:** rain past the windows and the open doorway, slanting with the train's speed. The
  platforms at Mira Road, Borivali and Dadar are wet, with umbrellas on the open stretches. Some
  passengers wear raincoats. Ballast and sleepers are soaked and the rails shine.

## 7. Sound

`audio/RainAudio.ts`, on the existing ambience bus. The trains, the PA announcements (spoken by the
browser, not routed through this graph) and the horns carry on as before.

| Where | What you hear |
|---|---|
| In the open | The fall all round, the crackle of drops landing near you, the wind's gusts. |
| Under a canopy or the shed | Drumming on the roofing with a metallic ring, the fall muffled, drips from the edges. |
| In the coach | Rain on the roof, the fall rushing past through the windows, louder with speed. |
| In the auto | The close, heavy patter on the rexine hood right over your head. |
| At Marine Drive | A heavier, deeper wash, more frequent splashes, stronger wind, and the big waves booming. |
| By the road | Tyres hissing through the wet as vehicles pass. |
| Now and then | In a heavy burst, a long low roll of thunder far off over the sea (never a crack overhead). |

The fall is in stereo, two unrelated sources left and right, so it surrounds you. All sound pauses
while the tab is hidden (otherwise the ambience holds at its last level as a steady hiss, because a
hidden page stops updating) and comes back when you return. In the auto, the
wiper gives a soft rubbery thunk at each end of its sweep.

## 8. Time of day with the monsoon

The weather is applied after the time of day, so all ten combinations work:

| Time | Monsoon look |
|---|---|
| Morning, afternoon | A pale grey sky, soft shadowless light, the far shore lost in the rain haze. |
| Golden hour | Grey storm cloud, a muted warmth only low in the west, warm street lights and shop signs on early. Not orange. |
| Evening | Slate-blue cloud going dark, the lamps on, their light reflected in the wet promenade and roads. |
| Night | Dark charcoal and blue-grey storm cloud with soft variation, the horizon a little lighter, the city's warm glow on the cloud base over the land, no stars. The sea is darker than the sky, so the bay keeps its depth. The Queen's Necklace lights show across the water. |

**Depth through the rain** (`PostEffects` far haze): the streets close by stay clear, and beyond about
60 m the city greys and pales with distance. Lit windows and lamps still show through it.

## 9. Performance

What it adds per frame: one post pass (the reflections, which march only for wet pixels), one
instanced draw for the drops, two for the rain sheets and two for the spray (its dense water writes
depth, so the fog and rain haze treat it at its own distance). The wet shading and
the gear on people are branches in shaders that already run, and are off in clear weather. The light
is recomputed only when the rain has changed enough, at most about three times a second.

Measured in headless Chrome (medium quality) with dynamic resolution on: Marine Drive ran at
21–24 ms a frame both clear and in the monsoon. The difference is within what dynamic resolution
moves around, so it has not been measured precisely.

Low quality has no reflections and 5,000 drops.

## 10. Code

| File | What |
|---|---|
| `gfx/Weather.ts` | Presets, the rain's ebb and flow and bursts, wind, sea state; shared uniforms; dry boxes. |
| `gfx/TimeOfDay.ts` (`applyWeather`) | The monsoon's light over any hour. |
| `gfx/SkyDome.ts` | The overcast deck. |
| `gfx/Wet.ts`, `gfx/AmbientVolume.ts` | Wet surfaces, puddles, rings, lamp glints, the reflection mask. |
| `gfx/WetReflections.ts`, `core/Engine.ts` | Screen-space reflections in the post chain. |
| `gfx/Rain.ts` | Drops and rain sheets. |
| `entities/crowd/HumanGeometry.ts`, `CrowdMaterial.ts`, `Crowd.ts`, `Riders.ts` | Umbrellas, raincoats, posture, the sea wall in the rain. |
| `world/route/Ocean.ts`, `SeaSpray.ts`, `Route.ts` | The monsoon sea, surges and spray. |
| `entities/auto/HeroAuto.ts`, `world/journey/AutoRide.ts` | Rain on the glass, the wiper, the careful driver. |
| `entities/traffic/Traffic.ts`, `world/miraroad/MiraLife.ts` | Slower traffic, quicker walkers. |
| `audio/RainAudio.ts`, `audio/Synth.ts` (`SeaBed`), `audio/Soundscape.ts` | The rain's sound and the sea's. |
| `ui/Hud.ts`, `app/App.ts` | The Weather choice, `R`, `?weather=monsoon`, wiring. |

The test API has `__mj.setWeather('monsoon' | 'clear', instant)` and `__mj.weather()`.

## 11. Not done yet

- Rain on the coach's few glazed panes and through the open doors onto the people standing there.
- Umbrellas fold by where people are, not by a remembered state, so someone who stands for a long
  time at the very edge of a canopy keeps theirs half open.
- Splash crowns where drops hit the ground (the puddles have rain rings; the open ground has none).
- Streetlight reflections that are off screen: screen-space reflections can only show what is in view.
- Thunder and lightning (left out to keep it a steady monsoon rain, not a storm).
