/**
 * Pure helpers for the Soll-Fahrplan vehicle layer.
 *
 * ⚠️ EXTRACTED BECAUSE THESE ARE THE PARTS THAT ARE WRONG QUIETLY. A misclassified mode draws a
 * 67 m suburban unit as a 37 m tram, and a mistaken service day puts the wrong network on the
 * map; neither throws, and both look entirely plausible on screen.
 */

/**
 * Which mode a line is, from its label first and its route_type second.
 *
 * ⚠️ THE FEED CALLS S-BAHN LINES route_type 0, THE CODE FOR A TRAM. Measured 2026-09-22 in
 * gesamt_gtfs.zip: S1 to S8 sit in the same type as lines 12 and 19. Trusting the type alone
 * would draw every S-Bahn at tram length.
 *
 * ⚠️ "SEV" IS A BUS. Schienenersatzverkehr replaces a rail service and its label begins with S,
 * so a naive prefix test draws a replacement bus as an S-Bahn.
 *
 * @param {string} label route_short_name
 * @param {string} type  GTFS route_type as published
 * @returns {'tram'|'ubahn'|'bus'|'sbahn'}
 */
export function modeOfLine(label, type) {
  const name = String(label ?? '').trim().toUpperCase();
  if (name.startsWith('SEV')) return 'bus';
  if (type === '1' || /^U\d*$/.test(name)) return 'ubahn';
  if (/^S\d+$/.test(name)) return 'sbahn';
  if (type === '3') return 'bus';
  return 'tram';
}

/** `20260922` for a Date, in its own local time. */
export function serviceStamp(date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}${month}${day}`;
}

/**
 * The service day before a given one.
 *
 * ⚠️ DATE ARITHMETIC, NOT "MINUS 86 400 000 ms". On the night the clocks go forward,
 * subtracting 24 hours from 00:30 lands at 23:30 two days earlier and skips a whole service day.
 * Constructing the previous date at midday keeps it clear of both transitions.
 */
export function previousServiceDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 12, 0, 0);
}

/**
 * Which service slots run on a date.
 *
 * ⚠️ EXCEPTIONS OVERRIDE THE WEEKDAY PATTERN IN BOTH DIRECTIONS. A public holiday removes the
 * weekday service and adds the Sunday one. Honouring only the weekday pattern would run a full
 * Monday service on Christmas Day; honouring only removals would run nothing at all.
 *
 * @param {Date} date
 * @param {Record<string, {d: string, f: string, u: string}>} kalender
 * @param {Record<string, Record<string, number>>} ausnahmen
 * @returns {Set<number>}
 */
export function servicesOnDate(date, kalender, ausnahmen) {
  const out = new Set();
  const stamp = serviceStamp(date);
  // GTFS weekday order starts at Monday; JavaScript's getDay() starts at Sunday.
  const weekday = (date.getDay() + 6) % 7;

  for (const [slot, entry] of Object.entries(kalender ?? {})) {
    if (!entry || typeof entry.d !== 'string') continue;
    if (stamp < entry.f || stamp > entry.u) continue;
    if (entry.d[weekday] === '1') out.add(Number(slot));
  }
  for (const [slot, kind] of Object.entries((ausnahmen ?? {})[stamp] ?? {})) {
    if (kind === 1) out.add(Number(slot));
    else out.delete(Number(slot));
  }
  return out;
}
