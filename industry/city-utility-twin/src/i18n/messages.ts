/**
 * Every app-authored sentence, in German and English, side by side.
 *
 * ⚠️ APP TEXT ONLY. Values that come from a source (a street name, a category the city
 * published, a model's answer) are shown as published and never pass through here. Translating
 * them would put words in the data owner's mouth.
 *
 * ⚠️ BOTH LANGUAGES IN ONE ENTRY, ON PURPOSE. Two separate dictionaries drift: a key added to
 * one and forgotten in the other only shows up when somebody happens to switch language in
 * front of an audience. Here a missing language is a type error.
 */

type Fn<A extends unknown[]> = (...args: A) => string;

interface Entry<A extends unknown[]> {
  de: Fn<A>;
  en: Fn<A>;
}

const s = (de: string, en: string): Entry<[]> => ({ de: () => de, en: () => en });
const f = <A extends unknown[]>(de: Fn<A>, en: Fn<A>): Entry<A> => ({ de, en });

/** English plural for counted nouns; German keeps the published plural form. */
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const MESSAGES = {
  // ------------------------------------------------------------------ shell
  'app.canvas': s(
    'Interaktive 3D-Karte von München und dem Flughafen München',
    'Interactive 3D map of Munich and Munich Airport',
  ),
  'loading.title': f((brand: string) => `${brand} wird geladen`, (brand: string) => `Loading ${brand}`),
  'loading.preparing': s('Die Ansicht wird vorbereitet…', 'Preparing the view…'),
  'loading.progress': s('Ladefortschritt der Karte', 'Map loading progress'),
  'loading.note': s(
    'Zwei hochaufgelöste Bereiche. Der erste Aufbau dauert einen Moment.',
    'Two high-resolution areas. The first build takes a moment.',
  ),
  'loading.stage.terrain': s('Gelände', 'Terrain'),
  'loading.stage.drape': s('Luftbild', 'Aerial image'),
  'loading.stage.buildings': s('Gebäude', 'Buildings'),
  'loading.stage.vegetation': s('Bäume', 'Trees'),
  'error.title': s('Karte nicht verfügbar', 'Map unavailable'),
  'error.body': s(
    'Die Karte konnte nicht geladen werden. Bitte Verbindung prüfen und neu laden.',
    'The map could not be loaded. Please check the connection and reload.',
  ),
  'error.retry': s('Neu laden', 'Reload'),
  'sites.label': s('Ort wählen', 'Choose a site'),
  'controls.label': s('Kartennavigation', 'Map navigation'),
  'controls.north': s('Nach Norden ausrichten', 'Face north'),
  'controls.home': s('Ansicht zurücksetzen', 'Reset view'),
  'controls.language': s('Switch to English', 'Auf Deutsch umschalten'),
  'controls.languageShort': s('EN', 'DE'),
  'hint.navigation': s(
    'Ziehen zum Drehen · Umschalt + Ziehen zum Verschieben · Scrollen zum Zoomen · Klick für Details · WASD zum Fliegen · Esc zum Loslassen',
    'Drag to rotate · Shift + drag to pan · Scroll to zoom · Click for details · WASD to fly · Esc to release',
  ),
  'hud.flight': f(
    (alt: number, agl: string, speed: number, heading: number) =>
      `Höhe ${alt} m · über Grund ${agl} m · ${speed} m/s · Kurs ${heading}° · Esc zum Loslassen`,
    (alt: number, agl: string, speed: number, heading: number) =>
      `Altitude ${alt} m · above ground ${agl} m · ${speed} m/s · heading ${heading}° · Esc to release`,
  ),

  // ------------------------------------------------------------------ layer panel
  'layers.title': s('Datenebenen', 'Data layers'),
  'layers.note': s(
    'Jede Ebene stammt aus einer offenen Quelle, die meisten live abgefragt. Es werden keine erfundenen Daten dargestellt; wo etwas berechnet statt gemessen ist, steht es an der Ebene.',
    'Every layer comes from an open source, most of them queried live. Nothing invented is shown; where a value is computed rather than measured, the layer says so.',
  ),
  'layer.off': s('aus', 'off'),
  'layer.preparing': s('wird vorbereitet…', 'preparing…'),
  'layer.unavailable': s('Ebene nicht verfügbar', 'Layer unavailable'),
  'layer.notIncluded': s('nicht enthalten', 'not included'),
  'layer.unofficialOff': s(
    'in dieser Version aus (inoffizielle Schnittstelle ohne veröffentlichte Nutzungsbedingungen)',
    'off in this build (unofficial interface without published terms of use)',
  ),
  'layer.symbols': f((source: string) => `${source} · Markierungen sind Symbole`, (source: string) => `${source} · markers are symbols`),
  'layer.group': f((group: string, count: number) => `${group} (${count})`, (group: string, count: number) => `${group} (${count})`),
  'layer.refresh': s('Neu laden', 'Reload'),
  'layer.refreshTitle': s('Koordinationsnotizen neu laden', 'Reload coordination notes'),
  'layer.refreshing': s('Lädt …', 'Loading…'),

  'layer.flugverkehr.name': s('Flugverkehr', 'Air traffic'),
  'layer.flugverkehr.source': s('ADS-B, adsb.lol', 'ADS-B, adsb.lol'),
  'layer.baustellen.name': s('Baustellen und Halteverbote', 'Roadworks and no-stopping zones'),
  'layer.baustellen.source': s('Landeshauptstadt München, WFS', 'City of Munich, WFS'),
  'layer.mvg.name': s('MVG Echtzeit', 'MVG real time'),
  'layer.mvg.source': s('MVG Abfahrten, live', 'MVG departures, live'),
  'layer.fahrzeuge.name': s('Fahrzeuge auf der Strecke', 'Vehicles on the network'),
  'layer.fahrzeuge.source': s(
    'MVV Soll-Fahrplan (GTFS), Fahrplanstand 09/2026 · Positionen aus den Soll-Abfahrtszeiten berechnet, keine Fahrzeugortung · Fahrweg als gerade Linie zwischen den Haltestellen, kein Gleisverlauf · U-Bahn und S-Bahn fahren hier im Tunnel und werden transparent an der Oberfläche gezeigt',
    'MVV planned service (GTFS), data as of 09/2026 · positions computed from planned departure times, no vehicle tracking · path drawn as a straight line between stops, not the track · U-Bahn and S-Bahn run in tunnels here and are shown transparent at the surface',
  ),
  'layer.luft-amtlich.name': s('Luftqualität amtlich', 'Air quality, official'),
  'layer.luft-amtlich.source': s(
    'Umweltbundesamt, stündlich · Säulenhöhe und Farbe nach veröffentlichtem Index (0 = niedrigste gemessene Stufe)',
    'German Environment Agency, hourly · column height and colour follow the published index (0 = lowest measured class)',
  ),
  'layer.luft-buerger.name': s('Luftqualität Bürgermessnetz', 'Air quality, citizen sensors'),
  'layer.luft-buerger.source': s(
    'Sensor.Community, nicht amtlich kalibriert · Farbe = PM₂,₅ in µg/m³ (≤5 / 10 / 20 / 40 / darüber) · Kugeln sind Symbole',
    'Sensor.Community, not officially calibrated · colour = PM2.5 in µg/m³ (≤5 / 10 / 20 / 40 / above) · spheres are symbols',
  ),
  'layer.koordination.name': s('Koordinationsnotizen', 'Coordination notes'),
  'layer.koordination.source': s(
    'Diese Anwendung, nicht amtlich · Anmerkungen zu Baustellen',
    'This app, not official · notes on roadworks',
  ),

  // ------------------------------------------------------------------ shared status words
  'status.asOf': f((clock: string) => `Stand ${clock}`, (clock: string) => `as of ${clock}`),
  'status.fetched': f((clock: string) => `Abruf ${clock}`, (clock: string) => `fetched ${clock}`),
  'status.offMap': f((count: number) => `${count} außerhalb des Modells`, (count: number) => `${count} outside the model`),
  'status.notOfficial': s('nicht amtlich', 'not official'),
  'status.noFeatures': s('keine Einträge im Kartenausschnitt', 'nothing in the map extent'),
  'error.timeout': s('Zeitüberschreitung', 'timed out'),
  'error.aborted': s('abgebrochen', 'cancelled'),
  'error.unreachable': s('nicht erreichbar (Netzwerk oder CORS)', 'unreachable (network or CORS)'),
  'error.unknown': s('unbekannter Fehler', 'unknown error'),
  'error.tooLarge': s('Antwort zu groß', 'response too large'),
  'error.tooLargeBytes': f((bytes: number) => `Antwort zu groß (${bytes} Bytes)`, (bytes: number) => `response too large (${bytes} bytes)`),
  'error.prefixed': f((what: string, why: string) => `${what} ${why}`, (what: string, why: string) => `${what}: ${why}`),

  // ------------------------------------------------------------------ roadworks
  'roadworks.loading': s('Baustellen werden geladen…', 'Loading roadworks…'),
  'roadworks.name': s('Baustellen', 'Roadworks'),
  'roadworks.noStopping': s('Haltverbote', 'no-stopping zones'),
  'roadworks.noPlace': s('Ohne Ortsangabe', 'No location given'),
  'roadworks.source': s(
    'Landeshauptstadt München, offene Daten (mor_wfs:baustellen_opendata)',
    'City of Munich, open data (mor_wfs:baustellen_opendata)',
  ),
  'field.period': s('Zeitraum', 'Period'),
  'field.periodValue': f((from: string, to: string) => `${from} bis ${to}`, (from: string, to: string) => `${from} to ${to}`),
  'field.start': s('Beginn', 'Start'),
  'field.end': s('Ende', 'End'),
  'field.areas': s('Betroffene Bereiche', 'Affected areas'),
  'field.impact': s('Beeinträchtigung', 'Impact'),
  'field.description': s('Beschreibung', 'Description'),
  'field.moreInfo': s('Weitere Informationen', 'More information'),
  'field.contact': s('Kontakt', 'Contact'),

  // ------------------------------------------------------------------ vehicles
  'vehicles.loading': s('Fahrplan wird geladen…', 'Loading service data…'),
  'vehicles.incomplete': s('Fahrplandaten unvollständig, Ebene bleibt aus', 'Service data incomplete, layer stays off'),
  'vehicles.name': s('Fahrplan', 'Service data'),
  'vehicles.live': f(
    (count: number, clock: string) => `${count} Fahrzeuge · Soll-Fahrplan, keine Ortung · berechnet ${clock}`,
    (count: number, clock: string) => `${n(count, 'vehicle', 'vehicles')} · planned service, not tracked · computed ${clock}`,
  ),
  'vehicles.noDestination': s('ohne Ziel', 'no destination'),
  'vehicles.mode': s('Verkehrsmittel', 'Mode'),
  'vehicles.stop': s('Halt', 'Stop'),
  'vehicles.stopOf': f((at: number, of: number) => `${at} von ${of}`, (at: number, of: number) => `${at} of ${of}`),
  'vehicles.nextDeparture': s('Soll-Abfahrt am nächsten Halt', 'Planned departure at the next stop'),
  'vehicles.length': s('Fahrzeuglänge', 'Vehicle length'),
  'vehicles.lengthValue': f(
    (metres: number) => `${metres} m (typische Baureihe, Flotte gemischt)`,
    (metres: number) => `${metres} m (typical class, mixed fleet)`,
  ),
  'vehicles.position': s('Position', 'Position'),
  'vehicles.positionValue': s(
    'aus den Soll-Abfahrtszeiten berechnet, keine Fahrzeugortung',
    'computed from planned departure times, no vehicle tracking',
  ),
  'vehicles.path': s('Fahrweg', 'Path'),
  'vehicles.pathValue': s(
    'gerade Linie zwischen den Haltestellen, kein Gleis- oder Straßenverlauf',
    'straight line between stops, not the track or street',
  ),
  'vehicles.note': s('Hinweis', 'Note'),
  'vehicles.tunnel': s(
    'Fährt hier im Tunnel; Tunnel sind nicht modelliert, daher an der Oberfläche und transparent dargestellt',
    'Runs in a tunnel here; tunnels are not modelled, so it is shown transparent at the surface',
  ),
  'vehicles.source': s('MVV Gesamt-Soll-Fahrplandaten (GTFS), MVV GmbH', 'MVV planned service data (GTFS), MVV GmbH'),

  // ------------------------------------------------------------------ air traffic
  'flights.loading': s('Flugdaten werden geladen…', 'Loading flight data…'),
  'flights.count': f((count: number) => `${count} Flugzeuge`, (count: number) => `${count} aircraft`),
  'flights.generic': f((count: number) => `${count} als Positionssymbol`, (count: number) => `${count} as position symbol`),
  'flights.name': s('Flugdaten', 'Flight data'),
  'flights.localOnly': s(
    'Live-Flugdaten nur über den lokalen Datenzugang verfügbar (kein CORS beim Anbieter)',
    'Live flight data only available through the local data path (the provider sends no CORS)',
  ),

  // ------------------------------------------------------------------ coordination notes
  'notes.loading': s('Notizen werden geladen…', 'Loading notes…'),
  'notes.unavailable': s('Notizspeicher ist nicht eingerichtet', 'Note storage is not set up'),
  'notes.none': s('noch keine Notizen', 'no notes yet'),
  'notes.count': f((count: number) => `${count} Notizen`, (count: number) => n(count, 'note', 'notes')),
  'notes.withoutPlace': f((count: number) => `${count} ohne Position im Modell`, (count: number) => `${count} without a position in the model`),
  'notes.name': s('Koordinationsnotizen', 'Coordination notes'),
  'notes.field.category': s('Kategorie', 'Category'),
  'notes.field.text': s('Notiz', 'Note'),
  'notes.field.from': s('Ab', 'From'),
  'notes.field.until': s('Bis', 'Until'),
  'notes.field.reference': s('Bezug', 'Refers to'),
  'notes.roadworks': f((id: string) => `Baustelle ${id}`, (id: string) => `Roadworks ${id}`),
  'notes.field.author': s('Verfasst von (gemeldet)', 'Written by (as reported)'),
  'notes.authorUnknown': s('nicht angegeben', 'not given'),
  'notes.field.channel': s('Erfasst über', 'Recorded via'),
  'notes.channel.agent': s('Entwurf des Assistenten, anschließend bestätigt', 'Assistant draft, then confirmed'),
  'notes.channel.form': s('Notizformular der Anwendung', 'The app\'s note form'),
  'notes.field.created': s('Erstellt am', 'Created'),
  'notes.subtitle': s('Koordinationsnotiz · nicht amtlich', 'Coordination note · not official'),
  'notes.source': s(
    'City Utility Twin, app-eigene Koordinationsnotiz. Kein amtlicher Datensatz.',
    'City Utility Twin, a note owned by this app. Not an official record.',
  ),
  'notes.category.Hinweis': s('Hinweis', 'Note'),
  'notes.category.Konflikt vermutet': s('Konflikt vermutet', 'Suspected conflict'),
  'notes.category.Eigene Maßnahme geplant': s('Eigene Maßnahme geplant', 'Own works planned'),
  'notes.category.Abstimmung erfolgt': s('Abstimmung erfolgt', 'Agreed with others'),

  // ------------------------------------------------------------------ official air quality
  'air.loading': s('Messwerte werden geladen…', 'Loading readings…'),
  'air.catalogue': s(
    'Stationsverzeichnis wird geladen (kann beim ersten Mal dauern)…',
    'Loading the station list (can take a while the first time)…',
  ),
  'air.found': f(
    (count: number) => `${count} Stationen gefunden, Messwerte werden geladen…`,
    (count: number) => `${n(count, 'station', 'stations')} found, loading readings…`,
  ),
  'air.unavailable': s('Messwerte derzeit nicht abrufbar', 'Readings currently unavailable'),
  'air.stations': f((count: number) => `${count} Messstationen`, (count: number) => n(count, 'station', 'stations')),
  'air.noCurrent': f((count: number) => `${count} ohne aktuelle Werte`, (count: number) => `${count} without current values`),
  'air.name': s('Luftqualität', 'Air quality'),
  'air.field.type': s('Stationstyp', 'Station type'),
  'air.field.address': s('Adresse', 'Address'),
  'air.field.readings': s('Messwerte', 'Readings'),
  'air.notPublished': s('für das abgefragte Zeitfenster nicht veröffentlicht', 'not published for the requested window'),
  'air.field.window': s('Messzeitraum', 'Measuring period'),
  'air.windowValue': f((from: string, to: string) => `${from} bis ${to} (MEZ)`, (from: string, to: string) => `${from} to ${to} (CET)`),
  'air.field.index': s('Gesamtindex', 'Overall index'),
  'air.field.note': s('Hinweis', 'Note'),
  'air.incomplete': s(
    'Die Quelle kennzeichnet die Daten dieser Stunde als unvollständig.',
    'The source marks this hour\'s data as incomplete.',
  ),
  'air.component': f((id: string) => `Komponente ${id}`, (id: string) => `Component ${id}`),
  'air.subtitle': f((id: string) => `Messstation ${id} · amtlich`, (id: string) => `Station ${id} · official`),
  'air.source': s(
    'Umweltbundesamt, Air Data (luftdaten.umweltbundesamt.de), stündlich',
    'German Environment Agency, Air Data (luftdaten.umweltbundesamt.de), hourly',
  ),

  // ------------------------------------------------------------------ citizen sensors
  'sensors.loading': s('Bürgersensoren werden geladen…', 'Loading citizen sensors…'),
  'sensors.count': f((count: number) => `${count} Bürgersensoren`, (count: number) => n(count, 'citizen sensor', 'citizen sensors')),
  'sensors.name': s('Bürgersensoren', 'Citizen sensors'),
  'sensors.field.pm25': s('PM₂,₅ Feinstaub', 'PM2.5 particulates'),
  'sensors.field.pm10': s('PM₁₀ Feinstaub', 'PM10 particulates'),
  'sensors.field.time': s('Messzeitpunkt', 'Measured at'),
  'sensors.field.model': s('Sensortyp', 'Sensor type'),
  'sensors.field.id': s('Sensor-ID', 'Sensor ID'),
  'sensors.field.location': s('Standort', 'Location'),
  'sensors.blurred': s(
    'von der Quelle gerundet veröffentlicht (Datenschutz), nicht die genaue Adresse',
    'published rounded by the source (privacy), not the exact address',
  ),
  'sensors.field.context': s('Einordnung', 'Context'),
  'sensors.context': s(
    'Bürgermessnetz, nicht amtlich kalibriert. Optische Sensoren messen bei hoher Luftfeuchte tendenziell zu hoch. Nicht direkt mit den amtlichen Stationen vergleichbar.',
    'Citizen network, not officially calibrated. Optical sensors tend to read high in humid air. Not directly comparable with the official stations.',
  ),
  'sensors.title': f((id: string) => `Bürgersensor ${id}`, (id: string) => `Citizen sensor ${id}`),
  'sensors.subtitle': s('Sensor.Community · nicht amtlich', 'Sensor.Community · not official'),
  'sensors.source': s(
    'Sensor.Community (data.sensor.community), offene Daten unter ODbL',
    'Sensor.Community (data.sensor.community), open data under ODbL',
  ),

  // ------------------------------------------------------------------ MVG departures
  'mvg.loading': s('MVG-Daten werden geladen…', 'Loading MVG data…'),
  'mvg.noStops': s('keine Haltestellen im Ausschnitt', 'no stops in the extent'),
  'mvg.stops': f((count: number) => `${count} Haltestellen`, (count: number) => n(count, 'stop', 'stops')),
  'mvg.queried': f((count: number) => `${count} abgefragt`, (count: number) => `${count} queried`),
  'mvg.delayed': f((count: number) => `${count} mit Verspätung`, (count: number) => `${count} delayed`),
  'mvg.noRealtime': f((count: number) => `${count} ohne Echtzeit`, (count: number) => `${count} without real time`),
  'mvg.noAnswer': f((count: number) => `${count} ohne Antwort`, (count: number) => `${count} without an answer`),
  'mvg.unknownDestination': s('unbekanntes Ziel', 'unknown destination'),
  'mvg.noTime': s('ohne Zeit', 'no time'),
  'mvg.rowNoRealtime': s(' · ohne Echtzeit', ' · no real time'),
  'mvg.onTime': s(' · pünktlich', ' · on time'),
  'mvg.field.modes': s('Verkehrsmittel', 'Modes'),
  'mvg.field.stopId': s('Haltestellen-ID', 'Stop ID'),
  'mvg.field.departures': s('Abfahrten', 'Departures'),
  'mvg.noDepartures': s('derzeit keine Abfahrten gemeldet', 'no departures reported right now'),
  'mvg.field.next': s('Nächste Abfahrten', 'Next departures'),
  'mvg.field.cancelled': s('Entfällt', 'Cancelled'),
  'mvg.cancelled': f((count: number) => `${count} Fahrt(en) als entfallen gemeldet`, (count: number) => `${n(count, 'trip', 'trips')} reported as cancelled`),
  'mvg.failed': f((why: string) => `nicht abrufbar (${why})`, (why: string) => `unavailable (${why})`),
  'mvg.requesting': s('werden abgefragt…', 'being requested…'),
  'mvg.notRequested': s('noch nicht abgefragt', 'not requested yet'),
  'mvg.subtitle': s('MVG-Haltestelle', 'MVG stop'),
  'mvg.source': s(
    'Haltestellen: Landeshauptstadt München (mor_wfs:oepnv_u_t_b_mvg_neu) · Abfahrten: MVG, Echtzeit',
    'Stops: City of Munich (mor_wfs:oepnv_u_t_b_mvg_neu) · Departures: MVG, real time',
  ),

  // ------------------------------------------------------------------ open-data catalogue
  'wfs.loading': f((label: string) => `${label} wird geladen…`, (label: string) => `Loading ${label}…`),
  'wfs.entries': s('Einträge', 'entries'),
  'wfs.capped': f((count: number, unit: string) => `${count} ${unit} (Anzeige begrenzt)`, (count: number, unit: string) => `${count} ${unit} (display capped)`),
  'wfs.count': f((count: number, unit: string) => `${count} ${unit}`, (count: number, unit: string) => `${count} ${unit}`),
  'wfs.moreFields': s('Weitere Felder', 'More fields'),
  'wfs.hidden': f((count: number) => `${count} nicht angezeigt`, (count: number) => `${count} not shown`),
  'wfs.source': f(
    (typeName: string) => `Landeshauptstadt München, offene Daten (${typeName}), dl-de/by-2-0`,
    (typeName: string) => `City of Munich, open data (${typeName}), dl-de/by-2-0`,
  ),

  // ------------------------------------------------------------------ detail panel and notes form
  'detail.label': s('Details zum ausgewählten Objekt', 'Details of the selected object'),
  'detail.close': s('Details schließen', 'Close details'),
  'detail.closeShort': s('Schließen', 'Close'),
  'detail.noFields': s('Die Quelle liefert zu diesem Eintrag keine weiteren Angaben.', 'The source publishes nothing more about this entry.'),
  'detail.source': f((source: string) => `Quelle: ${source}`, (source: string) => `Source: ${source}`),
  'note.add': s('Koordinationsnotiz hinzufügen', 'Add coordination note'),
  'note.category': s('Kategorie', 'Category'),
  'note.text': s('Notiz', 'Note'),
  'note.placeholder': s('Was sollen die anderen Beteiligten wissen?', 'What should the other parties know?'),
  'note.hint': s(
    'Diese Notiz gehört zu dieser Anwendung. Sie ändert nichts an den offenen Daten der Landeshauptstadt und ist kein amtlicher Vermerk.',
    'This note belongs to this app. It changes nothing in the city\'s open data and is not an official record.',
  ),
  'note.save': s('Speichern', 'Save'),
  'note.cancel': s('Abbrechen', 'Cancel'),
  'note.enterText': s('Bitte einen Text eingeben.', 'Please enter some text.'),
  'note.saving': s('Wird gespeichert…', 'Saving…'),
  'note.savedAs': f((name: string) => `Gespeichert, erfasst als ${name} (gemeldet).`, (name: string) => `Saved, recorded as ${name} (as reported).`),
  'note.savedAnon': s('Gespeichert. Es konnte keine angemeldete Person ermittelt werden.', 'Saved. No signed-in person could be determined.'),
  'note.notSaved': f((why: string) => `Nicht gespeichert: ${why}`, (why: string) => `Not saved: ${why}`),

  // ------------------------------------------------------------------ assistant
  'assistant.toggle': s('Assistent', 'Assistant'),
  'assistant.close': s('Assistent schließen', 'Close assistant'),
  'assistant.title': s('Koordinationsassistent', 'Coordination assistant'),
  'assistant.note': s(
    'Der Assistent ist angewiesen, nur die angebundenen Live-Quellen zu nutzen, und zeigt jedes benutzte Werkzeug an. Er kann keine Koordinationsnotiz veröffentlichen. Sprachmodelle können sich dennoch irren: prüfen Sie wichtige Aussagen anhand der angezeigten Werkzeuge.',
    'The assistant is instructed to use only the connected live sources and shows every tool it uses. It cannot publish a coordination note. Language models can still be wrong: check important statements against the tools shown.',
  ),
  'assistant.signIn': s('Anmelden, um Notizen zuzuordnen', 'Sign in to attribute notes'),
  'assistant.placeholder': s('Frage zu Baustellen, Luft oder Flugverkehr…', 'Ask about roadworks, air quality or air traffic…'),
  'assistant.send': s('Fragen', 'Ask'),
  'assistant.model': f((model: string) => `Modell: ${model}`, (model: string) => `Model: ${model}`),
  'assistant.tool': f((name: string) => `Werkzeug: ${name}`, (name: string) => `Tool: ${name}`),
  'assistant.unreachable': s('Assistent nicht erreichbar', 'Assistant unreachable'),
  'assistant.unreachableHttp': f(
    (status: number) => `Assistent nicht erreichbar (HTTP ${status})`,
    (status: number) => `Assistant unreachable (HTTP ${status})`,
  ),
  'auth.pending': s('Anmeldung wird abgeschlossen…', 'Completing sign-in…'),
  'auth.done': s(
    'Anmeldung abgeschlossen. Dieses Fenster kann geschlossen werden.',
    'Sign-in complete. You can close this window.',
  ),
  'auth.failed': f(
    (why: string) => `Anmeldung konnte nicht abgeschlossen werden: ${why}`,
    (why: string) => `Sign-in could not be completed: ${why}`,
  ),
  'assistant.example1.label': s('Überschneidungen in der Maxvorstadt', 'Overlaps in Maxvorstadt'),
  'assistant.example1.prompt': s(
    'Welche Baustellen überschneiden sich in der Maxvorstadt räumlich und zeitlich?',
    'Which roadworks in Maxvorstadt overlap in place and time?',
  ),
  'assistant.example2.label': s('Luft: Landshuter Allee vs. Lothstraße', 'Air: Landshuter Allee vs. Lothstraße'),
  'assistant.example2.prompt': s(
    'Vergleiche die Luftqualität an der Landshuter Allee mit der Lothstraße.',
    'Compare the air quality at Landshuter Allee with Lothstraße.',
  ),
  'assistant.example3.label': s('Lothstraße und Haltestellen', 'Lothstraße and stops'),
  'assistant.example3.prompt': s(
    'Welche Baustellen gibt es in der Lothstraße und welche MVG-Haltestellen liegen in der Nähe?',
    'Which roadworks are in Lothstraße and which MVG stops are nearby?',
  ),
  'author.verified': f(
    (name: string) => `Notizen werden erfasst als ${name}. Der Autor wird serverseitig geprüft.`,
    (name: string) => `Notes are recorded as ${name}. The author is checked on the server.`,
  ),
  'author.unverified': f(
    (name: string) => `Angemeldet als ${name}, aber derzeit ist keine Prüfung möglich. Notizen werden als gemeldet gespeichert.`,
    (name: string) => `Signed in as ${name}, but no check is possible right now. Notes are saved as reported.`,
  ),
  'author.none': s(
    'Noch keine angemeldete Person ermittelt. Notizen werden sonst ohne Namen gespeichert.',
    'No signed-in person found yet. Otherwise notes are saved without a name.',
  ),
  'author.signInFailed': s(
    'Anmeldung nicht möglich. Notizen werden ohne Namen gespeichert.',
    'Sign-in not possible. Notes are saved without a name.',
  ),
  'draft.head': f((category: string) => `Entwurf · ${category}`, (category: string) => `Draft · ${category}`),
  'draft.warn': s(
    'Entwurf, noch nicht veröffentlicht. Erst mit Ihrer Bestätigung entsteht eine Koordinationsnotiz.',
    'Draft, not published yet. A coordination note is created only once you confirm.',
  ),
  'draft.save': s('Notiz speichern', 'Save note'),
  'draft.discard': s('Verwerfen', 'Discard'),
  'draft.saved': s(
    'Gespeichert. Die Notiz erscheint in der Ebene „Koordinationsnotizen".',
    'Saved. The note appears in the "Coordination notes" layer.',
  ),
  'draft.notPublished': f(
    (why: string) => `Nicht veröffentlicht: ${why}. Sie können es erneut versuchen.`,
    (why: string) => `Not published: ${why}. You can try again.`,
  ),
  'draft.discarded': s('Entwurf verworfen. Es entsteht keine Koordinationsnotiz.', 'Draft discarded. No coordination note is created.'),

  // ------------------------------------------------------------------ scene errors (console)
  'scene.missingDrape': f((site: string) => `Für ${site} fehlt das Luftbild.`, (site: string) => `The aerial image for ${site} is missing.`),
  'scene.missingVegetation': f((site: string) => `Für ${site} fehlt die Vegetation.`, (site: string) => `The vegetation for ${site} is missing.`),

  // ------------------------------------------------------------------ attribution
  'attribution.summary': s(
    'Kartendaten © LDBV · Copernicus · OpenStreetMap · adsb.lol · LHM · MVV · MVG · UBA · Sensor.Community',
    'Map data © LDBV · Copernicus · OpenStreetMap · adsb.lol · LHM · MVV · MVG · UBA · Sensor.Community',
  ),
};

export type MessageKey = keyof typeof MESSAGES;
export type MessageArgs<K extends MessageKey> = Parameters<(typeof MESSAGES)[K]['de']>;
