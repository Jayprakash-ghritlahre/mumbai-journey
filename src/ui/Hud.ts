import type { Quality } from '../core/Engine';
import { PRESET_LABEL, PRESET_ORDER, type TimePreset } from '../gfx/TimeOfDay';
import { WEATHER_LABEL, WEATHER_ORDER, type WeatherPreset } from '../gfx/Weather';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export type ExploreStart = 'mira-road' | 'churchgate' | 'marine-drive' | 'nariman-point' | 'here';

export interface HudCallbacks {
  onStartJourney: () => void;
  /** Ride the local yourself, Mira Road → Churchgate. */
  onRide: () => void;
  /** Take an auto from Shanti Nagar to Mira Road station. */
  onAuto: () => void;
  onExplore: (where: ExploreStart) => void;
  onTime: (t: TimePreset) => void;
  /** Clear or the Mumbai monsoon (a layer over the time of day). */
  onWeather: (w: WeatherPreset) => void;
  onQuality: (q: Quality) => void;
  onSound: (on: boolean) => void;
  onSkip: () => void;
  onBackToMenu: () => void;
}

/** DOM overlay: loading screen, menu, explore HUD and cinematic chrome. */
export class Hud {
  readonly root: HTMLElement;
  private loading: HTMLElement;
  private loadBar: HTMLElement;
  private loadLabel: HTMLElement;
  private menu: HTMLElement;
  private hud: HTMLElement;
  private hints: HTMLElement;
  private clickToLook: HTMLElement;
  private stats: HTMLElement;
  private clock: HTMLElement;
  private loc: HTMLElement;
  private titleCard: HTMLElement;
  private subtitle: HTMLElement;
  private fadeEl: HTMLElement;
  private endCard: HTMLElement;
  private toastEl: HTMLElement;
  private hintEl: HTMLElement;
  private hintsHtml = '';
  private toastTimer = 0;
  private timeButtons = new Map<TimePreset, HTMLButtonElement>();
  private weatherButtons = new Map<WeatherPreset, HTMLButtonElement>();
  private qualityButtons = new Map<Quality, HTMLButtonElement>();
  private soundBtn!: HTMLButtonElement;
  soundOn = true;

  constructor(container: HTMLElement, cb: HudCallbacks, initial: { time: TimePreset; quality: Quality; weather: WeatherPreset }) {
    this.root = el('div', 'ui-layer');
    container.appendChild(this.root);

    // Cinematic chrome sits below the menus.
    this.root.append(el('div', 'letterbox top'), el('div', 'letterbox bottom'));
    this.titleCard = el('div', 'title-card', '<div class="t1"></div><div class="t2"></div><div class="t3"></div>');
    this.subtitle = el('div', 'subtitle');
    const skip = el('button', 'skip', 'Skip ›');
    skip.addEventListener('click', () => cb.onSkip());
    this.fadeEl = el('div', 'fade');
    this.root.append(this.titleCard, this.subtitle, skip);

    // Explore HUD.
    this.hud = el('div', 'hud hidden');
    this.loc = el('div', 'loc', 'Churchgate<span class="deva">चर्चगेट</span>');
    this.locText = 'Churchgate';
    this.clock = el('div', 'clock');
    this.hints = el(
      'div',
      'hints',
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk &nbsp; <kbd>Shift</kbd> run &nbsp; <kbd>Mouse</kbd> look &nbsp; <kbd>T</kbd> time of day &nbsp; <kbd>R</kbd> weather &nbsp; <kbd>F</kbd> fly &nbsp; <kbd>Esc</kbd> menu &nbsp; <kbd>`</kbd> stats',
    );
    this.clickToLook = el('div', 'click-to-look', 'Click to look around');
    this.stats = el('div', 'stats');
    this.hud.append(this.loc, this.clock, this.hints, this.clickToLook, this.stats);
    this.root.append(this.hud);

    // Menu.
    this.menu = el('div', 'menu hidden');
    const left = el('div');
    left.append(
      el('div', 'brand', 'Mumbai Journey'),
      el('h1', '', 'Mira Road<span class="h1-sub">→ Nariman Point</span>'),
      el('div', 'deva', 'मीरा रोड · चर्चगेट · मरीन ड्राइव्ह · नरिमन पॉइंट'),
      el(
        'div',
        'sub',
        'Take an auto from Shanti Nagar through the lanes and up Poonam Sagar Road to Mira Road station. Catch the Churchgate fast there and ride the Western line down past the salt pans, the suburbs and Mahim Creek into Churchgate. Walk out with the crowd along Veer Nariman Road, cross Marine Drive to the sea wall, and stroll on to Nariman Point as the sun sets over the Arabian Sea and the Queen\'s Necklace lights up.',
      ),
    );
    const route = el('div', 'route');
    route.innerHTML = ['<b>Shanti Nagar</b>', '<b>Auto</b>', '<b>Mira Road</b>', '<b>Mumbai Local</b>', '<b>Churchgate</b>', '<b>Marine Drive</b>', '<b>Nariman Point</b>'].join(' <span>›</span> ');
    left.append(route);

    const actions = el('div', 'actions');
    const row = el('div', 'btn-row');
    const start = el('button', 'primary', '▶&nbsp; Start journey');
    start.addEventListener('click', () => cb.onStartJourney());
    const auto = el('button', 'secondary', 'Auto to the station');
    auto.title = 'Wave down an auto in Shanti Nagar and ride to Mira Road station';
    auto.addEventListener('click', () => cb.onAuto());
    const ride = el('button', 'secondary', 'Ride the local');
    ride.title = 'Board at Mira Road and ride to Churchgate yourself';
    ride.addEventListener('click', () => cb.onRide());
    const exploreMR = el('button', 'secondary', 'Explore Mira Road');
    exploreMR.title = 'Walk round Mira Road station; catch the Churchgate fast on platform 4';
    exploreMR.addEventListener('click', () => cb.onExplore('mira-road'));
    const explore = el('button', 'secondary', 'Explore Churchgate');
    explore.addEventListener('click', () => cb.onExplore('churchgate'));
    const exploreMD = el('button', 'secondary', 'Explore Marine Drive');
    exploreMD.addEventListener('click', () => cb.onExplore('marine-drive'));
    const exploreNP = el('button', 'secondary', 'Explore Nariman Point');
    exploreNP.addEventListener('click', () => cb.onExplore('nariman-point'));
    row.append(start, auto, ride, exploreMR, explore, exploreMD, exploreNP);

    const timeWrap = el('div');
    timeWrap.append(el('div', 'opt-label', 'Time of day'));
    const timeSeg = el('div', 'seg');
    for (const k of PRESET_ORDER) {
      const label = PRESET_LABEL[k];
      const b = el('button', k === initial.time ? 'on' : '', label);
      b.addEventListener('click', () => cb.onTime(k));
      this.timeButtons.set(k, b);
      timeSeg.append(b);
    }
    timeWrap.append(timeSeg);

    const weatherWrap = el('div');
    weatherWrap.append(el('div', 'opt-label', 'Weather'));
    const weatherSeg = el('div', 'seg');
    for (const k of WEATHER_ORDER) {
      const b = el('button', k === initial.weather ? 'on' : '', WEATHER_LABEL[k]);
      b.addEventListener('click', () => cb.onWeather(k));
      this.weatherButtons.set(k, b);
      weatherSeg.append(b);
    }
    weatherWrap.append(weatherSeg);

    const optRow = el('div', 'btn-row');
    const qWrap = el('div');
    qWrap.append(el('div', 'opt-label', 'Quality'));
    const qSeg = el('div', 'seg');
    for (const q of ['low', 'medium', 'high'] as Quality[]) {
      const b = el('button', q === initial.quality ? 'on' : '', q[0].toUpperCase() + q.slice(1));
      b.addEventListener('click', () => cb.onQuality(q));
      this.qualityButtons.set(q, b);
      qSeg.append(b);
    }
    qWrap.append(qSeg);
    const sWrap = el('div');
    sWrap.append(el('div', 'opt-label', 'Sound'));
    const sSeg = el('div', 'seg');
    this.soundBtn = el('button', 'on', 'On');
    this.soundBtn.addEventListener('click', () => {
      this.soundOn = !this.soundOn;
      this.soundBtn.textContent = this.soundOn ? 'On' : 'Off';
      this.soundBtn.classList.toggle('on', this.soundOn);
      cb.onSound(this.soundOn);
    });
    sSeg.append(this.soundBtn);
    sWrap.append(sSeg);
    optRow.append(qWrap, sWrap);
    actions.append(row, timeWrap, weatherWrap, optRow);
    this.menu.append(left, actions);
    this.root.append(this.menu);

    this.endCard = el('div', 'end-card');
    const endInner = el('div');
    endInner.append(el('h2', '', 'Nariman Point'), el('div', 'deva end-deva', 'नरिमन पॉइंट'), el('p', '', "The Queen's Necklace, lit for the night — the end of the journey from Mira Road."));
    const endRow = el('div', 'btn-row');
    endRow.style.justifyContent = 'center';
    const exploreEnd = el('button', 'primary', 'Keep walking from here');
    exploreEnd.addEventListener('click', () => cb.onExplore('here'));
    const replay = el('button', 'secondary', 'Replay');
    replay.addEventListener('click', () => cb.onStartJourney());
    const menuEnd = el('button', 'secondary', 'Menu');
    menuEnd.addEventListener('click', () => cb.onBackToMenu());
    endRow.append(exploreEnd, replay, menuEnd);
    endInner.append(endRow);
    this.endCard.append(endInner);
    this.root.append(this.endCard, this.fadeEl);

    this.toastEl = el('div', 'toast');
    this.hintEl = el('div', 'toast ride-hint');
    this.hintEl.style.top = 'auto';
    this.hintEl.style.bottom = '64px';
    this.root.append(this.toastEl, this.hintEl);
    this.root.append(el('div', 'attribution', 'Street &amp; building layout © OpenStreetMap contributors (ODbL)'));

    this.loading = el('div', 'loading');
    const inner = el('div', 'inner');
    this.loadBar = el('div');
    const bar = el('div', 'bar');
    bar.append(this.loadBar);
    this.loadLabel = el('div', 'label', 'Preparing…');
    inner.append(el('div', 'brand', 'Mumbai Journey'), el('div', 'brand-deva', 'मुंबई प्रवास'), bar, this.loadLabel);
    this.loading.append(inner);
    this.root.append(this.loading);
  }

  setProgress(label: string, f: number): void {
    this.loadLabel.textContent = label;
    this.loadBar.style.width = `${Math.round(f * 100)}%`;
  }

  hideLoading(): void {
    this.loading.classList.add('hidden');
  }

  showMenu(on: boolean): void {
    this.menu.classList.toggle('hidden', !on);
  }

  showHud(on: boolean): void {
    this.hud.classList.toggle('hidden', !on);
  }

  setPointerHint(locked: boolean): void {
    this.clickToLook.style.opacity = locked ? '0' : '1';
    this.hints.style.opacity = locked ? '0.85' : '1';
  }

  setTimeSelected(t: TimePreset): void {
    this.timeButtons.forEach((b, k) => b.classList.toggle('on', k === t));
  }

  setWeatherSelected(w: WeatherPreset): void {
    this.weatherButtons.forEach((b, k) => b.classList.toggle('on', k === w));
  }

  setQualitySelected(q: Quality): void {
    this.qualityButtons.forEach((b, k) => b.classList.toggle('on', k === q));
  }

  private locText = '';

  setLocation(en: string, deva: string): void {
    if (en === this.locText) return;
    this.locText = en;
    this.loc.innerHTML = `${en}<span class="deva">${deva}</span>`;
  }

  setClock(text: string): void {
    this.clock.textContent = text;
  }

  statsVisible = false;

  setStats(text: string): void {
    if (this.statsVisible) this.stats.textContent = text;
  }

  showStats(on: boolean): void {
    this.statsVisible = on;
    this.stats.style.display = on ? '' : 'none';
  }

  cinematic(on: boolean): void {
    this.root.classList.toggle('cine-on', on);
  }

  /** Letterbox bars for a short in-game scene (no film controls), the controls' help hidden. */
  letterbox(on: boolean): void {
    this.root.classList.toggle('lb-on', on);
  }

  title(t1: string, t2 = '', t3 = ''): void {
    const [a, b, c] = Array.from(this.titleCard.children) as HTMLElement[];
    a.textContent = t1;
    b.textContent = t2;
    c.textContent = t3;
    this.titleCard.classList.add('show');
  }

  hideTitle(): void {
    this.titleCard.classList.remove('show');
  }

  sub(text: string, deva = ''): void {
    this.subtitle.innerHTML = `${text}${deva ? `<span class="deva">${deva}</span>` : ''}`;
    this.subtitle.classList.add('show');
  }

  hideSub(): void {
    this.subtitle.classList.remove('show');
  }

  fade(on: boolean): void {
    this.fadeEl.classList.toggle('on', on);
  }

  showEnd(on: boolean): void {
    this.endCard.classList.toggle('show', on);
  }

  /** A standing hint above the controls (the ride), or none. */
  hint(text: string | null): void {
    if (text) this.hintEl.textContent = text;
    this.hintEl.classList.toggle('show', !!text);
  }

  /** Keyboard help for the current mode ('explore', 'ride' or 'auto'). */
  setHints(kind: 'explore' | 'ride' | 'auto'): void {
    if (!this.hintsHtml) this.hintsHtml = this.hints.innerHTML;
    this.hints.innerHTML =
      kind === 'ride'
        ? '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move &nbsp; <kbd>Mouse</kbd> look &nbsp; <kbd>E</kbd> sit / stand &nbsp; <kbd>N</kbd> skip ahead &nbsp; <kbd>R</kbd> weather &nbsp; <kbd>Esc</kbd> menu'
        : kind === 'auto'
          ? '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk &nbsp; <kbd>Mouse</kbd> look &nbsp; <kbd>E</kbd> wave / get in / pay &nbsp; <kbd>N</kbd> skip ahead &nbsp; <kbd>T</kbd> time of day &nbsp; <kbd>R</kbd> weather &nbsp; <kbd>Esc</kbd> menu'
          : this.hintsHtml;
  }

  toast(text: string, ms = 1800): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }
}
