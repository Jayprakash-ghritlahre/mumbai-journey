import { RNG } from '../../core/Random';
import { ADS, DEVA, LATIN, drawAd, drawClockFace, drawDirectionSign, drawPlatformNumber, fitFont, type AdSpec, type AtlasRect, type DirLine, type SignAtlas } from '../../gfx/Signage';
import type { Ctx } from '../../gfx/TextureFactory';
import { drawNameBoard } from '../journey/StationBoards';

/**
 * Mira Road's signs, painted after the reference photos (assets/miraroad, reconstruction only).
 * Railway, municipal and transport signs follow the real ones' layout and wording; every shop
 * name, advert and hoarding is fictional.
 */

function grime(c: Ctx, w: number, h: number, seed: number, amount = 1): void {
  const rng = new RNG(seed);
  for (let i = 0; i < 8 * amount; i++) {
    const x = rng.range(0, w);
    const len = rng.range(h * 0.1, h * 0.7);
    const g = c.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(60,45,30,${0.14 * amount})`);
    g.addColorStop(1, 'rgba(60,45,30,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, rng.range(2, 9), len);
  }
  for (let i = 0; i < 5 * amount; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const r = rng.range(w * 0.02, w * 0.12);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(120,60,25,${0.18 * amount})`);
    g.addColorStop(1, 'rgba(120,60,25,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
}

function centred(c: Ctx, text: string, x: number, y: number, weight: string, family: string, max: number, width: number): void {
  c.font = `${weight} ${fitFont(c, text, weight, family, max, width)}px ${family}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, x, y);
}

/** The raised grey lettering on the white plaque in the pediment ("मिरा रोड / MIRA ROAD"). */
export function drawNamePlaque(c: Ctx, w: number, h: number): void {
  c.fillStyle = '#ece9e1';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#b9b5ab';
  c.lineWidth = h * 0.04;
  c.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h * 0.9);
  for (const [dx, col] of [
    [h * 0.025, 'rgba(40,36,30,0.45)'],
    [0, '#77736b'],
  ] as const) {
    c.fillStyle = col;
    centred(c, 'मिरा रोड', w / 2 + dx, h * 0.32 + dx, '700', DEVA, h * 0.34, w * 0.5);
    centred(c, 'MIRA ROAD', w / 2 + dx, h * 0.72 + dx, '700', LATIN, h * 0.34, w * 0.86);
  }
  grime(c, w, h, 7, 0.5);
}

/** The yellow corrugated board hung from the foot-over-bridge (photo 2): Marathi, Hindi, English. */
export function drawFobBoard(c: Ctx, w: number, h: number): void {
  c.fillStyle = '#e3bb1c';
  c.fillRect(0, 0, w, h);
  const n = 34;
  for (let i = 0; i < n; i++) {
    const g = c.createLinearGradient((i * w) / n, 0, ((i + 1) * w) / n, 0);
    g.addColorStop(0, 'rgba(90,60,0,0.22)');
    g.addColorStop(0.5, 'rgba(255,240,160,0.18)');
    g.addColorStop(1, 'rgba(90,60,0,0.22)');
    c.fillStyle = g;
    c.fillRect((i * w) / n, 0, w / n + 1, h);
  }
  c.fillStyle = '#16140f';
  centred(c, 'मीरा रोड', w * 0.27, h * 0.34, '700', DEVA, h * 0.42, w * 0.4);
  centred(c, 'मीरा रोड', w * 0.73, h * 0.34, '700', DEVA, h * 0.42, w * 0.4);
  centred(c, 'MIRA ROAD', w * 0.55, h * 0.76, '700', LATIN, h * 0.3, w * 0.5);
  grime(c, w, h, 11, 1);
}

/**
 * The older Western Railway diamond (photo 12): white diamond, red ring, blue bar with the name,
 * Devanagari above and below. Drawn turned −45° so the quad can be hung as a diamond.
 */
export function drawDiamond(c: Ctx, w: number, h: number): void {
  c.fillStyle = '#e9e7e0';
  c.fillRect(0, 0, w, h);
  c.save();
  c.translate(w / 2, h / 2);
  c.rotate(-Math.PI / 4);
  const s = w * 0.7;
  c.strokeStyle = '#c33a2e';
  c.lineWidth = s * 0.11;
  c.beginPath();
  c.arc(0, 0, s * 0.3, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = '#243f8f';
  c.fillRect(-s * 0.46, -s * 0.1, s * 0.92, s * 0.2);
  c.fillStyle = '#f4f4f4';
  centred(c, 'MIRA ROAD', 0, s * 0.005, '700', LATIN, s * 0.15, s * 0.84);
  c.fillStyle = '#141414';
  centred(c, 'मीरा रोड', 0, -s * 0.4, '700', DEVA, s * 0.13, s * 0.5);
  centred(c, 'मीरारोड', 0, s * 0.42, '700', DEVA, s * 0.12, s * 0.5);
  c.restore();
  // Rust bleeding from the bolts and edges.
  grime(c, w, h, 12, 1.2);
}

/** Small printed label: one or two lines. */
export function drawLabel(c: Ctx, w: number, h: number, top: string, bottom: string, bg: string, fg: string, border = true): void {
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  if (border) {
    c.strokeStyle = fg;
    c.lineWidth = h * 0.05;
    c.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h * 0.88);
  }
  c.fillStyle = fg;
  if (bottom) {
    centred(c, top, w / 2, h * 0.34, '700', /[ऀ-ॿ]/.test(top) ? DEVA : LATIN, h * 0.36, w * 0.88);
    centred(c, bottom, w / 2, h * 0.72, '700', /[ऀ-ॿ]/.test(bottom) ? DEVA : LATIN, h * 0.3, w * 0.88);
  } else centred(c, top, w / 2, h * 0.53, '700', /[ऀ-ॿ]/.test(top) ? DEVA : LATIN, h * 0.55, w * 0.88);
}

/** "Caution 25000 volts" (photo 12): white, red lettering. */
export function drawCaution(c: Ctx, w: number, h: number): void {
  c.fillStyle = '#ece9e1';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#b3342a';
  centred(c, 'सावधान', w / 2, h * 0.2, '700', DEVA, h * 0.2, w * 0.7);
  centred(c, 'CAUTION', w / 2, h * 0.48, '700', LATIN, h * 0.22, w * 0.8);
  centred(c, '25000 VOLTS', w / 2, h * 0.78, '700', LATIN, h * 0.2, w * 0.86);
  grime(c, w, h, 13, 1);
}

/** Mira-Bhayandar Municipal Corporation's "No parking" sign (main entrance photo). */
export function drawNoParking(c: Ctx, w: number, h: number): void {
  c.fillStyle = '#f2f2ee';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#1d3f93';
  c.lineWidth = w * 0.03;
  c.strokeRect(w * 0.02, h * 0.02, w * 0.96, h * 0.96);
  const cx = w / 2;
  const cy = h * 0.42;
  const r = w * 0.3;
  c.fillStyle = '#2350b8';
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fff';
  centred(c, 'P', cx, cy + r * 0.05, '700', LATIN, r * 1.5, r * 1.5);
  c.strokeStyle = '#d42a1e';
  c.lineWidth = r * 0.2;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.moveTo(cx - r * 0.7, cy - r * 0.7);
  c.lineTo(cx + r * 0.7, cy + r * 0.7);
  c.stroke();
  c.fillStyle = '#d42a1e';
  centred(c, 'M.B.M.C.', cx, cy - r * 0.62, '700', LATIN, r * 0.2, r * 0.9);
  c.fillStyle = '#1d3f93';
  centred(c, 'NO PARKING', cx, h * 0.84, '700', LATIN, h * 0.09, w * 0.6);
  for (const s of [-1, 1]) {
    c.beginPath();
    const ax = cx + s * w * 0.4;
    c.moveTo(ax + s * w * 0.05, h * 0.84);
    c.lineTo(ax - s * w * 0.02, h * 0.8);
    c.lineTo(ax - s * w * 0.02, h * 0.88);
    c.fill();
  }
  grime(c, w, h, 14, 0.5);
}

/** The two-wheeler pay-and-park board (outside photo 5), with made-up rates. */
export function drawPayPark(c: Ctx, w: number, h: number): void {
  c.fillStyle = '#f3f1ea';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#2046a0';
  c.lineWidth = h * 0.02;
  c.strokeRect(h * 0.02, h * 0.02, w - h * 0.04, h * 0.96);
  c.fillStyle = '#1a2a60';
  centred(c, 'दुचाकी वाहन सशुल्क पार्किंग', w / 2, h * 0.1, '700', DEVA, h * 0.08, w * 0.9);
  centred(c, 'PAY & PARK · TWO-WHEELERS', w / 2, h * 0.19, '700', LATIN, h * 0.06, w * 0.8);
  const cols = ['६ तास', '१२ तास', '२४ तास', 'मासिक पास'];
  const vals = ['₹ 10', '₹ 20', '₹ 30', '₹ 400'];
  c.lineWidth = 2;
  c.strokeStyle = '#1a2a60';
  for (let i = 0; i <= 4; i++) {
    c.beginPath();
    c.moveTo(w * 0.05 + (i * w * 0.9) / 4, h * 0.28);
    c.lineTo(w * 0.05 + (i * w * 0.9) / 4, h * 0.9);
    c.stroke();
  }
  for (const y of [0.28, 0.45, 0.9]) {
    c.beginPath();
    c.moveTo(w * 0.05, h * y);
    c.lineTo(w * 0.95, h * y);
    c.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const x = w * 0.05 + ((i + 0.5) * w * 0.9) / 4;
    centred(c, cols[i], x, h * 0.365, '700', DEVA, h * 0.07, w * 0.2);
    centred(c, vals[i], x, h * 0.6, '700', LATIN, h * 0.09, w * 0.2);
    centred(c, '+ GST', x, h * 0.76, '400', LATIN, h * 0.05, w * 0.2);
  }
  grime(c, w, h, 15, 0.6);
}

/** A shop's fascia board: name, a Devanagari line and a strapline (all fictional). */
export interface ShopSpec {
  name: string;
  deva: string;
  sub: string;
  bg: string;
  fg: string;
  band?: string;
}

export const SHOPS: ShopSpec[] = [
  { name: 'Shree Ganesh Medical', deva: 'श्री गणेश मेडिकल', sub: 'Chemist & Druggist · 24 Hours', bg: '#0f6d3a', fg: '#ffffff', band: '#d7263d' },
  { name: 'Sai Krupa Sweets', deva: 'साई कृपा स्वीट्स', sub: 'Farsan · Mithai · Namkeen', bg: '#f6c21a', fg: '#9a1b10' },
  { name: 'Mira Mobile Point', deva: 'मोबाईल · रिचार्ज · अॅक्सेसरीज', sub: 'Repairing in 1 hour', bg: '#1f4fa8', fg: '#ffffff', band: '#ffd400' },
  { name: 'New Balaji Footwear', deva: 'न्यू बालाजी फूटवेअर', sub: 'Ladies · Gents · Kids', bg: '#8b1a1a', fg: '#ffe9a8' },
  { name: 'Hotel Annapurna', deva: 'शुद्ध शाकाहारी', sub: 'Pure Veg · Thali · South Indian', bg: '#fff3e0', fg: '#b3261e', band: '#2e7d32' },
  { name: 'Sagar Snacks Corner', deva: 'वडापाव · समोसा · चहा', sub: 'Since 1998', bg: '#e65100', fg: '#ffffff' },
  { name: 'Om Sai Xerox', deva: 'झेरॉक्स · प्रिंटआउट · स्टेशनरी', sub: 'Lamination · Passport photo', bg: '#ffffff', fg: '#0d47a1', band: '#0d47a1' },
  { name: 'Bharat Opticians', deva: 'भारत ऑप्टिशियन्स', sub: 'Eye testing · Frames · Lenses', bg: '#263238', fg: '#80deea' },
  { name: 'Krishna Dairy', deva: 'कृष्णा डेअरी', sub: 'Milk · Curd · Paneer · Lassi', bg: '#e3f2fd', fg: '#1565c0', band: '#1565c0' },
  { name: 'Fresh Juice Centre', deva: 'ताजे फळांचे रस', sub: 'Mosambi · Pineapple · Falooda', bg: '#43a047', fg: '#fffde7' },
  { name: 'Laxmi Saree Centre', deva: 'लक्ष्मी साडी सेंटर', sub: 'Paithani · Silk · Cotton', bg: '#6a1b9a', fg: '#fff59d' },
  { name: 'Royal Tailors', deva: 'रॉयल टेलर्स', sub: 'Gents & Ladies tailoring', bg: '#212121', fg: '#ffca28' },
  { name: 'Anand Bakery', deva: 'आनंद बेकरी', sub: 'Pav · Khari · Cakes', bg: '#fbe9e7', fg: '#6d2c1e', band: '#bf360c' },
  { name: 'Jai Ambe Hardware', deva: 'जय अंबे हार्डवेअर', sub: 'Paints · Sanitary · Electricals', bg: '#ff8f00', fg: '#1a1a1a' },
  { name: 'Classic Men’s Salon', deva: 'क्लासिक सलून', sub: 'Hair cut · Shave · Facial', bg: '#37474f', fg: '#ffffff', band: '#e53935' },
  { name: 'Vighnaharta Travels', deva: 'विघ्नहर्ता ट्रॅव्हल्स', sub: 'Bus · Air · Rail tickets', bg: '#00838f', fg: '#ffffff' },
  { name: 'Patel Kirana Stores', deva: 'पटेल किराणा स्टोअर्स', sub: 'Grocery · Home delivery', bg: '#fff8e1', fg: '#2e7d32', band: '#f9a825' },
  { name: 'City Clinic', deva: 'सिटी क्लिनिक', sub: 'Dr. M. Kulkarni · M.B.B.S.', bg: '#ffffff', fg: '#c62828', band: '#c62828' },
  { name: 'Shubham Electronics', deva: 'शुभम इलेक्ट्रॉनिक्स', sub: 'TV · Fridge · AC · Washing machine', bg: '#1a237e', fg: '#ffeb3b' },
  { name: 'Mahavir Jewellers', deva: 'महावीर ज्वेलर्स', sub: 'Gold · Silver · Diamonds', bg: '#4a148c', fg: '#ffd54f' },
  { name: 'Hari Om Fruits', deva: 'हरी ओम फ्रूट्स', sub: 'Seasonal fruits · Wholesale', bg: '#558b2f', fg: '#ffffff' },
  { name: 'Aai Vada Pav', deva: 'आई वडापाव', sub: 'Hot · Fresh · Tasty', bg: '#ffeb3b', fg: '#b71c1c' },
  { name: 'Vishal Cycle Mart', deva: 'विशाल सायकल मार्ट', sub: 'Sales & Service', bg: '#0277bd', fg: '#ffffff', band: '#ff7043' },
  { name: 'Zoya Collection', deva: 'झोया कलेक्शन', sub: 'Ladies wear · Dress material', bg: '#ad1457', fg: '#ffffff' },
];

export function drawShopBoard(c: Ctx, w: number, h: number, s: ShopSpec, seed: number): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, s.bg);
  g.addColorStop(1, s.bg);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  if (s.band) {
    c.fillStyle = s.band;
    c.fillRect(0, h * 0.86, w, h * 0.14);
    c.fillRect(0, 0, w, h * 0.05);
  }
  c.fillStyle = s.fg;
  centred(c, s.name.toUpperCase(), w / 2, h * 0.34, '800', LATIN, h * 0.36, w * 0.92);
  centred(c, s.deva, w / 2, h * 0.63, '700', DEVA, h * 0.2, w * 0.8);
  c.globalAlpha = 0.85;
  centred(c, s.sub, w / 2, h * 0.8, '400', LATIN, h * 0.1, w * 0.8);
  c.globalAlpha = 1;
  grime(c, w, h, seed, 0.6);
}

/** Hoardings on the deck roof and on buildings: fictional, in the idiom of the photos. */
export const HOARDINGS: AdSpec[] = [
  { bg: ['#0b3d2e', '#1f7a55'], title: 'Ashray Greens', deva: 'मिरा रोड (पू.) · 1 आणि 2 BHK', sub: 'Possession 2027 · Site office open daily', accent: '#f5d547', motif: 'building', dark: true },
  { bg: ['#fff7e6', '#ffd9a0'], title: 'Freshers Can Do', deva: 'MHT-CET · NEET · JEE', sub: 'Admissions open · Vidya Academy, Mira Road', accent: '#e8412c', motif: 'stripes' },
  ADS[5],
  ADS[3],
  { bg: ['#eaf2ff', '#b9d3ff'], title: 'Metro Heights', deva: 'स्टेशनपासून 5 मिनिटे', sub: '2 & 3 BHK · Clubhouse · Pool', accent: '#1d4fa6', motif: 'building' },
  ADS[7],
];

export { drawAd, drawClockFace, drawDirectionSign, drawPlatformNumber };

/** The ATVM's front: screen, card and coin slots, the blue livery with its label. */
export function drawAtvm(c: Ctx, w: number, h: number): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#dfe3e6');
  g.addColorStop(1, '#b8bec3');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#1f4fa0';
  c.fillRect(0, 0, w, h * 0.12);
  c.fillStyle = '#fff';
  centred(c, 'ATVM', w / 2, h * 0.045, '800', LATIN, h * 0.05, w * 0.6);
  centred(c, 'स्वयंचलित तिकीट विक्री यंत्र', w / 2, h * 0.095, '700', DEVA, h * 0.03, w * 0.9);
  // Screen.
  const sx = w * 0.12;
  const sy = h * 0.17;
  const sw = w * 0.76;
  const sh = h * 0.3;
  c.fillStyle = '#0d1b33';
  c.fillRect(sx - 6, sy - 6, sw + 12, sh + 12);
  const sg = c.createLinearGradient(0, sy, 0, sy + sh);
  sg.addColorStop(0, '#1d5fbf');
  sg.addColorStop(1, '#0f3b85');
  c.fillStyle = sg;
  c.fillRect(sx, sy, sw, sh);
  c.fillStyle = '#fff';
  centred(c, 'UTS · Unreserved Ticketing', sx + sw / 2, sy + sh * 0.1, '700', LATIN, sh * 0.07, sw * 0.9);
  const btns = ['JOURNEY TICKET', 'SEASON TICKET', 'PLATFORM TICKET', 'SMART CARD RECHARGE'];
  btns.forEach((b, i) => {
    const by = sy + sh * (0.22 + i * 0.19);
    c.fillStyle = i === 0 ? '#ffd23f' : '#e8eef8';
    c.fillRect(sx + sw * 0.1, by, sw * 0.8, sh * 0.14);
    c.fillStyle = '#10244a';
    centred(c, b, sx + sw / 2, by + sh * 0.07, '700', LATIN, sh * 0.075, sw * 0.7);
  });
  // Card reader, printer slot, labels.
  c.fillStyle = '#2b2f33';
  c.fillRect(w * 0.18, h * 0.55, w * 0.25, h * 0.05);
  c.fillRect(w * 0.55, h * 0.72, w * 0.3, h * 0.03);
  c.fillStyle = '#1f4fa0';
  centred(c, 'SMART CARD', w * 0.3, h * 0.63, '700', LATIN, h * 0.022, w * 0.3);
  centred(c, 'TICKET', w * 0.7, h * 0.77, '700', LATIN, h * 0.022, w * 0.3);
  c.fillStyle = '#c62828';
  centred(c, 'WESTERN RAILWAY', w / 2, h * 0.9, '800', LATIN, h * 0.035, w * 0.8);
  grime(c, w, h, 17, 0.5);
}

/** Printed timetable sheet in a frame (pasted up by the stairs). */
export function drawTimetableSheet(c: Ctx, w: number, h: number, seed: number): void {
  const rng = new RNG(seed);
  c.fillStyle = '#f4f1e6';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#1b2e6b';
  centred(c, 'उपनगरीय वेळापत्रक · SUBURBAN TIMETABLE', w / 2, h * 0.05, '700', DEVA, h * 0.035, w * 0.9);
  c.fillStyle = '#222';
  c.font = `400 ${Math.round(h * 0.022)}px ${LATIN}`;
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  for (let r = 0; r < 34; r++)
    for (let k = 0; k < 4; k++) {
      const hh = 4 + Math.floor((r * 4 + k) / 6);
      const mm = rng.int(0, 59);
      const dest = rng.pick(['C', 'BO', 'A', 'DDR', 'V', 'BSR', 'NSP', 'BYR']);
      c.fillText(`${String(hh % 24).padStart(2, '0')}.${String(mm).padStart(2, '0')} ${dest} ${rng.chance(0.4) ? 'F' : 'S'}`, w * (0.04 + k * 0.24), h * (0.11 + r * 0.026));
    }
  grime(c, w, h, seed, 0.6);
}

/** All of Mira Road's sign rectangles in its atlas. */
export interface MiraSignSet {
  plaque: AtlasRect;
  fobBoard: AtlasRect;
  diamond: AtlasRect;
  /** The exit board at the south end of the PF 2/3 island (miraroad_exit.png). */
  exitBoard: AtlasRect;
  pf: Record<string, AtlasRect>;
  caution: AtlasRect;
  booking: AtlasRect;
  windows: AtlasRect[];
  atvm: AtlasRect;
  enquiry: AtlasRect;
  wayOut: AtlasRect;
  toPf4: AtlasRect;
  toFob: AtlasRect;
  toChurchgate: AtlasRect;
  toVirar: AtlasRect;
  skywalk: AtlasRect;
  noParking: AtlasRect;
  payPark: AtlasRect;
  autoStand: AtlasRect;
  busStop: AtlasRect;
  tea: AtlasRect;
  water: AtlasRect;
  ladies: AtlasRect;
  shops: AtlasRect[];
  hoardings: AtlasRect[];
  posters: AtlasRect[];
  timetable: AtlasRect;
  clock: AtlasRect;
}

export function buildMiraSigns(atlas: SignAtlas): MiraSignSet {
  const dir = (line: DirLine, arrow: 'left' | 'right' | 'up' | 'none', bg = '#1d4f9c', seed = 5) => atlas.add(512, 128, (c, w, h) => drawDirectionSign(c, w, h, line, arrow, bg, seed));
  const pf: Record<string, AtlasRect> = {};
  for (const n of ['1', '2', '3', '4']) pf[n] = atlas.add(128, 128, (c, w, h) => drawPlatformNumber(c, w, h, n));
  const set: MiraSignSet = {
    plaque: atlas.add(512, 192, drawNamePlaque),
    fobBoard: atlas.add(768, 192, drawFobBoard),
    diamond: atlas.add(256, 256, drawDiamond),
    exitBoard: atlas.add(704, 238, (c, w, h) => drawNameBoard(c, w, h, 'मीरा रोड', 'MIRA ROAD', 'mira')),
    pf,
    caution: atlas.add(192, 128, drawCaution),
    booking: dir({ mr: 'तिकीट घर', hi: 'टिकट घर', en: 'BOOKING OFFICE' }, 'none', '#1d4f9c', 21),
    windows: ['1 · UTS', '2 · UTS', '3 · SEASON / MST', '4 · LADIES · SR. CITIZEN', '5 · SMART CARD'].map((t) => atlas.add(256, 64, (c, w, h) => drawLabel(c, w, h, `खिडकी ${t.split(' · ')[0]}`, t.split(' · ').slice(1).join(' · '), '#f3f1ea', '#1d3f93'))),
    atvm: atlas.add(256, 512, drawAtvm),
    enquiry: dir({ mr: 'चौकशी', hi: 'पूछताछ', en: 'ENQUIRY' }, 'none', '#1d4f9c', 22),
    wayOut: dir({ mr: 'बाहेर जाण्याचा मार्ग', en: 'WAY OUT' }, 'up', '#1b7a3d', 23),
    toPf4: dir({ mr: 'फलाट क्र. ४', hi: 'प्लेटफार्म नं. ४', en: 'PLATFORM No. 4' }, 'up', '#1d4f9c', 24),
    toFob: dir({ mr: 'पादचारी पूल · फलाट १ २ ३', en: 'FOOT OVER BRIDGE · PF 1 2 3' }, 'up', '#1d4f9c', 25),
    toChurchgate: dir({ mr: 'चर्चगेट कडे', en: 'TOWARDS CHURCHGATE' }, 'right', '#1d4f9c', 26),
    toVirar: dir({ mr: 'विरार कडे', en: 'TOWARDS VIRAR' }, 'left', '#1d4f9c', 27),
    skywalk: dir({ mr: 'स्कायवॉक · मिरा रोड (पू.)', en: 'SKYWALK · MIRA ROAD (E)' }, 'right', '#1b7a3d', 28),
    noParking: atlas.add(256, 320, drawNoParking),
    payPark: atlas.add(512, 320, drawPayPark),
    autoStand: atlas.add(384, 128, (c, w, h) => drawLabel(c, w, h, 'रिक्षा थांबा', 'RICKSHAW STAND', '#0f6b3a', '#ffffff')),
    busStop: atlas.add(384, 128, (c, w, h) => drawLabel(c, w, h, 'बस थांबा · मिरा रोड स्टेशन', 'BUS STOP · MIRA ROAD STN', '#b71c1c', '#ffffff')),
    tea: atlas.add(384, 96, (c, w, h) => drawLabel(c, w, h, 'चहा · कॉफी · नाश्ता', 'TEA · COFFEE · SNACKS', '#c62828', '#fff4c2')),
    water: atlas.add(256, 96, (c, w, h) => drawLabel(c, w, h, 'पिण्याचे पाणी', 'DRINKING WATER', '#1565c0', '#ffffff')),
    ladies: atlas.add(256, 96, (c, w, h) => drawLabel(c, w, h, 'महिला डबा', 'LADIES', '#ad1457', '#ffffff')),
    shops: SHOPS.map((s, i) => atlas.add(512, 128, (c, w, h) => drawShopBoard(c, w, h, s, 100 + i))),
    hoardings: HOARDINGS.map((a, i) => atlas.add(512, 224, (c, w, h) => drawAd(c, w, h, a, 200 + i))),
    posters: [ADS[0], ADS[1], ADS[4], ADS[8], ADS[9], ADS[2]].map((a, i) => atlas.add(160, 224, (c, w, h) => drawAd(c, w, h, a, 300 + i))),
    timetable: atlas.add(256, 360, (c, w, h) => drawTimetableSheet(c, w, h, 41)),
    clock: atlas.add(256, 256, drawClockFace),
  };
  return set;
}

// ---- The auto ride's streets (AUTO_RIDE.md): own small atlas ------------------------------------

/** A housing society's name board by its gate (all names fictional). */
export interface SocietySpec {
  name: string;
  deva: string;
  bg: string;
  fg: string;
}

export const SOCIETIES: SocietySpec[] = [
  { name: 'Sai Darshan Co-op. Hsg. Soc. Ltd.', deva: 'साई दर्शन को-ऑप. हौ. सो. लि.', bg: '#f5efe1', fg: '#7a1b14' },
  { name: 'Gokul Dham Co-op. Hsg. Soc.', deva: 'गोकुळ धाम को-ऑप. हौ. सो.', bg: '#e9f1f7', fg: '#173f7a' },
  { name: 'Shree Krishna Kunj C.H.S.', deva: 'श्री कृष्ण कुंज', bg: '#fff6d8', fg: '#2f5d1a' },
  { name: 'Jeevan Jyot Co-op. Hsg. Soc.', deva: 'जीवन ज्योत को-ऑप. हौ. सो.', bg: '#f7e8e4', fg: '#5b1a3a' },
  { name: 'Om Shanti Apartments', deva: 'ॐ शांती अपार्टमेंट', bg: '#eef5ec', fg: '#1d4d2a' },
  { name: 'Navkar Co-op. Hsg. Soc. Ltd.', deva: 'नवकार को-ऑप. हौ. सो. लि.', bg: '#f1ece6', fg: '#3a2a1a' },
];

export function drawSocietyBoard(c: Ctx, w: number, h: number, s: SocietySpec, seed: number): void {
  c.fillStyle = s.bg;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = s.fg;
  c.lineWidth = h * 0.045;
  c.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h * 0.88);
  c.fillStyle = s.fg;
  centred(c, s.deva, w / 2, h * 0.3, '700', DEVA, h * 0.26, w * 0.88);
  centred(c, s.name.toUpperCase(), w / 2, h * 0.58, '800', LATIN, h * 0.18, w * 0.88);
  c.globalAlpha = 0.8;
  centred(c, 'Shanti Nagar, Sector 2, Mira Road (E)', w / 2, h * 0.8, '400', LATIN, h * 0.11, w * 0.8);
  c.globalAlpha = 1;
  grime(c, w, h, seed, 0.7);
}

/** The municipal corporation's road name board (blue, white lettering) ⚠ layout generic. */
export function drawRoadBoard(c: Ctx, w: number, h: number, deva: string, en: string, bg = '#174f9c'): void {
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#ffffff';
  c.lineWidth = h * 0.04;
  c.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h * 0.88);
  c.fillStyle = '#ffffff';
  centred(c, deva, w / 2, h * 0.33, '700', DEVA, h * 0.32, w * 0.86);
  centred(c, en, w / 2, h * 0.66, '800', LATIN, h * 0.24, w * 0.86);
  c.globalAlpha = 0.85;
  centred(c, 'मीरा-भाईंदर महानगरपालिका', w / 2, h * 0.86, '400', DEVA, h * 0.1, w * 0.6);
  c.globalAlpha = 1;
  grime(c, w, h, 61, 0.6);
}

/** A vinyl banner strung between two posts (fictional greetings and notices). */
export interface BannerSpec {
  bg: [string, string];
  title: string;
  sub: string;
  fg: string;
  accent: string;
}

export const BANNERS: BannerSpec[] = [
  { bg: ['#ff9f1c', '#ffd23f'], title: 'गणेशोत्सवाच्या हार्दिक शुभेच्छा!', sub: 'Shanti Nagar Sarvajanik Ganeshotsav Mandal · Sector 2', fg: '#7a0d0d', accent: '#c1121f' },
  { bg: ['#e3f2fd', '#bbdefb'], title: 'मोफत आरोग्य तपासणी शिबीर', sub: 'Free health check-up camp · Sunday 9 am – 1 pm · Sector 4 hall', fg: '#0d3b78', accent: '#2e7d32' },
  { bg: ['#6a1b9a', '#d81b60'], title: 'नवरात्री दांडिया रास', sub: 'Dandiya nights · Poonam Sagar ground · Passes at the society office', fg: '#fff4c2', accent: '#ffd23f' },
];

export function drawBanner(c: Ctx, w: number, h: number, b: BannerSpec, seed: number): void {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, b.bg[0]);
  g.addColorStop(1, b.bg[1]);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = b.accent;
  c.fillRect(0, 0, w, h * 0.07);
  c.fillRect(0, h * 0.93, w, h * 0.07);
  // Marigold strings at the ends.
  for (const x0 of [h * 0.35, w - h * 0.35]) {
    for (let i = 0; i < 7; i++) {
      c.fillStyle = i % 2 ? '#ff8f00' : '#ffd000';
      c.beginPath();
      c.arc(x0, h * (0.16 + i * 0.12), h * 0.06, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.fillStyle = b.fg;
  centred(c, b.title, w / 2, h * 0.4, '700', DEVA, h * 0.36, w * 0.76);
  centred(c, b.sub, w / 2, h * 0.75, '700', LATIN, h * 0.15, w * 0.78);
  grime(c, w, h, seed, 0.35);
}

/**
 * The shops round the station as they stand (the user's Street View captures, Dec 2021 and Apr 2026):
 * name boards in each shop's colours and lettering style, drawn here (no logos copied).
 */
export interface StationShopSpec {
  key: string;
  draw: (c: Ctx, w: number, h: number) => void;
}

function vegMark(c: Ctx, x: number, y: number, s: number): void {
  c.fillStyle = '#ffffff';
  c.fillRect(x - s / 2, y - s / 2, s, s);
  c.strokeStyle = '#1b8f2e';
  c.lineWidth = s * 0.12;
  c.strokeRect(x - s * 0.42, y - s * 0.42, s * 0.84, s * 0.84);
  c.fillStyle = '#1b8f2e';
  c.beginPath();
  c.arc(x, y, s * 0.22, 0, Math.PI * 2);
  c.fill();
}

export const STATION_SHOPS: StationShopSpec[] = [
  {
    key: 'vegSagar',
    draw: (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2e7d32');
      g.addColorStop(1, '#1b5e20');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#fdd835';
      c.fillRect(0, h * 0.86, w, h * 0.14);
      vegMark(c, h * 0.42, h * 0.42, h * 0.38);
      c.fillStyle = '#ffffff';
      centred(c, 'VEG SAGAR', w * 0.55, h * 0.33, '800', LATIN, h * 0.4, w * 0.7);
      c.fillStyle = '#fff59d';
      centred(c, 'व्हेज सागर · शुद्ध शाकाहारी', w * 0.55, h * 0.64, '700', DEVA, h * 0.17, w * 0.7);
      c.fillStyle = '#1b5e20';
      centred(c, 'Pure Veg Restaurant · South Indian · Punjabi · Chinese', w / 2, h * 0.93, '700', LATIN, h * 0.09, w * 0.9);
      grime(c, w, h, 701, 0.5);
    },
  },
  {
    key: 'bikaner',
    draw: (c, w, h) => {
      c.fillStyle = '#b71c1c';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#fbc02d';
      c.fillRect(0, 0, w, h * 0.08);
      c.fillRect(0, h * 0.92, w, h * 0.08);
      c.fillStyle = '#ffeb3b';
      centred(c, 'BIKANER', w / 2, h * 0.38, '800', '"Noto Serif", "Noto Sans", serif', h * 0.44, w * 0.8);
      c.fillStyle = '#ffffff';
      centred(c, 'बीकानेर स्वीट्स · Sweets · Namkeen · Snacks', w / 2, h * 0.74, '700', DEVA, h * 0.15, w * 0.86);
      grime(c, w, h, 702, 0.5);
    },
  },
  {
    key: 'jio',
    draw: (c, w, h) => {
      c.fillStyle = '#0a2885';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(h * 0.62, h / 2, h * 0.36, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#0a2885';
      centred(c, 'Jio', h * 0.62, h * 0.53, '800', LATIN, h * 0.32, h * 0.6);
      c.fillStyle = '#ffffff';
      c.textAlign = 'left';
      c.font = `800 ${Math.round(h * 0.34)}px ${LATIN}`;
      c.textBaseline = 'middle';
      c.fillText('Jio', h * 1.15, h * 0.4);
      c.font = `400 ${Math.round(h * 0.16)}px ${LATIN}`;
      c.fillText('Store · Mobiles · Recharge · JioFiber', h * 1.15, h * 0.72);
      grime(c, w, h, 703, 0.35);
    },
  },
  {
    key: 'monginis',
    draw: (c, w, h) => {
      const g = c.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#ad1457');
      g.addColorStop(1, '#d81b60');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      centred(c, 'monginis', w / 2, h * 0.42, 'italic 800', '"Noto Serif", "Noto Sans", serif', h * 0.5, w * 0.72);
      c.globalAlpha = 0.9;
      centred(c, 'The Cake Shop', w / 2, h * 0.78, '400', LATIN, h * 0.14, w * 0.6);
      c.globalAlpha = 1;
      grime(c, w, h, 704, 0.4);
    },
  },
  {
    key: 'jumboking',
    draw: (c, w, h) => {
      c.fillStyle = '#ffd400';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#d32f2f';
      c.fillRect(0, h * 0.84, w, h * 0.16);
      c.fillStyle = '#c62828';
      centred(c, "JK'S", w * 0.12, h * 0.4, '800', LATIN, h * 0.2, w * 0.14);
      centred(c, 'JUMBOKING', w * 0.56, h * 0.42, '900', LATIN, h * 0.44, w * 0.74);
      c.fillStyle = '#ffffff';
      centred(c, 'Vada Pav · Burgers · since 2001', w / 2, h * 0.92, '700', LATIN, h * 0.11, w * 0.8);
      grime(c, w, h, 705, 0.5);
    },
  },
  {
    key: 'oppo',
    draw: (c, w, h) => {
      c.fillStyle = '#0b8a4a';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      centred(c, 'OPPO', w / 2, h * 0.45, '400', LATIN, h * 0.55, w * 0.5);
      centred(c, 'Mobile Gallery · Authorised Store', w / 2, h * 0.84, '400', LATIN, h * 0.11, w * 0.7);
      grime(c, w, h, 706, 0.3);
    },
  },
  {
    key: 'ambika',
    draw: (c, w, h) => {
      c.fillStyle = '#c62828';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#ffeb3b';
      c.lineWidth = h * 0.05;
      c.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h * 0.88);
      c.fillStyle = '#ffeb3b';
      centred(c, 'AMBIKA', w / 2, h * 0.4, '800', LATIN, h * 0.42, w * 0.6);
      c.fillStyle = '#ffffff';
      centred(c, 'अंबिका', w / 2, h * 0.75, '700', DEVA, h * 0.22, w * 0.5);
      grime(c, w, h, 707, 0.5);
    },
  },
  {
    key: 'udupi',
    draw: (c, w, h) => {
      c.fillStyle = '#b71c1c';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff176';
      centred(c, 'उडुपी हॉटेल', w / 2, h * 0.4, '700', DEVA, h * 0.42, w * 0.8);
      c.fillStyle = '#ffffff';
      centred(c, 'UDUPI HOTEL · Idli · Dosa · Meals', w / 2, h * 0.8, '700', LATIN, h * 0.15, w * 0.8);
      grime(c, w, h, 708, 0.5);
    },
  },
  {
    key: 'generic',
    draw: (c, w, h) => {
      c.fillStyle = '#1e7d32';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      const cx = h * 0.5;
      c.fillRect(cx - h * 0.08, h * 0.2, h * 0.16, h * 0.6);
      c.fillRect(cx - h * 0.3, h * 0.42, h * 0.6, h * 0.16);
      centred(c, 'GENERIC MEDICAL', w * 0.57, h * 0.38, '800', LATIN, h * 0.34, w * 0.76);
      c.fillStyle = '#c8e6c9';
      centred(c, 'जेनेरिक मेडिकल · Medicines at lower prices', w * 0.57, h * 0.76, '700', DEVA, h * 0.14, w * 0.76);
      grime(c, w, h, 709, 0.5);
    },
  },
  {
    key: 'unionBank',
    draw: (c, w, h) => {
      c.fillStyle = '#d32f2f';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      c.fillRect(h * 0.18, h * 0.18, h * 0.64, h * 0.64);
      c.fillStyle = '#d32f2f';
      c.fillRect(h * 0.3, h * 0.3, h * 0.12, h * 0.4);
      c.fillRect(h * 0.58, h * 0.3, h * 0.12, h * 0.4);
      c.fillRect(h * 0.3, h * 0.58, h * 0.4, h * 0.12);
      c.fillStyle = '#ffffff';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.font = `800 ${Math.round(h * 0.34)}px ${LATIN}`;
      c.fillText('Union Bank', h * 1.05, h * 0.36);
      c.font = `700 ${Math.round(h * 0.2)}px ${DEVA}`;
      c.fillText('यूनियन बैंक ऑफ इंडिया · of India', h * 1.05, h * 0.72);
      grime(c, w, h, 710, 0.3);
    },
  },
  {
    key: 'bharatBank',
    draw: (c, w, h) => drawLabel(c, w, h, 'भारत को-ऑप. बँक (मुंबई) लि.', 'BHARAT CO-OP. BANK (MUMBAI) LTD.', '#1d4f9c', '#ffffff'),
  },
  {
    key: 'dorm',
    draw: (c, w, h) => {
      c.fillStyle = '#fafafa';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#c62828';
      centred(c, 'FULLY A/C DORMITORY', w / 2, h * 0.32, '800', LATIN, h * 0.3, w * 0.9);
      c.fillStyle = '#1a237e';
      centred(c, '& PERSONAL CABIN · डॉर्मिटरी', w / 2, h * 0.72, '700', DEVA, h * 0.22, w * 0.9);
      grime(c, w, h, 711, 0.7);
    },
  },
  {
    key: 'centre',
    draw: (c, w, h) => drawLabel(c, w, h, 'शांती शॉपिंग सेंटर', 'SHANTI SHOPPING CENTRE', '#f3ead8', '#6d1b1b'),
  },
];

/** First-floor boards along the route's shops (all fictional): classes, clinics, agents. */
export const UPPER_BOARDS: [string, string, string, string][] = [
  ['सक्सेस अकॅडमी', 'SUCCESS ACADEMY · SSC · HSC · CET', '#0d47a1', '#ffffff'],
  ['डॉ. पटेल डेंटल क्लिनिक', "DR. PATEL'S DENTAL CLINIC", '#ffffff', '#00695c'],
  ['श्री गणेश ट्रॅव्हल्स', 'SHREE GANESH TOURS & TRAVELS', '#ffeb3b', '#b71c1c'],
  ['साई फिजिओथेरपी', 'SAI PHYSIOTHERAPY CENTRE', '#e3f2fd', '#1565c0'],
  ['लकी लेडीज टेलर', 'LUCKY LADIES TAILOR', '#880e4f', '#ffffff'],
  ['ओम सर्व्हिसेस', 'OM SERVICES · PAN · AADHAAR · INSURANCE', '#ff6f00', '#ffffff'],
];

export interface FirstMileSigns {
  societies: AtlasRect[];
  sector: AtlasRect;
  poonamSagar: AtlasRect;
  toStation: AtlasRect;
  banners: AtlasRect[];
  station: Record<string, AtlasRect>;
  upper: AtlasRect[];
  /** A festival greeting banner across a facade (fictional). */
  bigBanner: AtlasRect;
}

export function buildFirstMileSigns(atlas: SignAtlas): FirstMileSigns {
  return {
    societies: SOCIETIES.map((s, i) => atlas.add(384, 128, (c, w, h) => drawSocietyBoard(c, w, h, s, 500 + i))),
    sector: atlas.add(512, 160, (c, w, h) => drawRoadBoard(c, w, h, 'शांती नगर · सेक्टर २', 'SHANTI NAGAR · SECTOR 2', '#1b6b3a')),
    poonamSagar: atlas.add(512, 160, (c, w, h) => drawRoadBoard(c, w, h, 'पूनम सागर रोड', 'POONAM SAGAR ROAD')),
    toStation: atlas.add(512, 160, (c, w, h) => drawDirectionSign(c, w, h, { mr: 'मीरा रोड स्टेशन', en: 'MIRA ROAD STATION' }, 'left', '#1b7a3d', 62)),
    banners: BANNERS.map((b, i) => atlas.add(1024, 176, (c, w, h) => drawBanner(c, w, h, b, 520 + i))),
    station: Object.fromEntries(STATION_SHOPS.map((q) => [q.key, atlas.add(512, 128, q.draw)])),
    upper: UPPER_BOARDS.map(([d, e, bg, fg]) => atlas.add(512, 96, (c, w, h) => drawLabel(c, w, h, d, e, bg, fg))),
    bigBanner: atlas.add(1024, 384, drawBigBanner),
  };
}

/** A big festival greeting on a facade (fictional mandal; figures as plain silhouettes). */
export function drawBigBanner(c: Ctx, w: number, h: number): void {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#ff8f00');
  g.addColorStop(0.55, '#ffca28');
  g.addColorStop(1, '#ef6c00');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#1b5e20';
  c.fillRect(0, h * 0.86, w, h * 0.14);
  // Three portrait roundels (silhouettes), as on every such banner.
  for (let k = 0; k < 3; k++) {
    const x = w * (0.1 + k * 0.12);
    const y = h * 0.42;
    c.fillStyle = '#fff3e0';
    c.beginPath();
    c.arc(x, y, h * 0.22, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#5d4037';
    c.beginPath();
    c.arc(x, y - h * 0.05, h * 0.08, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(x, y + h * 0.13, h * 0.13, h * 0.09, 0, Math.PI, 0);
    c.fill();
  }
  c.fillStyle = '#b71c1c';
  centred(c, 'दिवाळीच्या हार्दिक शुभेच्छा!', w * 0.68, h * 0.32, '800', DEVA, h * 0.2, w * 0.58);
  c.fillStyle = '#4e342e';
  centred(c, 'मीरा रोड (पूर्व) येथील सर्व नागरिकांना', w * 0.68, h * 0.58, '700', DEVA, h * 0.11, w * 0.56);
  c.fillStyle = '#ffffff';
  centred(c, 'Shanti Nagar Yuva Mitra Mandal', w / 2, h * 0.93, '700', LATIN, h * 0.08, w * 0.6);
  grime(c, w, h, 712, 0.6);
}
