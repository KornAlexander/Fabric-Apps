/**
 * Two languages, one interface.
 *
 * ⚠️ **Translations are keyed by the English string itself**, so `t('End turn')`
 * looks up German and falls back to the literal it was given. That choice is
 * about risk rather than tidiness. A conventional key namespace means naming
 * 250 strings, touching every call site twice, and showing the player a raw
 * `hud.endTurn` the first time somebody mistypes one. Here the worst failure is
 * that a sentence stays English, which is exactly what it did before, so the
 * game is shippable at every point during the translation rather than only at
 * the end. D214 deferred this pass because it "touches every file the DP-600
 * submission depends on"; this is how it stops being able to break them.
 *
 * The cost is real and worth writing down: **editing an English string silently
 * orphans its German.** `missingTranslations()` finds entries that were never
 * written, and nothing can find one that used to match. Change English text and
 * the German here needs changing with it.
 *
 * ## What is NOT translated, on purpose
 *
 * - **The DP-600 questions.** The exam is sat in English and its terminology is
 *   the subject: somebody who revises "Direktsee" has learned a word that will
 *   not be on the paper. The Klasse 1 bank is German for the mirror reason.
 * - **Fabric product terms**: Compute, CU, Lakehouse, Warehouse, Direct Lake.
 *   These are names, not words, and a German Fabric user says them in English.
 *   Ordinary English words like Trust and Data are translated normally.
 */

export type Lang = 'en' | 'de';

const STORE_KEY = 'fabric-empires:lang';

/**
 * English source text to German.
 *
 * Kept as one flat object rather than split by screen, because the key IS the
 * English string and duplicates across screens should collapse to one entry.
 */
const DE: Readonly<Record<string, string>> = Object.freeze({
  // The shell -------------------------------------------------------------
  'End turn': 'Zug beenden',
  Cities: 'Städte',
  Council: 'Rat',
  'Council ({n})': 'Rat ({n})',
  Library: 'Bibliothek',
  'New game': 'Neues Spiel',
  Skip: 'Überspringen',

  /*
   * Tooltips on the shell's own buttons.
   *
   * ⚠️ These sat in `index.html` as bare `title=` attributes for the life of
   * the project, so nine of them were English in a German game and no test
   * could see it: `applyStaticTranslations` only translates a `title` that is
   * declared as `data-i18n-title`, and the check for untranslated prose reads
   * the DOM rather than the markup a tooltip lives in until you hover it.
   *
   * The letter in brackets is the keyboard shortcut and stays as it is: it
   * names a physical key, not a word.
   */
  'The Great Library: what you actually know (l)':
    'Die Große Bibliothek: was du wirklich weißt (l)',
  'Share of the exam, by published weight, at familiar or better':
    'Anteil der Prüfung nach veröffentlichter Gewichtung, auf vertraut oder besser',
  'Sit the exam: 40 questions in the published proportions':
    'Die Prüfung ablegen: 40 Fragen in den veröffentlichten Anteilen',
  'Found a city here (b)': 'Hier eine Stadt gründen (b)',
  'Plunder the neighbouring village (p). R flies the camera, so this is not on r':
    'Das Nachbardorf plündern (p). R steuert die Kamera, deshalb liegt das nicht auf r',
  'Skip this unit (x). W A S D fly the camera, so this is not on s':
    'Diese Einheit überspringen (x). W A S D steuern die Kamera, deshalb liegt das nicht auf s',
  'Hold a council review (c)': 'Eine Ratssitzung abhalten (c)',
  /*
   * ⚠️ Two of these nine were ALREADY in the catalogue further down, waiting
   * for a call that never came, exactly as `'Player 1'` was: the seats tooltip
   * and the cancel-march tooltip. Repeating them here would have shadowed the
   * originals, and one of the two pairs disagreed ("auf dem Feld" against "auf
   * dem Brett"), so the duplicate would have silently changed a word that the
   * neighbouring "Die Reiche auf diesem Feld" is written to match. They are
   * deliberately NOT restated here.
   */

  // City health. "TP" (Trefferpunkte) is what the unit panel already uses for
  // HP, so the two read the same way.
  '{hp}/{full} HP': '{hp}/{full} TP',
  'No yield': 'Kein Ertrag',
  // A town remembered through fog. "Zuletzt gesehen" rather than "Gesehen in",
  // because the point is that the picture may be out of date.
  'Last seen turn {turn}': 'Zuletzt gesehen in Runde {turn}',
  // The unit stepper. "Einheit" is the word the rest of the interface already
  // uses, and the key hint stays as the literal bracket in both languages.
  'Previous unit ([)': 'Vorherige Einheit ([)',
  'Next unit (])': 'Nächste Einheit (])',
  // Buried caches. "Fund" rather than "Schatz": the thing is a data cache left
  // by whoever was here before, not pirate gold, and the film shows a strongbox.
  Treasure: 'Fund',
  'The Profiler turns up a buried cache.': 'Der Profiler stößt auf ein vergrabenes Depot.',
  'The cache opens: {amount} {resource}.': 'Das Depot öffnet sich: {amount} {resource}.',
  'The lock holds. {amount} {resource} left inside.':
    'Das Schloss hält stand. {amount} {resource} bleiben darin.',
  'The lock holds, and the cache is picked clean.':
    'Das Schloss hält stand, und das Depot ist leergeräumt.',
  'Face the Proctor': 'Der Prüfung stellen',
  'Turn the sound off': 'Ton ausschalten',
  'Turn the sound on': 'Ton einschalten',
  Fullscreen: 'Vollbild',
  'Leave fullscreen': 'Vollbild verlassen',
  'Nothing selected': 'Nichts ausgewählt',
  'Click one of your units.': 'Wähle eine deiner Einheiten.',
  'Hover a tile': 'Zeige auf ein Feld',
  'Researching nothing': 'Keine Forschung',
  'Choose what to study.': 'Wähle, was du lernen willst.',
  'good site': 'guter Platz',
  'Or write questions for a new topic': 'Oder schreibe Fragen zu einem neuen Thema',
  'A model drafts them and you read them before anything is kept. Check the answers: it can be confidently wrong.':
    'Ein Modell entwirft sie, und du liest sie, bevor etwas gespeichert wird. Prüfe die Antworten: es kann sich sehr sicher irren.',
  'A topic, for example: Delta Lake table maintenance':
    'Ein Thema, zum Beispiel: Wartung von Delta-Lake-Tabellen',
  Topic: 'Thema',
  'How many questions': 'Wie viele Fragen',
  'Draft questions': 'Fragen entwerfen',
  'Name a topic first.': 'Nenne zuerst ein Thema.',
  'Writing questions about {topic}…': 'Schreibe Fragen zu {topic}…',
  'No questions could be written.': 'Es konnten keine Fragen geschrieben werden.',
  'Save to the bank': 'In der Sammlung speichern',
  'Saved {n} questions to this host.': '{n} Fragen auf diesem Host gespeichert.',
  'The bank could not be saved.': 'Die Sammlung konnte nicht gespeichert werden.',
  'best nearby ({n} away)': 'bester Platz in der Nähe ({n} Felder)',
  here: 'hier',
  'will not grow': 'wächst nicht',
  '{n} turn to grow': '{n} Runde bis zum Wachstum',
  '{n} turns to grow': '{n} Runden bis zum Wachstum',
  // The proposed-sites list. "Feld" rather than "Hex": the game says Feld
  // everywhere else it means a tile, and two words for one thing is one word
  // too many.
  '{n} hex away': '{n} Feld entfernt',
  '{n} hexes away': '{n} Felder entfernt',
  // Taking cover in one of your own cities. "Deckung" is the ordinary German
  // word a player would use for it, military or not.
  'in cover: {city}': 'in Deckung: {city}',
  // Mending while dug in. "Erholt sich" is what a player would say about a
  // unit getting its strength back, and it carries the sense of resting.
  'mending +{hp} HP a turn': 'erholt sich +{hp} TP pro Runde',
  // The O+K chord. Kept light: it is a cheat, and the log line is the only
  // place the game admits it happened while you are still playing.
  'Okay. The answer picked itself.': 'Okay. Die Antwort hat sich selbst gewählt.',
  '{n} turn': '{n} Runde',
  '{n} turns': '{n} Runden',

  /*
   * Founding a city, which now asks three questions first.
   *
   * "Gründung" is the noun a player would use for the founding of a town, and
   * it reads as the occasion rather than the act, which is what the header of
   * the question modal wants.
   */
  Founding: 'Gründung',

  /*
   * Marching orders.
   *
   * ⚠️ "Bricht auf" rather than "geht": a unit setting out on a journey of
   * several turns is doing something more deliberate than walking, and the
   * halt message has to sound like a warning rather than a failure, because
   * stopping to look at what you just found is the correct behaviour.
   */
  '{unit} sets out. {n} turns away.': '{unit} bricht auf. {n} Runden entfernt.',
  '{unit} arrives.': '{unit} ist angekommen.',
  '{unit} halts: something is out there.': '{unit} hält an: da draußen ist etwas.',
  '{unit} cannot get through and stops.': '{unit} kommt nicht durch und bleibt stehen.',
  'a unit': 'eine Einheit',

  /*
   * The map's own offers, which the player may refuse.
   *
   * ⚠️ The wording has to make the refusal sound free, because it is. A line
   * that reads like a warning would teach players to decline, which is the
   * opposite of what these exist for. "Kostet nichts" is doing the work.
   */
  '{unit} finds something in the ground.': '{unit} findet etwas im Boden.',
  '{unit} is bogged down.': '{unit} bleibt im Schlamm stecken.',
  'Answer one question and it is yours. Walk on and it stays buried. Getting it wrong costs nothing.':
    'Beantworte eine Frage, dann gehört es dir. Geh weiter, dann bleibt es liegen. Falsch zu liegen kostet nichts.',
  'Answer one question and it walks out today. Decline and it goes nowhere this turn. Getting it wrong costs nothing extra.':
    'Beantworte eine Frage, dann kommt sie heute noch frei. Lehnst du ab, bewegt sie sich diese Runde nicht. Falsch zu liegen kostet nichts extra.',
  'Dig for {amount} {resource}': 'Nach {amount} {resource} graben',
  'Work it free': 'Freischaufeln',
  'One question. There is no penalty for missing it.':
    'Eine Frage. Danebenzuliegen wird nicht bestraft.',
  'Walk on': 'Weitergehen',
  'Lose nothing but the chance.': 'Du verlierst nichts außer der Gelegenheit.',
  '{amount} {resource} out of the dirt.': '{amount} {resource} aus dem Dreck.',
  'Whatever was down there stays down there.': 'Was da unten lag, bleibt da unten.',
  '{unit} finds firm ground and marches on.': '{unit} findet festen Boden und zieht weiter.',
  '{unit} spends the day in the mud.': '{unit} verbringt den Tag im Schlamm.',
  'Site surveyed. Answer three, and build well.':
    'Der Platz ist vermessen. Beantworte drei Fragen und bau gut.',
  'The Architect puts the plans away. Nothing is built.':
    'Der Architekt legt die Pläne weg. Es wird nichts gebaut.',
  'Your judgement holds. The weather turns fair and {city} is already growing.':
    'Dein Urteil hält stand. Das Wetter wird freundlich, und {city} wächst schon.',
  'Sound ground, sound plans. {city} starts with a second household.':
    'Guter Boden, gute Pläne. {city} beginnt mit einem zweiten Haushalt.',
  'The plans were guesswork. {city} starts from nothing, as most towns do.':
    'Die Pläne waren geraten. {city} beginnt bei null, wie die meisten Städte.',

  /*
   * The empire table.
   *
   * ⚠️ Called "Empires" and not "Seats", even though the engine calls them
   * seats, because the setup screen already uses "Seats" ("Plätze") for how
   * many PEOPLE are playing. Two things called the same word one screen apart
   * is how a player ends up looking for the co-op switch in here.
   *
   * The bands are deliberately plain words somebody would use about a game,
   * not military register.
   */
  Empires: 'Reiche',
  'The empires on the board, and which of them you may take (o)':
    'Die Reiche auf dem Feld, und welche davon du übernehmen kannst (o)',
  'The empires on this board': 'Die Reiche auf diesem Feld',
  'Every empire is being played': 'Jedes Reich wird gespielt',
  'Every empire on the board is being played.': 'Jedes Reich auf dem Feld wird gespielt.',
  'Stay where you are': 'Bleib, wo du bist',
  'Keep the empire you are playing.': 'Behalte das Reich, das du spielst.',
  commanding: 'überlegen',
  holding: 'behauptet sich',
  struggling: 'in Bedrängnis',
  'You are playing {empire}: {band}, {share} of the board. Taking another seat hands it back to the machine, and you start the new one blind.':
    'Du spielst {empire}: {band}, {share} des Feldes. Nimmst du einen anderen Sitz, fällt dieses Reich zurück an die Maschine, und im neuen beginnst du blind.',
  'You are not playing anybody yet.': 'Du spielst noch niemanden.',
  '{n} town': '{n} Stadt',
  '{n} towns': '{n} Städte',
  '{n} unit': '{n} Einheit',
  '{n} units': '{n} Einheiten',
  '{n} citizen': '{n} Einwohner',
  '{n} citizens': '{n} Einwohner',
  '{holdings}. {share} of the board, and nobody holds more.':
    '{holdings}. {share} des Feldes, und niemand hält mehr.',
  '{holdings}. {share} of the board, against {best} for {leader}.':
    '{holdings}. {share} des Feldes, gegen {best} für {leader}.',
  'You leave {left} to the machine and take {joined}.':
    'Du überlässt {left} der Maschine und übernimmst {joined}.',
  'You know nothing of this map. Scout it.':
    'Du kennst diese Karte nicht. Erkunde sie.',
  'reachable this turn': 'diese Runde erreichbar',
  'Show this site': 'Diesen Platz zeigen',
  'Nothing was being studied, so the council began {topic}. Choose another if you like.':
    'Es wurde nichts erforscht, also hat der Rat mit {topic} begonnen. Wähle gerne etwas anderes.',
  'Who is coming': 'Wer kommt',
  'Your empire begins.': 'Dein Reich beginnt.',
  'Turn {n}': 'Runde {n}',

  // Resources. Trust and Data are ordinary words; Compute and CU are Fabric
  // capacity terms and stay as they are.
  Trust: 'Vertrauen',
  Data: 'Daten',

  // Orders ----------------------------------------------------------------
  'Found city': 'Stadt gründen',
  Fortify: 'Befestigen',
  Wake: 'Aufwecken',
  'Dig in for +40% defence, ending this turn (h)':
    'Eingraben für +40% Verteidigung, beendet diesen Zug (h)',
  'Stand down, and move again this turn (h)':
    'Stellung aufgeben und in diesem Zug wieder bewegen (h)',
  Raid: 'Plündern',
  Raze: 'Niederbrennen',
  Capture: 'Erobern',
  Attack: 'Angreifen',
  Move: 'Bewegen',

  // The log ---------------------------------------------------------------
  'Enemy unit destroyed.': 'Gegnerische Einheit vernichtet.',
  'Your unit was destroyed.': 'Deine Einheit wurde vernichtet.',
  'Your answer strengthened the attack.': 'Deine Antwort hat den Angriff verstärkt.',
  'Your answer weakened the attack.': 'Deine Antwort hat den Angriff geschwächt.',
  'Nothing was learned there.': 'Dort wurde nichts gelernt.',
  'Upkeep could not be paid in full.': 'Der Unterhalt konnte nicht voll bezahlt werden.',
  'Both of you knew it. The walls hold.': 'Ihr wusstet es beide. Die Mauern halten.',
  'Player 2 held the line where you did not.':
    'Spieler 2 hat gehalten, wo du es nicht konntest.',
  'A saved game was found but could not be read, so this is a new one.':
    'Ein Spielstand wurde gefunden, war aber nicht lesbar. Dies ist ein neues Spiel.',
  '{name} grew.': '{name} ist gewachsen.',
  '{name} is now a {rank}. {why}': '{name} ist jetzt {rank}. {why}',
  'Yields +{percent}%.': 'Erträge +{percent}%.',
  'The first step.': 'Der erste Schritt.',
  'Turn {n} ended. {gains}': 'Runde {n} beendet. {gains}',
  'No income yet.': 'Noch keine Einnahmen.',

  // Setting up a world ----------------------------------------------------
  'The world': 'Die Welt',
  'The exam': 'Die Prüfung',
  'Who is playing': 'Wer spielt',
  'The seed': 'Der Startwert',
  Begin: 'Los geht’s',
  Shape: 'Form',
  Land: 'Land',
  Size: 'Größe',
  Focus: 'Schwerpunkt',
  Rivals: 'Gegner',
  Pace: 'Tempo',
  Seats: 'Plätze',
  'One player': 'Ein Spieler',
  'Two players, together': 'Zwei Spieler, gemeinsam',
  'You answer every question yourself.': 'Du beantwortest jede Frage selbst.',
  'One empire. Every battle asks you both at once, each from your own course.':
    'Ein Reich. Jeder Kampf fragt euch beide gleichzeitig, jeden aus seinem eigenen Kurs.',
  'Player 1 answers with 1 2 3 4': 'Spieler 1 antwortet mit 1 2 3 4',
  'Your course': 'Dein Kurs',
  'studying now': 'wird gerade studiert',
  'discards {spent} Compute': 'verwirft {spent} Compute',
  'Researching: {topic}': 'Forschung: {topic}',
  // Rejection reasons the engine writes in canonical English (D35), translated
  // here on the way to the log.
  'Already researching this': 'Wird bereits erforscht.',
  'Already researched': 'Bereits erforscht.',
  'Prerequisites not met': 'Voraussetzungen nicht erfüllt.',
  'No such topic': 'Dieses Thema gibt es nicht.',
  // Log lines. ⚠️ These were written as bare template literals, which is why
  // an earlier sweep for untranslated prose missed every one of them: it
  // looked for a quote followed by a capital letter, and these begin with an
  // interpolation. Guarded now by app/test/i18n.test.ts.
  'Cheat: {message}': 'Cheat: {message}',
  'Founded {city}.': '{city} gegründet.',
  'a city': 'eine Stadt',
  '{city} recalled {topic}. +{trust} Trust.':
    '{city} hat {topic} wiederholt. +{trust} Vertrauen.',
  '{city} could not recall {topic}. It will come round again.':
    '{city} konnte sich nicht an {topic} erinnern. Es kommt wieder.',
  '{who} is at your gates. Hold them.': '{who} steht vor deinen Toren. Halte sie auf.',
  '{spent} Compute into research.': '{spent} Compute in die Forschung.',
  '{city} is restless without its council.': '{city} ist unruhig ohne seinen Rat.',
  '{who} is on the move.': '{who} ist unterwegs.',
  '{who} has taken one of your cities.': '{who} hat eine deiner Städte eingenommen.',
  '{who} destroyed one of your units.': '{who} hat eine deiner Einheiten vernichtet.',
  '{who} raided you for {damage}.': '{who} hat dich um {damage} geplündert.',
  'Learned: {topic}': 'Gelernt: {topic}',
  '{topic} not yet mastered. Try again next turn.':
    '{topic} noch nicht gemeistert. Versuch es nächste Runde erneut.',
  '{city} begins {unit}.': '{city} beginnt mit {unit}.',
  '{city} downs tools.': '{city} legt die Arbeit nieder.',
  'Resumed on seed {seed}, turn {turn}.': 'Fortgesetzt auf Seed {seed}, Runde {turn}.',
  Enter: 'Start',
  'Skip to setup': 'Direkt zu den Einstellungen',
  'Nothing to raid here.': 'Hier gibt es nichts zu plündern.',
  'The raid failed.': 'Der Überfall ist gescheitert.',
  'The village': 'Das Dorf',
  '{city} taken.': '{city} eingenommen.',
  '{city} taken from {from}.': '{city} von {from} eingenommen.',
  'Carried off {spoils}.': '{spoils} erbeutet.',
  'You held. A raider from {who} was destroyed.':
    'Du hast standgehalten. Ein Angreifer von {who} wurde vernichtet.',
  'The Proctor sets {count} questions.': 'Der Prüfer stellt {count} Fragen.',
  'The Proctor has noticed you at {percent}% readiness. {count} questions await.':
    'Der Prüfer ist bei {percent}% Bereitschaft auf dich aufmerksam geworden. {count} Fragen warten.',
  'Hex grid shown.': 'Hexgitter eingeblendet.',
  'Hex grid hidden.': 'Hexgitter ausgeblendet.',
  'Player 2 answers with A B C D': 'Spieler 2 antwortet mit A B C D',
  '{n} rivals': '{n} Gegner',
  'Every branch of the outline has a faction holding it.':
    'Jeder Zweig des Lehrplans wird von einer Fraktion gehalten.',
  '{n} of the seven clusters come at you. A shorter war.':
    '{n} der sieben Gebiete greifen dich an. Ein kürzerer Krieg.',
  'Same seed and same choices, same world. Send one to a friend.':
    'Gleicher Startwert, gleiche Auswahl, gleiche Welt. Schick einen an eine Freundin.',

  // Two seats -------------------------------------------------------------
  'Player 1': 'Spieler 1',
  'Player 2': 'Spieler 2',
  Correct: 'Richtig',
  'The answer was: {answer}': 'Richtig wäre: {answer}',

  // Settlement ranks are engine data and carry their own German. What the
  // panel says around them lives here.
  'pop {n}': 'Einw. {n}',
  'unrest {n}': 'Unruhe {n}',
  /*
   * ⚠️ "{rank} needs {what}" read as though the city already WAS that rank.
   *
   * The rank named is the one being climbed TO, so a Settlement displayed
   * "Village needs 1 more topic at familiar" and left the player to work out
   * that the Village was a destination rather than the thing on screen.
   *
   * ⚠️ "Nächster Rang {rank}" rather than "Bis zum {rank}", because the ranks
   * differ in gender: das Dorf but die Siedlung, die Gemeinde, die Stadt, die
   * Großstadt. Any phrasing with an article needs zum for one and zur for the
   * rest, and one template cannot carry both.
   */
  'Next rank {rank}: {what}': 'Nächster Rang {rank}: {what}',
  'Rising to {rank}': 'Wird bald {rank}',
  '{n} more citizen': '{n} Einwohner mehr',
  '{n} more citizens': '{n} Einwohner mehr',
  /*
   * ⚠️ "at familiar" read as a bare adjective rather than as the name of a
   * level, which is what it is. Both languages now say so outright.
   */
  '{n} more topic held at {band}': '{n} weiteres Thema auf Stufe {band}',
  '{n} more topics held at {band}': '{n} weitere Themen auf Stufe {band}',
  ' and ': ' und ',
  familiar: 'vertraut',
  strong: 'sicher',
  'A city': 'Eine Stadt',

  // Unit panel. The unit's own name stays English; these do not.
  HP: 'TP',
  moves: 'Züge',
  strength: 'Stärke',
  fortified: 'befestigt',
  '{known}/{total} known ({percent}%)': '{known}/{total} gelernt ({percent}%)',
  '{percent}% exam': '{percent}% Prüfung',
  '{known}/{total} known': '{known}/{total} gelernt',

  // The help card.
  'click a unit to select, click to move or attack':
    'Einheit anklicken, dann klicken zum Ziehen oder Angreifen',
  'drag to pan, wheel to zoom, space ends turn':
    'Ziehen zum Verschieben, Rad zum Zoomen, Leertaste beendet den Zug',
  '` opens the console, type help': '` öffnet die Konsole, tippe help',

  // Starting out.
  'New empire on seed {seed}. {shape}, {size}, {rivals} rivals.':
    'Neues Reich auf Startwert {seed}. {shape}, {size}, {rivals} Gegner.',

  // The opening -----------------------------------------------------------
  'Out of nothing, the land rises': 'Aus dem Nichts erhebt sich das Land',
  'The rivers find their way': 'Die Flüsse finden ihren Weg',
  'Small hands, great hands': 'Kleine Hände, große Hände',
  'Learn Fabric. Learn as a family.': 'Lerne Fabric. Lernt als Familie.',
  'Esc to skip': 'Esc zum Überspringen',

  // Bringing your own questions.
  'Your own questions': 'Deine eigenen Fragen',
  'Download the sample, replace the rows with your own, and upload it. Any subject works.':
    'Lade die Vorlage herunter, ersetze die Zeilen durch eigene und lade sie hoch. Jedes Fach geht.',
  'Download sample': 'Vorlage herunterladen',
  'Upload a file': 'Datei hochladen',
  'Use these questions': 'Diese Fragen verwenden',
  'Reading {file}…': 'Lese {file}…',
  '{questions} questions across {topics} topics, from {file}.':
    '{questions} Fragen aus {topics} Themen, aus {file}.',
  'Rows that could not be used': 'Zeilen, die nicht verwendet werden konnten',
  'Worth a look': 'Einen Blick wert',
  'Row {row}: {message}': 'Zeile {row}: {message}',
  'and {n} more': 'und {n} weitere',
  'Ignored columns: {columns}': 'Ignorierte Spalten: {columns}',
  'Nothing in this file can be played yet.':
    'Aus dieser Datei lässt sich noch nichts spielen.',
  '{title} is ready. Pick it as a course below.':
    '{title} ist bereit. Wähle es unten als Kurs aus.',    // Walls. "Stufe" rather than "Level", which is the ordinary German word for
    // a tier and keeps the interface out of Denglisch.
    'Walls level {level}': 'Mauern Stufe {level}',
    'Walls level {level} · {hp}/{full}': 'Mauern Stufe {level} · {hp}/{full}',
    'Repair walls (level {level})': 'Mauern ausbessern (Stufe {level})',
    // Assault tactics. "Berennen" and "Ersteigen" are the period siege terms,
    // and "Untergraben" is what a sapper literally does.
    '{city}: how will you go in?': '{city}: Wie gehst du hinein?',
    'Walls level {level} still stand, and they will not fall to enthusiasm.':
      'Mauern der Stufe {level} stehen noch, und die fallen nicht durch Begeisterung.',
    'Batter the walls': 'Die Mauern berennen',
    'Everything at the wall. Slow, and it costs you nothing.':
      'Alles gegen die Mauer. Langsam, und es kostet dich nichts.',
    'Escalade': 'Ersteigen',
    'Over the top. Most of the blow reaches the town itself, and the defenders make you pay for it.':
      'Über die Brüstung. Der größte Teil des Schlags trifft die Stadt selbst, und die Verteidiger lassen dich dafür bezahlen.',
    'Sap the walls': 'Die Mauern untergraben',
    'Under it. The fastest way through masonry, and almost no use once the breach is open.':
      'Darunter hindurch. Der schnellste Weg durch Mauerwerk, und fast nutzlos, sobald die Bresche offen ist.',
    // Defence stances. "Ausfall" is the period word for a sortie out of a
    // besieged place, which is exactly what sallying is.
    '{who} is at your gates. How do you meet them?':
      '{who} steht vor deinen Toren. Wie stellst du dich?',
    'The target is {what}.': 'Das Ziel ist {what}.',
    'your border': 'deine Grenze',
    // The banner that names the raid, above the stance question.
    '{faction} is attacking': '{faction} greift an',
    '{target}, and one more front': '{target}, und eine weitere Front',
    '{target}, and {n} more fronts': '{target}, und {n} weitere Fronten',
    'They will test you on: {topic}': 'Sie prüfen dich zu: {topic}',
    'Your defenders struck back for {damage}.':
      'Deine Verteidiger schlugen für {damage} zurück.',
    'Hold the line': 'Die Stellung halten',
    'Stand behind what you built. Nothing is risked and nothing is gained.':
      'Bleib hinter dem, was du gebaut hast. Nichts gewagt, nichts gewonnen.',
    'Sally out': 'Einen Ausfall wagen',
    'Open the gates. Your cover counts for nothing, and you hit back far harder.':
      'Öffne die Tore. Deine Deckung zählt dann nicht mehr, dafür schlägst du viel härter zurück.',
    'Brace': 'In Deckung gehen',
    'Everything into cover. Much harder to hurt, and you do not hit back at all.':
      'Alles in Deckung. Viel schwerer zu treffen, aber du schlägst überhaupt nicht zurück.',  'Those questions could not be prepared.':
    'Diese Fragen konnten nicht vorbereitet werden.',
  'That file could not be read. Excel and CSV both work.':
    'Diese Datei konnte nicht gelesen werden. Excel und CSV funktionieren beide.',
  'The sample could not be saved.': 'Die Vorlage konnte nicht gespeichert werden.',
  'My questions': 'Meine Fragen',

  // The study coach.
  'Ask about your progress…': 'Frag nach deinem Fortschritt…',
  Ask: 'Fragen',
  'Thinking…': 'Denkt nach…',
  due: 'fällig',
  unseen: 'ungesehen',
  learning: 'am Lernen',
  'Answer a few questions and this will fill in.':
    'Beantworte ein paar Fragen, dann füllt sich das hier.',
  'Ask me what to study, or how close you are. I read your progress, not your answers.':
    'Frag mich, was du lernen sollst oder wie nah du bist. Ich sehe deinen Fortschritt, nicht deine Antworten.',
  'What should I work on next?': 'Was soll ich als Nächstes lernen?',

  // Endings ---------------------------------------------------------------
  Victory: 'Sieg',
  Defeat: 'Niederlage',
  'Play again': 'Nochmal spielen',
  'Codes used': 'Benutzte Codes',
  'Your readiness did not have help, and never does.':
    'Deine Lernwerte hatten keine Hilfe. Das haben sie nie.',
  // The end screen itself. It was entirely untranslated until section 73.
  'Your empire has fallen': 'Dein Reich ist gefallen',
  'The region is yours': 'Die Gegend gehört dir',
  'Every skill mastered': 'Jede Fähigkeit gemeistert',
  'The Proctor is satisfied': 'Der Prüfer ist zufrieden',
  turns: 'Runden',
  skills: 'Fähigkeiten',
  cities: 'Städte',
  'New empire': 'Neues Reich',
  'This empire had help: {codes}.': 'Dieses Reich hatte Hilfe: {codes}.',
  '{correct} of {asked} correct, {percent} percent. The Proctor has no further questions.':
    '{correct} von {asked} richtig, {percent} Prozent. Der Prüfer hat keine Fragen mehr.',
  // Engine-written outcome summaries, translated on the way to the screen.
  'Your empire has fallen. Nothing of it remains on the map.':
    'Dein Reich ist gefallen. Nichts davon bleibt auf der Karte.',
  'Every rival has been driven from the map. The region is yours.':
    'Jeder Gegner wurde von der Karte vertrieben. Die Gegend gehört dir.',
  'That includes the readiness figure, which was granted rather than earned.':
    'Dazu gehören die Lernwerte, die geschenkt und nicht verdient wurden.',
  'Your readiness figure did not, and never does.':
    'Deine Lernwerte hatten keine Hilfe. Das haben sie nie.',
  // The question modal, the screen a player sees more than any other.
  'The Proctor': 'Der Prüfer',
  Research: 'Forschung',
  Unrest: 'Unruhe',
  Battle: 'Kampf',
  Pause: 'Pause',
  Resume: 'Weiter',
  Submit: 'Abschicken',
  Continue: 'Weiter',
  paused: 'pausiert',
  'Choose {n}.': 'Wähle {n} aus.',
  'Correct, and quickly': 'Richtig, und schnell',
  'Out of time': 'Zeit abgelaufen',
  'Not quite': 'Nicht ganz',
  'Read the documentation': 'Zur Dokumentation',
  'Beyond the map': 'Jenseits der Karte',
  'The DP-600 outline is the tech tree. Rival factions each hold one branch of it: beat them and take what they know, or burn it and stay ignorant.':
    'Der DP-600-Lehrplan ist der Technologiebaum. Jede gegnerische Fraktion hält einen Zweig davon: besiege sie und nimm dir ihr Wissen, oder brenne es nieder und bleibe unwissend.',
  // The first five minutes, for somebody who has only opened the link.
  'If you only have five minutes': 'Wenn du nur fünf Minuten hast',
  // The way straight past the setup form, at the top of it.
  'Skip the questions and start': 'Fragen überspringen und starten',
  'Every choice below already has a sensible default.':
    'Alle Optionen unten haben bereits sinnvolle Vorgaben.',
  // Carrying on with the saved game, offered on the same screen.
  // ⚠️ `Continue` is NOT added here: it already exists above as 'Weiter'.
  // A second entry compiles as a duplicate object key and TypeScript rejects
  // it, which is the good outcome; the bad one would have been two spellings
  // of the same button in one UI.
  'Seed {seed} · turn {turn} · {cities} cities':
    'Startwert {seed} · Runde {turn} · {cities} Städte',
  'Starting a new empire below replaces this saved game.':
    'Ein neues Reich unten ersetzt diesen Spielstand.',
  // Calling off a multi-turn march.
  'Cancel march': 'Marsch abbrechen',
  'Call off the march and decide again next turn (Esc)':
    'Den Marsch abbrechen und nächste Runde neu entscheiden (Esc)',
  '{unit} stands and awaits orders.': '{unit} hält an und wartet auf Befehle.',
  // Folding panels, and the key list they sit next to.
  Tile: 'Feld',
  Log: 'Verlauf',
  Keys: 'Tasten',
  'drag to orbit, shift-drag to pan, wheel to zoom':
    'ziehen dreht · Umschalt+ziehen verschiebt · Rad zoomt',
  'enter is the next action, space follows the button':
    'Enter nächste Aktion · Leertaste folgt dem Knopf · Strg+Leertaste beendet den Zug',
  // The turn button, which is now two buttons wearing one coat.
  'Next unit ({n})': 'Nächste Einheit ({n})',
  'Choose research': 'Forschung wählen',
  'Nothing left to do. Space ends the turn.':
    'Nichts mehr zu tun. Leertaste beendet den Zug.',
  '{n} units still have something to do. Ctrl+Space ends the turn anyway.':
    '{n} Einheiten haben noch etwas zu tun. Strg+Leertaste beendet den Zug trotzdem.',
  'Compute is being earned against nothing. Ctrl+Space ends the turn anyway.':
    'Compute wird ohne Ziel erwirtschaftet. Strg+Leertaste beendet den Zug trotzdem.',
  'A review has fallen due. Ctrl+Space ends the turn anyway.':
    'Eine Wiederholung ist fällig. Strg+Leertaste beendet den Zug trotzdem.',
  'Nothing is being researched. Pick a topic.':
    'Es wird nichts erforscht. Wähle ein Thema.',
  'Every advance is a question. Pick a topic, answer it, and the next units unlock.':
    'Jeder Fortschritt ist eine Frage. Wähle ein Thema, beantworte es, und die nächsten Einheiten werden frei.',
  'Attack a walled city. You choose how to go in, and the defender chooses how to meet you.':
    'Greife eine ummauerte Stadt an. Du wählst, wie du hineingehst, und der Verteidiger wählt, wie er dich empfängt.',
  'At 100 percent readiness the Proctor sets a 40 question exam. Passing it wins the game.':
    'Bei 100 Prozent Bereitschaft stellt der Prüfer eine Prüfung mit 40 Fragen. Wer sie besteht, gewinnt das Spiel.',

  /*
   * Engine option text.
   *
   * The engine keeps its labels in English as the canonical form and the app
   * translates them on the way to the screen, so no engine interface needs a
   * second field and the two can never disagree about which is which.
   *
   * ⚠️ Unit names and city kinds are deliberately absent. Workspace, Lakehouse,
   * Warehouse, Eventhouse and Semantic Model are literal Fabric item types, and
   * Pipeline Runner, Query Slinger, Notebook Cannon, RLS Sentinel and Direct
   * Lake Titan are jokes built on Fabric terminology. A German Fabric user says
   * all of them in English, and translating them would teach vocabulary that is
   * not on the exam.
   */
  'One great continent': 'Ein großer Kontinent',
  'A single landmass with a long, worked coastline. Nowhere to hide.':
    'Eine einzige Landmasse mit langer, zerklüfteter Küste. Kein Versteck.',
  'A few large islands': 'Einige große Inseln',
  'A broad home island and three lesser lands across the water.':
    'Eine weite Heimatinsel und drei kleinere Länder jenseits des Wassers.',
  'Many small islands': 'Viele kleine Inseln',
  'A crowded home island ringed by scattered isles and a great deal of sea.':
    'Eine enge Heimatinsel, umringt von verstreuten Eilanden und viel Meer.',
  Gentle: 'Sanft',
  'Broad plains and few mountains. Armies move freely and fronts are wide.':
    'Weite Ebenen und wenige Berge. Armeen ziehen frei, die Fronten sind breit.',
  Rolling: 'Hügelig',
  'Hills, river valleys and a spine of mountains. The balanced world.':
    'Hügel, Flusstäler und ein Gebirgsrücken. Die ausgewogene Welt.',
  Rugged: 'Schroff',
  'High country everywhere. Passes matter, and a held valley is worth an army.':
    'Überall Hochland. Pässe zählen, und ein gehaltenes Tal ist eine Armee wert.',
  Small: 'Klein',
  'About 2,800 tiles. Quick to build, and everyone is close.':
    'Etwa 2.800 Felder. Schnell aufgebaut, und alle sind nah.',
  Standard: 'Standard',
  'About 6,200 tiles. Room to expand before anyone reaches you.':
    'Etwa 6.200 Felder. Platz zum Wachsen, bevor dich jemand erreicht.',
  Large: 'Groß',
  'About 9,600 tiles. A long war, and a longer wait to begin it.':
    'Etwa 9.600 Felder. Ein langer Krieg, und ein längeres Warten darauf.',
  'The whole exam': 'Die ganze Prüfung',
  'Rivals drawn from every branch, nearest first.':
    'Gegner aus allen Zweigen, die nächsten zuerst.',
  'Maintain and govern': 'Verwalten und steuern',
  'Security, access control, version control, deployment pipelines.':
    'Sicherheit, Zugriffssteuerung, Versionsverwaltung, Deployment-Pipelines.',
  'Prepare data': 'Daten vorbereiten',
  'Connections, ingestion, transformation, and querying.':
    'Verbindungen, Ingestion, Transformation und Abfragen.',
  'Semantic models': 'Semantische Modelle',
  'Model design, storage modes, DAX, and optimisation.':
    'Modelldesign, Speichermodi, DAX und Optimierung.',
  Relaxed: 'Entspannt',
  'Half as long again to answer. For learning something new.':
    'Die Hälfte mehr Zeit zum Antworten. Zum Neulernen.',
  'Fourteen seconds to think in battle, plus time to read.':
    'Vierzehn Sekunden Bedenkzeit im Kampf, dazu Zeit zum Lesen.',
  'Exam pace': 'Prüfungstempo',
  'A third less time. Closer to sitting the real thing.':
    'Ein Drittel weniger Zeit. Näher an der echten Prüfung.',
});

const listeners = new Set<() => void>();

function load(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'de' || saved === 'en') return saved;
    // A German browser gets a German game without being asked.
    if (typeof navigator !== 'undefined' && navigator.language?.startsWith('de')) return 'de';
  } catch {
    // Private mode, or no storage. English then.
  }
  return 'en';
}

let current: Lang = load();

export function lang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORE_KEY, next);
  } catch {
    // Not being able to remember the choice is not a reason to refuse it.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const fn of listeners) fn();
}

export function toggleLang(): Lang {
  setLang(current === 'en' ? 'de' : 'en');
  return current;
}

/** Called after every change, so panels can redraw themselves. */
export function onLangChange(fn: () => void): void {
  listeners.add(fn);
}

/**
 * Translate, with optional `{placeholders}`.
 *
 * The English text is both the key and the fallback, so an untranslated string
 * renders as itself rather than as a broken lookup.
 */
export function t(en: string, vars?: Readonly<Record<string, string | number>>): string {
  const base = (current === 'de' ? DE[en] : undefined) ?? en;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole,
  );
}

/** Pick the singular or plural English key, then translate it. */
export function plural(
  n: number,
  one: string,
  many: string,
  vars?: Readonly<Record<string, string | number>>,
): string {
  return t(n === 1 ? one : many, { n, ...vars });
}

/** Every English string that has a German translation. For tests. */
export function translatedKeys(): readonly string[] {
  return Object.keys(DE);
}

/**
 * Apply translations to static markup.
 *
 * Anything carrying `data-i18n` has its text replaced, and `data-i18n-title`
 * its tooltip. Runs on load and again on every switch, so the shell follows the
 * language without every element needing a listener of its own.
 */
export function applyStaticTranslations(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const source = el.dataset.i18n;
    if (source) el.textContent = t(source);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const source = el.dataset.i18nTitle;
    if (source) el.title = t(source);
  }
}
