/**
 * Woher die gebauten Geodaten geladen werden.
 *
 * ⚠️ DAS IST EINE GRÖSSENGRENZE, KEINE VORLIEBE. Fabric hostet die Anwendung als statisches Paket
 * mit einer Obergrenze von 100 MB komprimiert, und `public/terrain/` wiegt allein rund 240 MB über
 * elf Standorte. Solange die Kacheln IM Paket stecken, ist das Portfolio also bei neun oder zehn
 * Hochschulen zu Ende, und `config/release.json` musste zwei Standorte streichen, die niemand aus
 * inhaltlichen Gründen streichen wollte. Werden dieselben Dateien von einer Blob-Website geladen,
 * schrumpft das Paket auf wenige Megabyte und die Grenze verschwindet aus der Entscheidung.
 *
 * ⚠️ DER STANDARD BLEIBT `/terrain`, UND DAS IST WICHTIG. Ohne gesetzte Variable verhält sich alles
 * exakt wie vorher: Entwicklungsserver, Vitest und die Playwright-Läufe holen die Dateien aus
 * `public/terrain/`, ohne Netz und ohne Konto. Wer die Umgebungsvariable nicht kennt, merkt von
 * dieser Änderung nichts.
 *
 * ⚠️ ES WIRD NICHT GERATEN. Eine leere oder nur aus Leerzeichen bestehende Variable ist dasselbe
 * wie „nicht gesetzt" — eine halb ausgefüllte `.env` würde sonst `//<aoi>/meta.json` anfragen und
 * das sieht im Netzwerkprotokoll aus wie ein Serverfehler, nicht wie ein Konfigurationsfehler.
 * Ein abschließender Schrägstrich wird entfernt, weil jeder Aufrufer `${base}/${aoi}/…` bildet.
 */
const raw = (import.meta.env.VITE_TERRAIN_BASE ?? '').trim();

export const TERRAIN_BASE = raw ? raw.replace(/\/+$/, '') : '/terrain';

/** Wahr, wenn die Kacheln von außerhalb des Pakets kommen. Nur für Diagnose und Prüfskripte. */
export const TERRAIN_IS_REMOTE = /^https?:\/\//i.test(TERRAIN_BASE);
