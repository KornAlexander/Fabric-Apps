import {
  ANTAGONIST_FACTION_ID,
  ANTAGONISTS,
  aggroRadius,
  hexDistance,
  BASE_HEX_SIZE,
  PLAYER_FACTION_ID,
  promoteCities,
  nextRankNeed,
  rankInfo,
  type CityRank,
  type CityRankInfo,
  canAttack,
  canFoundCity,
  dataAtFounding,
  settleSites,
  turnsToFirstCitizen,
  type SettleSite,
  canRaid,
  raidCity,
  ruinAt,
  cityAt,
  recordCheat,
  sightOf,
  DEFAULT_WORLD_CHOICE,
  WORLD_SHAPES,
  WORLD_SIZES,
  paceScale,
  rosterFor,
  worldOptions,
  cityTerritory,
  completeResearch,
  createGameState,
  createRng,
  buildableUnits,
  cancelProduction,
  setProduction,
  unitCost,
  productionCost,
  isWallTarget,
  maxWallHp,
  SETTLE_QUESTIONS,
  settlingBonus,
  rollFortune,
  fortuneTaken,
  applyFortune,
  advanceMarches,
  clearMarch,
  planMarch,
  setMarch,
  memoryOf,
  vacateSeat,
  takeSeat,
  maxCityHp,
  wallWork,
  WALL_TARGET,
  type ProductionTarget,
  PRODUCTION_CAP_PER_TURN,
  endTurn,
  FORTIFY_HEAL_SHARE,
  fortifyUnit,
  wakeUnit,
  foundCity,
  hexKey,
  hexNeighbour,
  moveUnit,
  normaliseSeed,
  previewAttack,
  ASSAULT_TACTICS,
  DEFAULT_STANCE,
  DEFENCE_STANCES,
  DEFAULT_TACTIC,
  MAX_WALL_LEVEL,
  type AssaultTactic,
  type DefenceStance,
  reachable,
  researchCost,
  researchProgress,
  researchable,
  resolveAttack,
  resolveReview,
  reviewOpportunities,
  selectableUnitAt,
  skipUnit,
  startResearch,
  terrain,
  tileYields,
  topicById,
  treasureAt,
  unitAt,
  unitType,
  unitsOf,
  claimTreasure,
  type AiEvent,
  type ChallengeOutcome,
  type ChallengeRequest,
  type GameState,
  type Hex,
  type ReachableTile,
  type ResourceId,
  type Treasure,
  type Unit,
  type UnitTypeId,
} from '@fabric-empires/engine';
import {
  DAY_MS,
  DP600_CAMPAIGN,
  Dp600ChallengeProvider,
  bandStrength,
  buildLibraryModel,
  buildSiege,
  campaignById,
  checkAnswer,
  createMasteryTracker,
  createQuestionPresenter,
  decryptExplanation,
  localStorageStore,
  proctorReady,
  revealCorrectAnswer,
  scoreFor,
  scoreSiege,
  summarise,
  topicsFor,
  type Campaign,
} from '@fabric-empires/learn';
import { createEffects, type MarchOverlay } from './render/effects.js';
import { createScene3D } from './three/scene3d.js';
import { playDuel } from './three/duel.js';
import { playSiege } from './three/siege.js';
import { HEX_RADIUS, SEA_LEVEL, hexToWorld } from './three/terrain.js';
import { HIGH_QUALITY, LOW_QUALITY } from './three/world.js';
import { createQuestionModal } from './ui/questionModal.js';
import { createGreatLibrary } from './ui/greatLibrary.js';
import { createDroneHud } from './ui/droneHud.js';
import { Vector3 } from 'three';
import { createEndScreen } from './ui/endScreen.js';
import { beginRun, flush, recordAttempt, recordRun, statsConfigured } from './stats.js';
import { createCinematicOverlay } from './ui/cinematicOverlay.js';
import { createChoiceModal } from './ui/choice.js';
import { createSetupScreen, type ResumeOffer, type SetupResult } from './ui/setupScreen.js';
import { createPanels } from './ui/panels.js';
import { createCheatConsole } from './ui/cheatConsole.js';
import { createRaidAlert } from './ui/raidAlert.js';
import { createDuoModal } from './ui/duoModal.js';
import { createAttract } from './ui/attract.js';
import { createTreasureFilm } from './ui/treasureFilm.js';
import { CHEATS, CHEAT_CODE_WIDTH, OKAY_CHEAT, matchCheat } from './cheats.js';
import { approachShot, descendShot, orbitShot } from './three/cinematic.js';
import { introShots } from './intro.js';
import { ANTHEM_FADE_OUT_MS, createAnthem } from './audio.js';
import { createSoundtrack } from './soundtrack.js';
import { createCues } from './cues.js';
import { applyStaticTranslations, lang, onLangChange, plural, t, toggleLang } from './i18n.js';
import { allCampaigns } from './courses.js';
import { probeEdition } from './coach.js';

/**
 * Find a course by id, shipped or imported.
 *
 * ⚠️ Not `campaignById`, which only knows what was compiled in. A player who
 * uploaded a spreadsheet and picked it would otherwise be handed silence: the
 * seat would build with no questions and no error, because a missing campaign
 * looks exactly like a single-player game.
 */
const courseById = (id: string) => allCampaigns().find((c) => c.id === id);

/**
 * The campaign the WORLD is built from.
 *
 * ⚠️ **This function is the fix for a control that did nothing.** The setup
 * screen has always shown player one a course picker, filtered to campaigns
 * that claim `role: 'world'`, and `newGame` then ignored the answer entirely:
 * the topic graph came from a provider hard-wired to DP-600, the factions came
 * from the engine's built-in `ANTAGONISTS`, and the exam came from constants.
 * Picking a course changed a label in the co-op modal and nothing else.
 *
 * It was invisible for the usual reason. There is exactly one world campaign
 * compiled in, so the wrong answer and the right answer were the same value.
 * That is the same shape as the unit table being a statement about DP-600
 * (section 70) and `media/` matching at any depth (section 76): a coincidence
 * of the only case that existed, standing in for a rule.
 *
 * Falls back rather than throwing. A campaign that only supplies questions
 * cannot build a world, and an id from a deleted import resolves to nothing,
 * so both land on the campaign this game is actually about.
 */
function worldCampaign(): Campaign {
  const chosen = courseById(lastSetup.courseP1);
  return chosen?.role === 'world' ? chosen : DP600_CAMPAIGN;
}
import { loadGame, localSlot, saveGame } from './persist.js';
import { seatTable, type SeatOffer } from './seats.js';
import { createBattleBanner, type BattleSide } from './ui/battleBanner.js';

/**
 * The learning layer, injected at the edge of the app.
 *
 * The engine receives only the topic graph and, later, a score. Everything
 * about DP-600 lives on this side of the line (D35).
 */
const modal = createQuestionModal();
const askedThisSession = new Set<string>();
/**
 * Questions answered correctly and promptly, which will not come back.
 *
 * ⚠️ **One set for both seats, like `askedThisSession`.** In a two-player game
 * the pair share one empire and one bank, so a question seat one has already
 * answered is spent for the table: handing seat two the same item is not a
 * second test, it is the first player's answer read aloud.
 */
const retiredThisSession = new Set<string>();

/**
 * Spaced repetition, persisted across sessions.
 *
 * The session start is handed over so the compressed in-session clock runs:
 * real SM-2 intervals are measured in days, which would mean the review loop
 * never fires during the hour somebody actually plays.
 */
const mastery = createMasteryTracker({
  store: localStorageStore(),
  sessionStart: Date.now(),
});

const soloPresenter = createQuestionPresenter(modal, {
  asked: askedThisSession,
  retired: retiredThisSession,
  // Reads `lastSetup` at call time, not at construction: the course is chosen
  // after this is built.
  onAttempt: (a) => recordAttempt(a, { seat: 1, courseId: lastSetup.courseP1 }),
});

/**
 * Player one's presenter, swapped when a second person joins.
 *
 * ⚠️ In co-op BOTH seats must be panes of the duo modal. Leaving player one on
 * the full-screen single-player modal put their question underneath the duo
 * layer, where it was invisible and unanswerable: measured, only the child's
 * pane appeared. The provider is constructed once, so the swap has to happen
 * behind a stable function rather than by rebuilding it.
 */
let seatOnePresenter: ((request: ChallengeRequest) => Promise<ChallengeOutcome>) | undefined;

const provider = new Dp600ChallengeProvider({
  presenter: (request) => (seatOnePresenter ?? soloPresenter)(request),
  mastery,
  // Late-bound: this is built before the player has chosen anything.
  graph: () => topicsFor(worldCampaign()),
});

/**
 * The second seat.
 *
 * ⚠️ **Its own presenter, its own bank, and deliberately NO mastery tracker.**
 * The readiness figure and the Great Library describe one person's progress
 * towards DP-600. Feeding a six-year-old's answers about Anlaute into that
 * would corrupt the only number this product really produces, in exactly the
 * way the cheat codes are forbidden from doing (D205).
 *
 * Rebuilt whenever a game starts, because the course can change.
 */
const duo = createDuoModal();
let secondSeat: ((request: ChallengeRequest) => Promise<ChallengeOutcome>) | undefined;
let secondSeatTopics: readonly string[] = [];

function buildSecondSeat(): void {
  secondSeat = undefined;
  secondSeatTopics = [];
  seatOnePresenter = undefined;
  duo.hide();
  if (lastSetup.players !== 2) return;

  const campaign = courseById(lastSetup.courseP2);
  if (!campaign) return;

  const own = courseById(lastSetup.courseP1);
  seatOnePresenter = createQuestionPresenter(
    duo.ui({ seat: 1, who: 'Player 1', course: own?.course ?? 'Fabric Empires' }),
    {
      asked: askedThisSession,
      retired: retiredThisSession,
      onAttempt: (a) => recordAttempt(a, { seat: 1, courseId: lastSetup.courseP1 }),
    },
  );

  /*
   * ⚠️ Seat two keeps its OWN bookkeeping, because it reads its own bank.
   *
   * The second player may be on an entirely different curriculum, and nothing
   * guarantees question ids are unique between two independently authored
   * banks. Sharing the sets would let a Klasse 1 id retire a DP-600 question
   * that happens to be numbered the same, which would look like a question
   * silently going missing.
   */
  secondSeat = createQuestionPresenter(
    duo.ui({ seat: 2, who: 'Player 2', course: campaign.course }),
    {
      questions: campaign.questions,
      asked: new Set<string>(),
      retired: new Set<string>(),
      /*
       * ⚠️ Seat two's attempts ARE recorded, and that does not reopen D205.
       *
       * D205 keeps this seat out of the DP-600 study record, because the
       * readiness figure describes ONE person's progress towards ONE exam and
       * a six-year-old's Anlaute answers would corrupt the only number this
       * product really produces. The stats tables are a different thing: they
       * carry `seat` and `courseId` columns precisely so two learners stay
       * separable in the data. Recording here adds a second learner; it does
       * not merge them.
       *
       * ⚠️ The guard test for D205 reads this function's SOURCE and forbids
       * the name of that tracker appearing anywhere in it, which is why this
       * comment talks around it. That is the test being strict rather than
       * clumsy, and it caught this comment on the first run.
       */
      onAttempt: (a) => recordAttempt(a, { seat: 2, courseId: lastSetup.courseP2 }),
    },
  );
  // The topics this seat can be asked about, which are its own, not the
  // world's. A Klasse 1 player is never asked about a lakehouse.
  secondSeatTopics = [...new Set(campaign.questions.map((q) => q.skillId))].map(
    (id) => `${campaign.id}-${id}`,
  );
}

/**
 * Ask a battle question, of everybody who is playing.
 *
 * ⚠️ **Both seats are asked concurrently, and the scores are averaged.** The
 * engine takes one challenge score, so two answers have to become one number,
 * and averaging is the only combination that makes it genuinely co-operative:
 * the child's answer really moves the battle. Taking the better of the two
 * would be kinder and would make them a spectator with a keyboard.
 *
 * `Promise.all` is what puts both questions on screen at once. Each provider
 * calls its own seat's `ask`, the duo modal renders whatever is pending, and
 * neither player waits for the other.
 */
async function askBattle(
  topicId: string,
  tier: 1 | 2 | 3,
  timeLimitMs: number,
): Promise<number> {
  const first = provider.present({ kind: 'battle', topicId, tier, timeLimitMs });

  if (!secondSeat || secondSeatTopics.length === 0) {
    return (await first).score;
  }

  /*
   * The second seat's topic comes from its own bank and its own seeded
   * stream, so two players sharing a seed get the same pair of questions and
   * a replay asks the same things (D39).
   */
  const pick = createRng(state.seed, `seat2:${state.turn}:${topicId}`);
  const theirTopic =
    secondSeatTopics[Math.floor(pick.float(0, 1) * secondSeatTopics.length)]!;

  const [a, b] = await Promise.all([
    first,
    secondSeat({ kind: 'battle', topicId: theirTopic, tier: 1, timeLimitMs }),
  ]);

  const together = (a.score + b.score) / 2;
  if (b.score > 0 && a.score <= 0) {
    log(t('Player 2 held the line where you did not.'), 'good');
  } else if (b.score > 0) {
    log(t('Both of you knew it. The walls hold.'), 'good');
  }
  return together;
}

/**
 * Timers from D50: tight, but every modal can be paused without penalty.
 *
 * ⚠️ **These are THINKING budgets, not clocks.** The presenter adds a reading
 * allowance for each question on top, computed from that question's own length,
 * so a long one about Direct Lake and a four-word sum for a six-year-old do not
 * share a stopwatch. They were total limits until it was measured that only 54
 * percent of the DP-600 bank could be answered at all inside the old flat 20
 * seconds, and only 3 percent could earn the fast bonus.
 *
 * Read them as: once you have finished reading, this is how long you get.
 */
const BATTLE_TIME_MS = 14_000;
const RESEARCH_TIME_MS = 22_000;

/**
 * Every question's time limit, scaled by the chosen pace.
 *
 * ⚠️ A function of `lastSetup` rather than a constant computed once, because
 * the pace can change when a new game is started and a captured constant would
 * keep the first game's timings for the rest of the session.
 *
 * `scoreFor` grades on how much of the limit was spent as well as on whether
 * the answer was right, so this changes both the thinking time and what a fast
 * answer is worth. Floored so a pace can never make a question expire on
 * arrival.
 */
function timeLimit(base: number): number {
  return Math.max(4_000, Math.round(base * paceScale(lastSetup.pace)));
}

/**
 * The animation layer.
 *
 * Held here rather than inside a renderer because effects outlive a single
 * frame and must not be owned by something that is allowed to be lazy.
 */
const effects = createEffects();
const treasureFilm = createTreasureFilm();
const banner = createBattleBanner();
const choice = createChoiceModal();
const raidAlert = createRaidAlert();
const setup = createSetupScreen();

/**
 * What the setup screen last produced.
 *
 * Kept so reopening it shows the previous choices rather than resetting to the
 * defaults, and so the endgame's "play again" starts a comparable world rather
 * than silently dropping the player back onto one continent.
 */
let lastSetup: SetupResult = { ...DEFAULT_WORLD_CHOICE, seed: 'FABRIC' };

/**
 * Run a typed cheat code.
 *
 * ⚠️ Every successful code is written into `state.cheatsUsed`, which is part of
 * the save. The end screen reads it. A player is entirely welcome to use these,
 * and equally entitled to be reminded that they did.
 */
function runCheat(raw: string): void {
  const typed = raw.trim().toLowerCase();

  if (typed === 'help' || typed === '?') {
    cheats.say('Codes:');
    for (const cheat of CHEATS) {
      cheats.say(`  ${cheat.code.padEnd(CHEAT_CODE_WIDTH)} ${cheat.describe}`);
    }
    /*
     * ⚠️ This used to end "None of them can make you ready. Only answering
     * does that." That was true of every typed code and stopped being true of
     * the game the moment the O+K chord existed. Leaving the line in would
     * have been the cheapest possible lie: nobody re-reads help text looking
     * for things that have quietly become false.
     */
    cheats.say(`  ${'O+K'.padEnd(CHEAT_CODE_WIDTH)} Held together while a question is open: answers it.`);
    cheats.say('  The codes above cannot make you ready. O+K can, and says so on the end screen.');
    return;
  }

  const match = matchCheat(typed);
  if (!match) {
    cheats.say(`No such code: ${typed}. Try help.`, 'bad');
    return;
  }
  const cheat = match.cheat;

  const outcome = cheat.apply({
    state,
    seat: mySeat,
    selectedUnitId,
    argument: match.argument,
    liftFog: () => {
      fogLifted = !fogLifted;
      // ⚠️ The signature is what makes `refreshFog` do any work, so it has to
      // be cleared: a toggle that left it alone would find it unchanged and
      // return early, and nothing on screen would move.
      fogSignature = '';
      refreshFog();
      dirty = true;
      return fogLifted;
    },
    faceProctor: () => {
      cheats.hide();
      void faceTheProctor();
    },
  });

  if (!outcome.ok) {
    cheats.say(outcome.message, 'bad');
    return;
  }

  if (outcome.state) state = recordCheat(outcome.state, cheat.code);
  else state = recordCheat(state, cheat.code);

  cheats.say(outcome.message, 'good');
  log(t('Cheat: {message}', { message: outcome.message }));
  saveGame(slot, state);
  refreshHud();
  refreshResearch();
  refreshSelection();
  refreshThreats();
  dirty = true;
}

const cheats = createCheatConsole({ submit: runCheat });

/**
 * Answer the question currently on screen, correctly or deliberately wrongly.
 *
 * ⚠️ **One implementation, two callers.** The harness (`answerOpen`) and the
 * O+K chord both go through here. Written twice they would drift, and this
 * file has already paid for that twice: the tactic arithmetic split the
 * preview from the resolution, and `againstWalls` nearly did the same.
 */
async function answerCurrentQuestion(correct: boolean): Promise<string | undefined> {
  const question = modal.current();
  if (!question || !modal.isOpen()) return undefined;
  const options = question.options ?? [];

  /*
   * ⚠️ Selecting an option is not answering it.
   *
   * This used to click one option and stop, which sets `aria-pressed` and
   * nothing else: the modal stayed open, the promise never resolved, and
   * the research it was waiting on sat at 12/12 Compute forever. Every
   * assertion downstream then read a game that had quietly stopped, and
   * the only visible symptom was a counter that would not move.
   *
   * A multi-answer question needs every correct option before Submit even
   * enables, so the loop collects them all rather than breaking at the
   * first.
   */
  const multi = question.type === 'multi';
  const needed = multi ? (question.selectCount ?? 2) : 1;
  const wanted: string[] = [];
  for (const option of options) {
    const isRight = await checkAnswer(question.id, option, question.answerHash);
    if (isRight === correct) {
      wanted.push(option);
      if (wanted.length === needed) break;
    }
  }
  if (wanted.length === 0) return undefined;

  const nodes = [...document.querySelectorAll<HTMLElement>('.fe-option')];
  for (const choice of wanted) {
    nodes[options.indexOf(choice)]?.click();
  }

  /*
   * ⚠️ Found by `data-act`, not by the word on the button.
   *
   * This matched `textContent === 'Submit'`, which worked for exactly as
   * long as the interface was English. Translating the modal would have
   * silently broken every automated playthrough in German, and the symptom
   * would have been `answerOpen` returning undefined, which the comment
   * on `openQuestion` already warns has two very different causes.
   */
  const submit = document.querySelector<HTMLButtonElement>('.fe-modal button[data-act="submit"]');
  if (!submit || submit.disabled) return undefined;
  submit.click();

  /*
   * Submitting is still not the end of it. The modal then shows why the
   * answer was what it was, and waits on Continue: that explanation is the
   * point of the whole game, so it is not skippable and nothing downstream
   * resumes until it is dismissed. A test that stopped at Submit left the
   * research permanently at 12/12 Compute.
   */
  for (let i = 0; i < 40; i++) {
    const cont = document.querySelector<HTMLButtonElement>(
      '.fe-modal button[data-act="continue"]',
    );
    if (cont) {
      cont.click();
      break;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return wanted.join(' | ');
}

/**
 * The O+K chord: hold both and the question answers itself.
 *
 * ⚠️ **This one DOES count towards readiness, and that is a deliberate change
 * of policy rather than an oversight.** Every other code in `cheats.ts` moves
 * Compute, armies, walls and turns and pointedly leaves `mastery` alone,
 * because a false 82% is worse than any amount of losing. Alexander asked for
 * this one to count anyway, and it is his study tool. The docblock in
 * `cheats.ts` and the console's help text were both rewritten to stop claiming
 * otherwise: a promise the code no longer keeps is worse than no promise.
 *
 * What keeps it honest is disclosure. `okay` is written into `state.cheatsUsed`
 * the first time it is used, it lives in the save, and the end screen reads it.
 *
 * A chord rather than a single key because the modal is a keyboard surface: 1
 * to 6 pick options and Enter submits, so a lone letter is one fumble away
 * from answering a question the player meant to read.
 */
function armAnswerChord(): void {
  const held = new Set<string>();
  let firing = false;

  const clear = (): void => {
    held.clear();
    firing = false;
  };

  window.addEventListener('keydown', (event) => {
    // ⚠️ Not `event.key`, which is layout-dependent: on a German keyboard the
    // physical Z key reports "y". `code` names the physical key, which is what
    // "press O and K together" actually means to a hand.
    held.add(event.code);
    if (!held.has('KeyO') || !held.has('KeyK')) return;
    if (!modal.isOpen()) return;
    // Auto-repeat fires keydown forever while a key is held, and the answer
    // takes a moment to submit; without this the chord would try again on
    // every repeat and race itself.
    if (firing) return;
    firing = true;
    event.preventDefault();
    event.stopPropagation();

    void (async () => {
      const given = await answerCurrentQuestion(true);
      if (given === undefined) return;
      if (!state.cheatsUsed.includes(OKAY_CHEAT)) {
        state = recordCheat(state, OKAY_CHEAT);
        saveGame(slot, state);
      }
      log(t('Okay. The answer picked itself.'));
    })();
  }, true);

  /*
   * ⚠️ Released on keyup AND on blur. A key held while the window loses focus
   * never gets its keyup, so without the blur the set would keep "KeyO" for
   * ever and the chord would fire on a lone K from then on.
   */
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
    if (!held.has('KeyO') || !held.has('KeyK')) firing = false;
  }, true);
  window.addEventListener('blur', clear);
}

armAnswerChord();

/**
 * Disclose a harness call that granted something ordinary play cannot.
 *
 * ⚠️ The cheat console already promises, in its own help text, that "none of
 * them can make you ready. Only answering does that." `studyAll` makes you
 * ready. It grants full mastery of all 41 topics, and mastery is the only gate
 * on the Proctor, so it is a straighter route to the Exam victory than any
 * typed code offers.
 *
 * ⚠️ And the harness **ships on the public URL**. Anyone can open devtools,
 * call `__fabricEmpires.studyAll(6)`, sit the exam and be handed a victory
 * screen that says no cheats were used. This was found by doing exactly that:
 * the first full playthrough this game has ever had finished on turn one with
 * **0 of 41 skills and 0 cities**, and the end screen disclosed nothing.
 *
 * Recording it here keeps one rule for both doors. Harness calls that only
 * automate ordinary play (`clickHex`, `endTurn`, `answerOpen`) are not grants
 * and are deliberately not recorded, nor is anything read-only.
 */
function recordHarnessGrant(name: string): void {
  const tag = `harness:${name}`;
  if (state.cheatsUsed.includes(tag)) return;
  state = recordCheat(state, tag);
}

/**
 * The Great Library.
 *
 * Reads fresh on every open rather than being kept in sync, because it is a
 * reference screen consulted occasionally, and a snapshot taken at the moment
 * of opening cannot drift from the game the way a cached one would.
 */
const library = createGreatLibrary(() => {
  const now = Date.now();
  const campaign = worldCampaign();
  const model = buildLibraryModel({
    records: new Map(state.topics.nodes.map((n) => [n.id, mastery.get(n.id)])),
    researched: new Set(state.research.known),
    questions: campaign.questions,
    outline: campaign.outline,
    campaignId: campaign.id,
    due: new Set(provider.dueTopics(now)),
  });
  return { model, summary: summarise(model), now };
});

/** The free camera's instrument panel. Hidden until the drone has the camera. */
const droneHud = createDroneHud();

/**
 * The end of a game.
 *
 * Starts the next one on the seed in the box, so a player who lost to a
 * particular map can immediately try it again knowing what is coming.
 */
const endScreen = createEndScreen(() => {
  lastSetup = { ...lastSetup, seed: el.seedInput.value };
  void askAndStart();
});

/**
 * The cinematics.
 *
 * ⚠️ **Each fires once per game, and only the first time.** The whole value of
 * an establishing shot is that it marks something as new; the fourth city is
 * not news, and a game that stops to admire every one of them would be
 * unplayable by turn twenty. `seen` is reset when a new empire starts, not
 * carried in the save, because these mark the beats of a *run*.
 */
/**
 * How well a topic is currently held, as a number the engine can use.
 *
 * ⚠️ The whole of the D35 boundary, in one function. The engine asks "how
 * strong is this opaque string" and gets a number; it never learns that the
 * strings are DP-600 skills, that there is such a thing as spaced repetition,
 * or that a certification exists.
 */
const topicStrength = (topicId: string): number => bandStrength(mastery.get(topicId));

/** One line saying what a new rank is actually worth, so it is not just a word. */
function whyItRose(rank: CityRankInfo): string {
  const percent = Math.round((rank.yieldBonus - 1) * 100);
  return percent > 0 ? t('Yields +{percent}%.', { percent }) : t('The first step.');
}

/**
 * The proposed city sites, as a list you can click.
 *
 * ⚠️ **This exists because the map cannot carry this at the zoom people plan
 * at.** Measured on the deployed build, the five proposed hexes at the opening
 * camera covered about 24 by 11 pixels between them, so whatever is painted on
 * the ground there is a handful of pixels per tile. Text has no such problem,
 * and it can show the numbers the ranking is actually made of rather than
 * implying them with opacity.
 *
 * Clicking a row moves the CAMERA, not the unit. Founding is permanent and
 * a single control that sometimes walks an Architect across the map and
 * sometimes only looks at a tile would be two behaviours wearing one label.
 */
function renderSettleList(): void {
  el.settleSites.replaceChildren();
  if (settleSuggestions.length === 0) {
    el.settleSites.hidden = true;
    return;
  }
  el.settleSites.hidden = false;

  settleSuggestions.forEach((site, index) => {
    const button = document.createElement('button');
    button.title = t('Show this site');

    const rank = document.createElement('span');
    rank.className = 'rank';
    // The same number the map draws on the tile, so the two are one message.
    rank.textContent = String(index + 1);

    const growsShort =
      site.turnsToGrow === undefined
        ? t('will not grow')
        : plural(site.turnsToGrow, '{n} turn', '{n} turns');
    const growsLong =
      site.turnsToGrow === undefined
        ? t('will not grow')
        : plural(site.turnsToGrow, '{n} turn to grow', '{n} turns to grow');
    const where =
      site.distance === 0
        ? t('here')
        : plural(site.distance, '{n} hex away', '{n} hexes away');

    /*
     * ⚠️ Short on the row, long in the tooltip. Five rows of three wrapped
     * lines pushed the selection panel up behind the research panel, which is
     * a worse failure than the one this list was added to fix.
     */
    button.title = `${site.dataAtFounding} Data, ${growsLong}, ${where}`;

    const text = document.createElement('span');
    text.textContent = `${site.dataAtFounding} Data · ${growsShort} · ${where}`;

    button.append(rank, text);
    if (site.reachableNow && site.distance > 0) {
      const now = document.createElement('span');
      now.className = 'now';
      // A mark, not a sentence: the words cost a whole line each.
      now.textContent = '●';
      now.title = t('reachable this turn');
      button.append(now);
    }

    button.addEventListener('click', () => scene.focus(site.hex));
    el.settleSites.append(button);
  });
}


/**
 * A settlement rank in the current language.
 *
 * ⚠️ Reads `labelDe` off the engine's rank table rather than going through the
 * catalogue. The two names of a rank were deliberately put on one row so they
 * could not drift apart (D263), and copying the German into a second place
 * would undo exactly that.
 */
function rankName(id: CityRank): string {
  const info = rankInfo(id);
  return lang() === 'de' ? info.labelDe : info.label;
}

const cinemaOverlay = createCinematicOverlay();
cinemaOverlay.onSkip(() => scene.cinema.skip());

/**
 * Whether the player has asked to be done with the opening.
 *
 * ⚠️ **`cinema.skip()` ends the current SHOT, not the sequence.** The opening
 * plays four of them in a row, so pressing Escape skipped one beat and started
 * the next, and a player who wanted to get on with the game had to press it
 * four times. Nobody reads that as "skip"; they read it as ignored.
 */
let openingSkipped = false;
/**
 * Whether the opening film is on screen right now.
 *
 * ⚠️ Read by the first-click handler that starts the background score. The
 * anthem owns the opening, and two pieces of orchestral music at once is not
 * a richer soundtrack, it is a mess.
 */
let openingRunning = false;
cinemaOverlay.onSkip(() => {
  openingSkipped = true;
});
const seenCinematics = new Set<string>();

/**
 * The optional score for the opening.
 *
 * Silent unless `public/audio/anthem.mp3` is present, which it is not in a
 * fresh clone. See `audio.ts` for why the file is kept out of the repository.
 */
const anthem = createAnthem();

/**
 * The silence between the anthem ending and the score beginning.
 *
 * ⚠️ Not zero, and not the 800 ms it used to be. Zero would overlap two
 * recordings in different keys; 800 was long enough that a player heard music
 * stop and, separately, music start. A quarter of a second reads as one breath
 * inside a single continuous piece of sound.
 */
const HANDOVER_BREATH_MS = 250;

/**
 * The optional score for everything after the opening.
 *
 * Same contract as the anthem: silent and harmless when the files are absent.
 * Started either at the end of the opening film or, for a resumed game that
 * never plays one, on the first click. See `soundtrack.ts`.
 */
const music = createSoundtrack();

/**
 * The sound the cinematics make.
 *
 * ⚠️ Unlike the music, this ships: it is synthesised from oscillators at the
 * moment it plays, so it has no file, no licence and no download, and it
 * works in a fresh clone. See `cues.ts`.
 */
const cues = createCues();

/*
 * Which edition is this?
 *
 * ⚠️ Asked once, in the background, and nothing waits for the answer. The game
 * is fully playable while this is in flight; all it decides is whether the
 * Great Library shows a chat box next to the advice it already computes. A
 * boot that blocked on a network probe would make the capacity edition slower
 * to start than the free one, which is precisely backwards.
 */
void probeEdition();

async function playOnce(shot: ReturnType<typeof orbitShot>): Promise<void> {
  if (seenCinematics.has(shot.id) || finished) return;
  seenCinematics.add(shot.id);
  cinemaOverlay.show(shot.title, shot.subtitle);
  /*
   * Pull the score down and sound the cue.
   *
   * ⚠️ The duck is not decoration. A four second phrase played on top of a
   * background bed at the same level is not a cue, it is a second piece of
   * music, and the two argue. Pulling the bed to a third for the length of
   * the film is the ordinary broadcast answer and the reason the cue reads as
   * belonging to what is on screen.
   */
  music.duck(true);
  cues.play(shot.id);
  try {
    await scene.cinema.play(shot);
  } finally {
    cinemaOverlay.hide();
    music.duck(false);
  }
}

/**
 * A siege, with the interface out of the way.
 *
 * ⚠️ The set piece drops the camera to the foot of the wall, and the first
 * live look at it was composed behind the research panel, the city panel and
 * the log. `cinematicOverlay` already owns the answer to that and says so in
 * its own comments, so the siege borrows it rather than growing a second way
 * to fade the same panels.
 *
 * Bars off, and no title card: those are sized for the once-a-game shots. What
 * this buys on top of the framing is Escape, because the overlay's skip
 * handler is already wired to `scene.cinema.skip()` and a siege is something a
 * player will see many times in a long game.
 */
async function playSiegeFramed(...args: Parameters<typeof playSiege>): Promise<void> {
  cinemaOverlay.show('', '', { bars: false });
  try {
    await playSiege(...args);
  } finally {
    cinemaOverlay.hide();
  }
}

/*
 * Keep the drone on the ground while an overlay is up.
 *
 * `flyControls` binds keydown on `window` and only declines to fly when the
 * event came from an input, which is the right rule for a twin whose whole
 * page is the map. Here a question modal or the library can be covering the
 * screen, and W A S D behind them would quietly take off: the camera would be
 * somewhere else by the time the player closed the overlay.
 *
 * Capture phase on `window` runs before the module's own bubble-phase listener,
 * so stopping the event here means the latch never sees it. Only the eight
 * movement keys are swallowed, deliberately: Escape still has to reach the
 * library to close it, and the arrows only look, which needs an engaged drone
 * that these keys are now preventing.
 */
const DRONE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f']);
window.addEventListener(
  'keydown',
  (e) => {
    if (!modal.isOpen() && !library.isOpen()) return;
    if (DRONE_KEYS.has(e.key.toLowerCase())) e.stopImmediatePropagation();
  },
  { capture: true },
);

/**
 * Battles are choreographed at two lengths.
 *
 * Every fight is preceded by a question, so a long set piece on every single
 * clash would be exhausting by the tenth one. The full treatment is reserved
 * for the moments that deserve it: the player's first battle of a game, and
 * any assault on a city. Everything else gets the short, punchy version.
 */
const DRAMA_MS = 900;
const PUNCH_MS = 260;
let hadFirstBattle = false;
/** Set while the antagonists are marching, so the log says so only once. */
let hordeAdvancing = false;
/** Set when the game has an outcome, so no further turns can be played. */
let finished = false;
/** Set once the Proctor has been announced, so it is said only once. */
let proctorAnnounced = false;
/** Set while the exam is being sat, so it cannot be started twice. */
let siegeRunning = false;
/**
 * True while a turn's result is being watched rather than applied.
 *
 * ⚠️ The raid is choreographed on the world as it was, so for those few
 * seconds `state` is deliberately a turn behind the engine. A click during
 * that window would move a unit in the old world and then have the whole move
 * silently overwritten when the result is adopted.
 */
let resolvingTurn = false;

/**
 * The topic a question's skill belongs to.
 *
 * Questions carry a 1-based skill number from the outline; the engine's topic
 * graph is the same 41 nodes in the same order. Keeping the lookup in one
 * place means the exam feeds the same schedule as everything else rather than
 * inventing topic ids of its own.
 */
function topicIdForSkill(skillId: number): string | undefined {
  return state.topics.nodes[skillId - 1]?.id;
}

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const fxCanvas = document.querySelector<HTMLCanvasElement>('#fx')!;
const ctx = fxCanvas.getContext('2d')!;

/**
 * Quality is chosen once, from what the GPU reports.
 *
 * Ambient occlusion and a 4k shadow map are the two passes that turn a
 * smooth game into a slideshow on integrated graphics, and a player on a
 * laptop should get a game that runs rather than a game that is correct.
 */
function detectQuality(): typeof HIGH_QUALITY {
  const probe = document.createElement('canvas').getContext('webgl2');
  const debugInfo = probe?.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo
    ? String(probe?.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '')
    : '';
  const weak = /(Intel|Iris|UHD|HD Graphics|SwiftShader|llvmpipe|Software)/i.test(renderer);
  return weak ? LOW_QUALITY : HIGH_QUALITY;
}

const scene = createScene3D(canvas, detectQuality());

const el = {
  turn: document.querySelector<HTMLElement>('#turn-badge')!,
  compute: document.querySelector<HTMLElement>('#res-compute')!,
  cu: document.querySelector<HTMLElement>('#res-cu')!,
  trust: document.querySelector<HTMLElement>('#res-trust')!,
  endTurn: document.querySelector<HTMLButtonElement>('#end-turn')!,
  openLibrary: document.querySelector<HTMLButtonElement>('#open-library')!,
  openSeats: document.querySelector<HTMLButtonElement>('#open-seats')!,
  seedInput: document.querySelector<HTMLInputElement>('#seed-input')!,
  seedGo: document.querySelector<HTMLButtonElement>('#seed-go')!,
  tileName: document.querySelector<HTMLElement>('#tile-name')!,
  tileDetail: document.querySelector<HTMLElement>('#tile-detail')!,
  selTitle: document.querySelector<HTMLElement>('#sel-title')!,
  selDetail: document.querySelector<HTMLElement>('#sel-detail')!,
  selPrev: document.querySelector<HTMLButtonElement>('#sel-prev')!,
  selNext: document.querySelector<HTMLButtonElement>('#sel-next')!,
  selCount: document.querySelector<HTMLElement>('#sel-count')!,
  settleSites: document.querySelector<HTMLElement>('#settle-sites')!,
  actFound: document.querySelector<HTMLButtonElement>('#act-found')!,
  actRaid: document.querySelector<HTMLButtonElement>('#act-raid')!,
  actFortify: document.querySelector<HTMLButtonElement>('#act-fortify')!,
  actStand: document.querySelector<HTMLButtonElement>('#act-stand')!,
  actSkip: document.querySelector<HTMLButtonElement>('#act-skip')!,
  actCouncil: document.querySelector<HTMLButtonElement>('#act-council')!,
  log: document.querySelector<HTMLElement>('#log')!,
  resTitle: document.querySelector<HTMLElement>('#res-title')!,
  resBar: document.querySelector<HTMLElement>('#res-bar')!,
  resStatus: document.querySelector<HTMLElement>('#res-status')!,
  resOptions: document.querySelector<HTMLElement>('#res-options')!,
  cities: document.querySelector<HTMLElement>('#cities')!,
  citiesList: document.querySelector<HTMLElement>('#cities-list')!,
  readiness: document.querySelector<HTMLElement>('#readiness')!,
  faceProctor: document.querySelector<HTMLButtonElement>('#face-proctor')!,
  threatsList: document.querySelector<HTMLElement>('#threats-list')!,
  langToggle: document.querySelector<HTMLButtonElement>('#lang-toggle')!,
  musicToggle: document.querySelector<HTMLButtonElement>('#music-toggle')!,
  fullscreenToggle: document.querySelector<HTMLButtonElement>('#fullscreen-toggle')!,
};

/*
 * The language switch.
 *
 * ⚠️ **The button shows the language it will switch TO, not the current one.**
 * A button labelled with the language you are already reading looks like a
 * status badge, and people do not press status badges. "DE" while playing in
 * English is an offer.
 *
 * Everything downstream redraws from `state`, so a change only has to repaint
 * the static shell and mark the frame dirty; the panels rebuild themselves.
 */
function paintLangToggle(): void {
  el.langToggle.textContent = lang() === 'en' ? 'DE' : 'EN';
  el.langToggle.title = lang() === 'en' ? 'Auf Deutsch spielen' : 'Play in English';
}

el.langToggle.addEventListener('click', () => {
  toggleLang();
});

/*
 * The sound switch.
 *
 * ⚠️ **Hidden until a track has actually been found.** A mute button in a
 * build with no audio files is a control that does nothing, and a control
 * that does nothing is worse than an absent one: the player presses it,
 * hears no change, and now distrusts the rest of the interface. The probe in
 * `soundtrack.ts` decides, and it decides after a round trip, so this repaints
 * on change rather than once at load.
 *
 * ⚠️ **One switch for everything that makes a noise**, which is why it says
 * sound rather than music. It is the only audio control in the game, and
 * somebody who presses it wants quiet; being hit by a gong ten seconds later
 * because the cinematics are technically a different subsystem would read as
 * a bug, and they would be right.
 */
function paintMusicToggle(): void {
  el.musicToggle.hidden = !music.available;
  el.musicToggle.classList.toggle('muted', music.muted);
  el.musicToggle.title = music.muted ? t('Turn the sound on') : t('Turn the sound off');
}

el.musicToggle.addEventListener('click', () => {
  music.toggle();
  cues.setMuted(music.muted);
  paintMusicToggle();
});

music.onChange(paintMusicToggle);
cues.setMuted(music.muted);
paintMusicToggle();

/**
 * Fullscreen.
 *
 * ⚠️ **Asked for, not assumed.** `requestFullscreen` is absent on an iPhone
 * entirely, and present but refusable everywhere else, so the button is hidden
 * unless the element actually has the method. Same contract as the sound
 * switch: a control that visibly does nothing is worse than no control,
 * because the player presses it, sees nothing, and starts distrusting the rest
 * of the interface (D304).
 *
 * Whole document rather than the canvas: the HUD is part of the game, and
 * fullscreening only the map would leave the player unable to end their turn.
 */
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

const fullscreenRoot = document.documentElement as FullscreenElement;
const fullscreenDoc = document as FullscreenDocument;

function fullscreenSupported(): boolean {
  return (
    typeof fullscreenRoot.requestFullscreen === 'function' ||
    typeof fullscreenRoot.webkitRequestFullscreen === 'function'
  );
}

function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement ?? fullscreenDoc.webkitFullscreenElement);
}

function paintFullscreenToggle(): void {
  el.fullscreenToggle.hidden = !fullscreenSupported();
  const on = isFullscreen();
  /*
   * ⚠️ One glyph and a class, not two glyphs.
   *
   * The first attempt swapped ⛶ for \u26F7 as a "shrink" symbol. U+26F7 is
   * SKIER. It rendered as ⛷ in the resource bar and nothing failed, because
   * no test can know what a code point looks like. The sound switch had
   * already solved this the right way round: keep the recognisable glyph,
   * mark the state with CSS, and let the translated title carry the sentence.
   */
  el.fullscreenToggle.classList.toggle('on', on);
  el.fullscreenToggle.title = on ? t('Leave fullscreen') : t('Fullscreen');
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) {
      await (fullscreenDoc.exitFullscreen?.() ?? fullscreenDoc.webkitExitFullscreen?.());
    } else {
      await (fullscreenRoot.requestFullscreen?.() ?? fullscreenRoot.webkitRequestFullscreen?.());
    }
  } catch {
    /*
     * A refusal is a normal event, not an error. Chrome rejects the promise
     * when the gesture is stale and Firefox when the page is not focused, and
     * in both cases the right response is to leave the interface describing
     * the state the browser is actually in rather than the one we asked for.
     */
  }
  paintFullscreenToggle();
}

el.fullscreenToggle.addEventListener('click', () => void toggleFullscreen());

/*
 * ⚠️ The state can change without us: F11, Escape, and the browser's own
 * chrome all leave fullscreen, and none of them go through the button. The
 * event is the only honest source of truth for what the label should say.
 *
 * `fitCanvas` because the board is measured from its own element, and entering
 * fullscreen changes what `vh` means. Chrome fires `resize` too and the fit is
 * idempotent, so doing it twice costs nothing and missing it once shows a
 * world drawn for the wrong screen.
 */
for (const event of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(event, () => {
    paintFullscreenToggle();
    fitCanvas();
  });
}

paintFullscreenToggle();

/**
 * The first click of a RESUMED game is the gesture the browser wants.
 *
 * ⚠️ **Armed only on the resumed path, and only once the attract has finished.**
 *
 * This used to be registered at module load, for every player, guarded by
 * `if (!openingRunning)`. That was wrong twice.
 *
 * A player starting a NEW game never needed it: the opening's handover starts
 * the score 2.4 s after the anthem fades, and arming it as well meant the
 * first pointerdown, which is the Begin button, started the score a moment
 * before the anthem began.
 *
 * And once a teaser was added in front of the setup screen, the first
 * pointerdown in the whole app became the **Enter button**, so this fired
 * underneath the film and the score played on top of the teaser's own cue.
 * The guard could not help: `openingRunning` names the in-game cinematic and
 * knows nothing about a second film. A condition that names one specific
 * thing cannot answer "is anything playing".
 *
 * Arming it where it is actually needed removes the question entirely.
 */
function startMusicOnFirstGesture(): void {
  window.addEventListener('pointerdown', () => music.start(), { once: true });
}

onLangChange(() => {
  applyStaticTranslations();
  paintLangToggle();
  // ⚠️ Not a `data-i18n-title`, because the music button's title depends on
  // whether it is muted as well as on the language. Two owners writing the
  // same attribute is how one of them ends up stale.
  paintMusicToggle();
  // Every panel rebuilds its contents from state, so switching language is
  // just "draw everything again" rather than a hunt for stray strings.
  refreshHud();
  refreshSelection();
  refreshResearch();
  refreshCities();
  refreshThreats();
  refreshReadiness();
  dirty = true;
});

applyStaticTranslations();
/*
 * ⚠️ The readiness figure is static text in the markup, and static text in the
 * markup is English. `data-i18n` cannot carry it because the string has a
 * placeholder, so it is painted here instead, with the zero the markup was
 * already claiming. Without this a German player reads "0% exam" for the whole
 * of the setup screen; `onLangChange` repaints it, so only the first render
 * was ever wrong, which is exactly the render nobody looks at twice.
 */
paintReadiness(0);
paintLangToggle();

/*
 * Fold the reference panels away.
 *
 * ⚠️ After `applyStaticTranslations`, because the module injects a heading for
 * the panels that have none and reads the existing `<h2>` for its accessible
 * label. Running first would label them in English on a German HUD and inject
 * an untranslated heading.
 *
 * Closed by default only on the narrow layout: the mobile audit measured the
 * HUD column at 1542 px of content in a 371 px window, which is four screens
 * of scrolling to reach a button.
 */
const panels = createPanels({ t });
panels.apply();

let state: GameState = createGameState('FABRIC', { topics: provider.topics() });
/**
 * Which seat this browser is playing.
 *
 * ⚠️ **A variable rather than `PLAYER_FACTION_ID`, because it can change.**
 * Every empire is a seat, and taking a vacant one means the answers to "my
 * units", "my towns", "my fog" all move to a different faction id. Reading the
 * constant instead would keep drawing the empire you used to be, which shows up
 * as a map full of units you cannot order about.
 *
 * It still STARTS as the player faction: a fresh game seats you in the empire
 * that was built for you.
 */
let mySeat: string = PLAYER_FACTION_ID;
/** Where the empire is kept between visits. See `persist.ts`. */
const slot = localSlot();
let selectedUnitId: string | undefined;
let reach: ReadonlyMap<string, ReachableTile> | undefined;
let attackTargets: Set<string> | undefined;
/** Where the selected Architect could build, best first. Empty otherwise. */
let settleSuggestions: readonly SettleSite[] = [];
let hover: Hex | undefined;
let dirty = true;

function log(message: string, tone: 'good' | 'bad' | 'plain' = 'plain'): void {
  const entry = document.createElement('div');
  entry.className = `entry${tone === 'plain' ? ' muted' : ` ${tone}`}`;
  entry.textContent = message;
  el.log.append(entry);
  while (el.log.childElementCount > 40) el.log.firstElementChild?.remove();
  el.log.scrollTop = el.log.scrollHeight;
}

// Selection ------------------------------------------------------------

/**
 * Recompute what the selected unit can do.
 *
 * Both overlays come straight from the engine rules, so what is painted is
 * exactly what the engine will permit. A UI that computes its own idea of
 * "reachable" eventually disagrees with the rules, and the player is the one
 * who finds out.
 */
/**
 * The route to draw for the selected unit, if it has one.
 *
 * ⚠️ Recomputed from the target every time rather than cached with the order.
 * A stored path goes stale the moment anything else moves: a rival walks into
 * the pass, the line still runs through them, and the numbers promise an
 * arrival the unit will not make. Recomputing is an A* over a few dozen tiles.
 *
 * ⚠️ The turn numbers are the leg's INDEX, so a unit that has already spent its
 * movement this turn is honestly labelled. Its first leg is empty, no marker is
 * drawn on the tile it is standing on, and the first place it actually reaches
 * is numbered 2, because that is when it gets there.
 */
function marchOverlay(): MarchOverlay | undefined {
  const unit = selectedUnitId ? state.units.get(selectedUnitId) : undefined;
  if (!unit?.order || unit.factionId !== mySeat) return undefined;
  const plan = planMarch(state, unit, unit.order.target);
  if (!plan) return undefined;
  return {
    path: plan.path,
    stops: plan.legs
      .map((leg, i) => ({ hex: leg.at, turn: i + 1 }))
      .filter((s, i) => plan.legs[i]!.hexes.length > 0),
  };
}

function refreshSelection(): void {
  reach = undefined;
  attackTargets = undefined;
  settleSuggestions = [];

  /*
   * The march overlay follows the selection, which is what the player asked
   * for: a route drawn for every unit at once would be a plate of spaghetti on
   * a map that is already carrying territory, fog and threat markers.
   */
  effects.setMarch(marchOverlay());

  /*
   * The stepper is refreshed before the early return, so it stays usable with
   * nothing selected: that is the state a player is in after a unit dies, and
   * it is precisely when "show me what I still have" is the useful action.
   */
  const own = ownUnits();
  const place = own.findIndex((u) => u.id === selectedUnitId);
  el.selPrev.disabled = own.length === 0;
  el.selNext.disabled = own.length === 0;
  el.selCount.textContent = own.length === 0 ? '' : `${place + 1 || '-'}/${own.length}`;

  const unit = selectedUnitId ? state.units.get(selectedUnitId) : undefined;
  if (!unit || unit.factionId !== state.activeFactionId) {
    selectedUnitId = undefined;
    el.selTitle.textContent = t('Nothing selected');
    el.selDetail.textContent = t('Click one of your units.');
    el.actFound.disabled = true;
    el.actRaid.disabled = true;
    el.actFortify.disabled = true;
    // Nothing selected means no order to call off.
    el.actStand.hidden = true;
    /*
     * ⚠️ The resting label is rewritten here, not only on the selected path.
     *
     * Deselecting a dug-in unit would otherwise leave "Wake" on the button
     * with nothing to wake. The markup's `data-i18n` only covers the paint
     * before a game exists; from then on this function owns the text, and
     * `onLangChange` runs it after the static pass so it always wins.
     */
    el.actFortify.textContent = t('Fortify');
    el.actSkip.disabled = true;
    renderSettleList();
    refreshCouncil();
    return;
  }

  const type = unitType(unit.typeId);
  reach = reachable(state, unit);

  const targets = new Set<string>();
  for (const tile of state.map.tiles.values()) {
    if (canAttack(state, unit.id, tile.hex).ok) targets.add(hexKey(tile.hex));
  }
  attackTargets = targets;

  /*
   * Where this Architect could build, if it is one.
   *
   * ⚠️ Founding is the most consequential and least explained decision in the
   * game: the site is permanent, the difference between a good one and a bad
   * one is enormous, and nothing on screen used to say which was which. A
   * player who did not already know that Data is what makes a city grow
   * settled where they happened to be standing.
   */
  /*
   * ⚠️ **Not while the unit is marching somewhere.** Both overlays write
   * numbers on hexes, and an Architect is the one unit that gets both: the
   * settle advice numbers its five best sites, the march numbers its turns.
   * Seen together, as they were on the first live look, the two sets pile up
   * around the unit and neither can be read. The march wins because it is an
   * order the player gave; the sites are advice, and they come back the moment
   * the order is cancelled or fulfilled.
   */
  settleSuggestions = unit.order ? [] : settleSites(state, unit);
  renderSettleList();

  // ⚠️ The unit's name is NOT translated: Pipeline Runner and Direct Lake
  // Titan are jokes built on Fabric terminology, and a German Fabric user says
  // them in English. The words around them are ordinary and are translated.
  el.selTitle.textContent = type.label;
  /*
   * ⚠️ Cover is stated, because a bonus nobody can see is a bonus nobody uses.
   *
   * Standing in your own city is now worth a great deal and costs nothing, and
   * there is no button for it: you just walk in. The one place a player could
   * possibly learn that is here, on the unit that is doing it.
   */
  const shelter = cityAt(state, unit.hex);
  const inCover = shelter?.factionId === unit.factionId;
  /*
   * ⚠️ Mending is stated, and only while it is actually happening.
   *
   * Digging in is now the only way a unit recovers, and a rule that acts once
   * per turn between turns is invisible unless something says so: the player
   * would see a number go up and have no way to attribute it. Suppressed at
   * full health, where "+12 HP a turn" would be a promise the game is not
   * currently keeping.
   */
  const mending = unit.fortified && unit.hp < type.maxHp;

  el.selDetail.textContent =
    `${unit.hp}/${type.maxHp} ${t('HP')}  ` +
    `${unit.movesLeft}/${type.movement} ${t('moves')}  ` +
    `${t('strength')} ${type.strength}` +
    (unit.fortified ? `  (${t('fortified')})` : '') +
    (mending
      ? `  (${t('mending +{hp} HP a turn', {
          hp: Math.round(type.maxHp * FORTIFY_HEAL_SHARE),
        })})`
      : '') +
    (inCover ? `  (${t('in cover: {city}', { city: shelter.name })})` : '');

  /*
   * The advice, in the words that matter: how fast will it grow.
   *
   * Data is this game's food. It never leaves the city that made it and it is
   * the only thing that adds citizens, so "six turns to the next citizen" says
   * more about a site than any score could.
   */
  const best = settleSuggestions[0];
  if (best) {
    /*
     * ⚠️ The tile underfoot is measured directly, not looked up in the list.
     *
     * The list is the best five sites, and where the Architect happens to be
     * standing is frequently not one of them, which is precisely when the
     * comparison matters most. Fetching it from the list meant the hint
     * disappeared exactly when the player most needed to know what they would
     * be giving up by building here.
     */
    const hereData = canFoundCity(state, unit) ? dataAtFounding(state, unit.hex) : undefined;
    const grows = (turns: number | undefined): string =>
      turns === undefined
        ? t('will not grow')
        : plural(turns, '{n} turn to grow', '{n} turns to grow');
    const summary = (data: number): string =>
      `${data} Data, ${grows(turnsToFirstCitizen(data))}`;

    el.selDetail.textContent +=
      best.distance === 0
        ? `  ·  ${t('good site')}: ${summary(best.dataAtFounding)}`
        : /*
           * ⚠️ **Only the comparison, because the list now carries the rest.**
           *
           * This used to spell out the best nearby site here as well. That is
           * now rank 1 of the list directly below, in the same words, and the
           * duplicate cost three wrapped lines: enough to push this panel up
           * behind the research panel, since both are fixed and anchored to
           * opposite edges.
           *
           * What the list cannot say is what you give up by founding where
           * you are standing, because the tile underfoot is usually not one of
           * the five. So that stays.
           */
          hereData === undefined
          ? ''
          : `  ·  ${t('here')}: ${summary(hereData)}`;
  }

  el.actFound.disabled = !canFoundCity(state, unit);
  el.actRaid.disabled = raidTarget(unit.id) === undefined;  // The one action that reverses itself, so it is labelled by what it will do
  // next rather than by what it is.
  el.actFortify.disabled = type.strength === 0;
  el.actFortify.textContent = unit.fortified ? t('Wake') : t('Fortify');
  el.actFortify.title = unit.fortified
    ? t('Stand down, and move again this turn (h)')
    : t('Dig in for +40% defence, ending this turn (h)');
  el.actSkip.disabled = unit.movesLeft <= 0;
  /*
   * Calling off a march.
   *
   * ⚠️ **An order had no off switch.** It could be replaced by giving another
   * one, and cancelled as a side effect of moving the unit by hand, but there
   * was no way to simply say "forget it, I will decide next turn" — so a route
   * drawn by a misclick kept walking, and the dotted line stayed on the map
   * describing a journey the player no longer wanted.
   *
   * Shown only while there is something to cancel; see the note in the markup.
   */
  el.actStand.hidden = !unit.order;
  refreshCouncil();
  // Orders given or withdrawn change what is left to do.
  refreshTurnButton();
}

function select(unitId: string | undefined): void {
  selectedUnitId = unitId;
  refreshSelection();
  dirty = true;
}

/**
 * The neighbouring village this unit could rob, if any.
 *
 * Returns the hex rather than a boolean so the button and the keyboard
 * shortcut cannot disagree about which village they meant, which they would
 * if each searched the neighbours separately.
 */
function raidTarget(unitId: string): Hex | undefined {
  const unit = state.units.get(unitId);
  if (!unit) return undefined;
  for (let dir = 0; dir < 6; dir++) {
    const hex = hexNeighbour(unit.hex, dir);
    if (canRaid(state, unitId, hex).ok) return hex;
  }
  return undefined;
}

function doRaid(): void {
  if (!selectedUnitId) return;
  const target = raidTarget(selectedUnitId);
  if (!target) {
    // Say why rather than doing nothing: the cooldown is invisible otherwise.
    const near = hexNeighbour(state.units.get(selectedUnitId)!.hex, 0);
    log(t(canRaid(state, selectedUnitId, near).reason ?? 'Nothing to raid here.'), 'bad');
    return;
  }

  const village = cityAt(state, target);
  const result = raidCity(state, selectedUnitId, target);
  if (!result.ok || !result.state) {
    log(t(result.reason ?? 'The raid failed.'), 'bad');
    return;
  }

  state = result.state;
  const parts = Object.entries(result.loot ?? {})
    .filter(([, amount]) => (amount ?? 0) > 0)
    .map(([id, amount]) => `${amount} ${id}`);
  log(
    `Raided ${village?.name ?? 'the village'}: ${parts.join(', ') || 'nothing worth taking'}.`,
    'good',
  );
  effects.floatingText(target, 'RAIDED', '#ffcf7a', 1.2);
  refreshSelection();
  dirty = true;
}

/** Jump to the next unit still awaiting orders, the way a 4X should. */
function selectNextIdle(): void {
  const idle = awaitingOrders();
  if (idle.length === 0) {
    select(undefined);
    return;
  }
  const currentIndex = idle.findIndex((u) => u.id === selectedUnitId);
  const next = idle[(currentIndex + 1) % idle.length]!;
  select(next.id);
  scene.focus(next.hex);
}

/**
 * Units the player still has to decide something about.
 *
 * ⚠️ **A unit with a march order is NOT awaiting orders. It has them.** Without
 * that exclusion every marching unit would keep the turn looking unfinished for
 * as long as its journey lasted, so the whole indicator would be at its least
 * trustworthy exactly when the player is using the feature that needs it most.
 */
function awaitingOrders(): readonly Unit[] {
  return unitsOf(state, mySeat).filter((u) => u.movesLeft > 0 && !u.fortified && !u.order);
}

/**
 * What is left to do this turn.
 *
 * ⚠️ **Three different kinds of unfinished, deliberately.** A turn is not only
 * about moving: an empire researching nothing is wasting every point of Compute
 * it earns, and a due review is the whole learning loop asking to be run. Both
 * are silent, both are easy to forget, and neither used to be visible anywhere
 * near the button that ends the turn.
 */
interface Pending {
  readonly units: readonly Unit[];
  readonly research: boolean;
  readonly council: boolean;
  readonly total: number;
}

function pendingWork(): Pending {
  const units = awaitingOrders();
  // Nothing to research is only a fault when there is something to research.
  const research = state.research.current === undefined && researchable(state).length > 0;
  const council = pendingReviews().length > 0;
  return {
    units,
    research,
    council,
    total: units.length + (research ? 1 : 0) + (council ? 1 : 0),
  };
}

/**
 * Do the next outstanding thing, or say there is nothing left.
 *
 * Units first, because they are the many and the other two are the one. The
 * order after that is research before council: research is a standing waste
 * while it is unset, a review is merely due.
 */
function nextAction(): void {
  const pending = pendingWork();
  if (pending.units.length > 0) {
    selectNextIdle();
    return;
  }
  if (pending.research) {
    el.resOptions.querySelector<HTMLButtonElement>('button')?.focus();
    el.resOptions.scrollIntoView({ block: 'nearest' });
    log(t('Nothing is being researched. Pick a topic.'));
    return;
  }
  if (pending.council) {
    void doCouncil();
  }
}

/**
 * Keep the turn button honest about what it is for.
 *
 * ⚠️ **One button, two jobs, and the label is the whole feature.** It used to
 * say "End turn" from the first second of a turn to the last, so the fastest
 * way to play was to press it, and the game never mentioned the four units
 * standing still or the Compute being earned against no research at all.
 *
 * Highlighted only when there is genuinely nothing left, so the highlight
 * means something. A button that glows all turn is decoration.
 */
function refreshTurnButton(): void {
  const pending = pendingWork();
  const done = pending.total === 0;
  el.endTurn.classList.toggle('ready', done);
  el.endTurn.dataset.mode = done ? 'end' : 'next';

  if (done) {
    el.endTurn.textContent = t('End turn');
    el.endTurn.title = t('Nothing left to do. Space ends the turn.');
    return;
  }
  if (pending.units.length > 0) {
    el.endTurn.textContent = t('Next unit ({n})', { n: pending.units.length });
    el.endTurn.title = t('{n} units still have something to do. Ctrl+Space ends the turn anyway.', {
      n: pending.units.length,
    });
    return;
  }
  if (pending.research) {
    el.endTurn.textContent = t('Choose research');
    el.endTurn.title = t('Compute is being earned against nothing. Ctrl+Space ends the turn anyway.');
    return;
  }
  el.endTurn.textContent = t('Council');
  el.endTurn.title = t('A review has fallen due. Ctrl+Space ends the turn anyway.');
}

/**
 * The turn button was pressed, or Space was.
 *
 * ⚠️ Reads the CURRENT pending work rather than a flag set when the label was
 * last painted. A label can be one frame stale; ending a turn by accident
 * because of it cannot be undone.
 */
function turnButtonAction(): void {
  if (pendingWork().total === 0) {
    void doEndTurn();
    return;
  }
  nextAction();
}

/**
 * Every unit the player owns, in a stable order, for the panel arrows.
 *
 * ⚠️ Stable because `state.units` is a Map and keeps insertion order, so a
 * unit does not change places in the cycle when another one is built or dies.
 * Sorting by position instead would reshuffle the whole army every time
 * anything moved, and the arrows would stop being a way to walk your line.
 */
function ownUnits(): readonly Unit[] {
  return unitsOf(state, mySeat);
}

/**
 * Step to the next or previous unit, wrapping at both ends.
 *
 * ⚠️ **Walks EVERY unit, unlike `selectNextIdle`.** Tab jumps between units
 * still awaiting orders and deliberately skips anything dug in or out of
 * moves, which is right for playing a turn quickly and wrong for looking at
 * your army: a fortified unit is exactly the one you want to check on, and if
 * the arrows skipped it you could never step away from the unit on screen and
 * come back to it.
 */
function stepUnit(delta: number): void {
  const units = ownUnits();
  if (units.length === 0) return;

  const current = units.findIndex((u) => u.id === selectedUnitId);
  /*
   * From no selection, forward starts at the first unit and back at the last,
   * rather than both landing on the same one. `current` is -1 here, and the
   * modulo below already does the right thing for +1; the guard is for -1,
   * where -2 would otherwise wrap to the second-from-last.
   */
  const from = current === -1 ? (delta > 0 ? -1 : 0) : current;
  const next = units[(from + delta + units.length * 2) % units.length]!;
  select(next.id);
  scene.focus(next.hex);
  dirty = true;
}

// Actions --------------------------------------------------------------

/**
 * Whether the player is what is standing on this tile.
 *
 * Used to decide if an incoming raid is the player's problem. With one
 * antagonist every raid is, but the moment a second faction exists they will
 * fight each other too, and the player should not be asked to defend a
 * skirmish they are not in.
 */
function defends(hex: Hex): boolean {
  const unit = unitAt(state, hex);
  if (unit) return unit.factionId === mySeat;
  return cityAt(state, hex)?.factionId === mySeat;
}

/**
 * Which topic a battle against this faction asks about.
 *
 * Each antagonist is bound to a cluster of the outline, so who is attacking
 * tells the player what they are about to be tested on. That is the whole
 * design: the opposition is a study planner wearing a helmet.
 *
 * ⚠️ **Drawn from the seed, not from `Math.random`.** It used to be random,
 * which meant two players sharing a seed (D39) fought identical battles and
 * were asked different questions, and replaying your own game asked different
 * questions too. Keying the stream on the turn and the faction keeps a given
 * battle's question fixed while still varying it from fight to fight.
 */
function battleTopicFor(defenderFactionId: string): string | undefined {
  const cluster = state.factions.get(defenderFactionId)?.topicCluster;
  if (!cluster) return undefined;
  const inCluster = state.topics.nodes.filter((n) => n.cluster === cluster);
  if (inCluster.length === 0) return undefined;
  // Prefer something already researched, so a battle revises rather than
  // testing material the player has not reached yet.
  const known = inCluster.filter((n) => state.research.known.includes(n.id));
  const pool = known.length > 0 ? known : inCluster;
  const rng = createRng(state.seed, `battle:${state.turn}:${defenderFactionId}`);
  return pool[rng.int(0, pool.length - 1)]!.id;
}

async function actOn(target: Hex): Promise<void> {
  if (modal.isOpen()) return;
  // The world on screen is a turn behind while a raid plays out.
  if (resolvingTurn) return;

  const own = selectableUnitAt(state, target);
  if (own) {
    select(own.id);
    return;
  }

  if (!selectedUnitId) return;
  const unit = state.units.get(selectedUnitId);
  if (!unit) return;

  // Attack takes priority: clicking an enemy means fighting it, not walking
  // into the tile it occupies.
  if (canAttack(state, unit.id, target).ok) {
    const defender = unitAt(state, target) ?? cityAt(state, target);
    const topicId = defender ? battleTopicFor(defender.factionId) : undefined;

    let challengeScore = 0;
    if (topicId) {
      challengeScore = await askBattle(topicId, 2, timeLimit(BATTLE_TIME_MS));
    }

    // The state can only have changed if something else ran while the modal
    // was open, but re-checking is cheap and a stale attack is a real bug.
    if (!canAttack(state, unit.id, target).ok) return;

    /*
     * How you go at a wall, asked only when there is one.
     *
     * Section 19.3 wants an assault to be a decision. Until now every blow
     * against a city was the same blow, so a wall was only a number that made
     * another number smaller.
     *
     * ⚠️ **Escalade is offered to melee only.** A ranged attacker takes no
     * counterattack at all, and escalade's entire cost *is* the counter, so a
     * Notebook Cannon could otherwise ignore the wall for free. You cannot
     * storm a parapet from a mile away.
     */
    const wallTarget = cityAt(state, target);
    let tactic: AssaultTactic = DEFAULT_TACTIC;
    if (wallTarget && wallTarget.wallLevel > 0) {
      const ranged = unitType(unit.typeId).range > 1;
      const offered = ASSAULT_TACTICS.filter((id) => id !== 'escalade' || !ranged);
      const labels: Record<AssaultTactic, { label: string; detail: string }> = {
        batter: {
          label: t('Batter the walls'),
          detail: t('Everything at the wall. Slow, and it costs you nothing.'),
        },
        escalade: {
          label: t('Escalade'),
          detail: t('Over the top. Most of the blow reaches the town itself, and the defenders make you pay for it.'),
        },
        sap: {
          label: t('Sap the walls'),
          detail: t('Under it. The fastest way through masonry, and almost no use once the breach is open.'),
        },
      };
      tactic = await choice.ask(
        t('{city}: how will you go in?', { city: wallTarget.name }),
        t('Walls level {level} still stand, and they will not fall to enthusiasm.', {
          level: String(wallTarget.wallLevel),
        }),
        offered.map((id, i) => ({
          id,
          label: labels[id].label,
          detail: labels[id].detail,
          primary: i === 0,
        })),
      );
    }

    const preview = previewAttack(state, unit.id, target, { challengeScore, tactic });
    const targetCity = cityAt(state, target);
    const dramatic = !hadFirstBattle || targetCity !== undefined;

    /*
     * Capture or raze, asked only when the blow is expected to finish it.
     *
     * ⚠️ Asked BEFORE the strike, because the engine resolves the whole fight
     * in one call and the outcome has to be part of that call. The trigger is
     * the previewed damage rather than certainty: the roll can still leave the
     * walls standing, in which case the answer simply does not apply and the
     * player is asked again next time. Asking on every blow of a long siege
     * would be worse than occasionally asking a turn early.
     */
    let cityOutcome: 'capture' | 'raze' = 'capture';
    if (
      targetCity &&
      preview &&
      !preview.ranged &&
      preview.expectedDamageToDefender >= targetCity.hp
    ) {
      const holder = state.factions.get(targetCity.factionId);
      cityOutcome = await choice.ask(
        `${targetCity.name} is about to fall`,
        `${holder?.label ?? 'The defenders'} hold this place, and they hold what they know with it. Take it and their ground becomes yours to study. Burn it and you leave with the spoils and nothing else.`,
        [
          {
            id: 'capture' as const,
            label: 'Take the village',
            detail: 'Opens their branch of the exam to you, and adds the settlement to your empire.',
            primary: true,
          },
          {
            id: 'raze' as const,
            label: 'Burn it',
            detail: 'A far larger haul of Data, Compute and Capacity. You learn nothing, and only ruins remain.',
          },
        ],
      );
    }

    if (!hadFirstBattle) {
      // Before the blow, not after it. The shot is the establishing beat and
      // it has nothing to establish once the fight is already resolved.
      const here = scene.groundAt(unit.hex);
      const there = scene.groundAt(target);
      const midpoint = here.clone().add(there).multiplyScalar(0.5);
      await playOnce(
        approachShot({
          id: 'first-blood',
          title: 'First blood',
          subtitle: 'What you know is what you bring to the field',
          focus: midpoint,
          // Come in across the line between them, so both are in frame.
          from: new Vector3(there.z - here.z, 0, here.x - there.x),
          startDistance: 26,
          endDistance: 7,
          startHeight: 14,
          endHeight: 2.6,
        }),
      );
    }
    hadFirstBattle = true;

    await playAttack(unit.id, target, challengeScore, preview, dramatic, cityOutcome, tactic);
    return;
  }

  const from = unit.hex;
  const beforeExplored = memoryOf(state, mySeat).explored;
  const moved = moveUnit(state, unit.id, target);
  if (!moved.ok) {
    /*
     * Out of range this turn is an ORDER, not an error.
     *
     * ⚠️ This is the whole feature, and it hangs off the failure path on
     * purpose. Clicking a distant hex already meant "go there"; the game just
     * said no and made the player click again every turn, which is worst for
     * the Profiler, whose entire job is to be somewhere else. Anything genuinely
     * impossible, off the map, in the sea, has no path either and still reports
     * the original reason.
     */
    const plan = planMarch(state, unit, target);
    if (plan) {
      state = setMarch(state, unit.id, target);
      const turns = plan.legs.length;
      log(
        t('{unit} sets out. {n} turns away.', {
          unit: t(unitType(unit.typeId).label),
          n: String(turns),
        }),
      );
      refreshSelection();
      dirty = true;
      return;
    }
    log(moved.reason, 'bad');
    return;
  }
  /*
   * ⚠️ A hand-driven move cancels the standing order. The player has just said
   * where they want this unit, and quietly resuming a march to somewhere else
   * next turn would be the game overruling them.
   */
  state = clearMarch(moved.state, unit.id);
  const landed = state.units.get(unit.id);
  if (landed && (landed.hex.q !== from.q || landed.hex.r !== from.r)) {
    const route = moved.path ?? [landed.hex];
    /*
     * ⚠️ The dig waits for the walk, and is chained rather than awaited.
     *
     * Awaiting here would freeze the interface for the length of the march
     * before anything happened, which is the behaviour section 83 removed.
     * Chaining keeps the walk fire-and-forget and still guarantees the
     * question arrives after the unit has visibly got there: asking while the
     * Profiler is halfway across the map would be asking about a tile it is
     * not standing on yet.
     */
    void walk(unit.id, from, route, beforeExplored).then(() => digAlong(unit.id, route));
  }
  refreshSelection();
  dirty = true;
}

/**
 * Walk a unit along its route, uncovering ground as it arrives rather than
 * when the turn ends.
 *
 * ⚠️ **The engine has already finished the move.** `state` holds the unit at
 * its destination with the whole corridor explored, which is correct for the
 * rules and wrong for the eye: it would open six hexes at once while the unit
 * is still at the near end. So this walks the same path the rules walked and
 * hands the fog a view of the world as of each step.
 *
 * Deliberately NOT awaited by the caller. The player can select and order
 * another unit while this one is still walking, which is how the game already
 * behaved and is worth keeping: a march across the map should not lock the
 * interface for a second and a half.
 */
async function walk(
  unitId: string,
  from: Hex,
  path: readonly Hex[],
  beforeExplored: ReadonlySet<string>,
): Promise<void> {
  const shown = new Set(beforeExplored);
  let previous = from;

  try {
    for (const step of path) {
      await effects.travel(unitId, previous, step, STEP_MS);
      previous = step;

      /*
       * What the player would see standing here. The unit is at its final hex
       * in `state`, so it is moved back for the question and nothing is
       * written: this is a view of the world, not a change to it.
       */
      const here = state.units.get(unitId);
      if (!here) break;
      const units = new Map(state.units);
      units.set(unitId, { ...here, hex: step });
      const sight = sightOf({ ...state, units }, mySeat);
      for (const key of sight) shown.add(key);

      walkReveal = { explored: shown, sight };
      refreshFog();
    }
  } finally {
    /*
     * Back to the truth, whatever happened. A walk interrupted by a new game
     * or by the unit dying must not leave the fog frozen at a half-finished
     * march.
     */
    walkReveal = undefined;
    refreshFog();
  }
}

/**
 * Open a chest the Profiler walked over, if it found one.
 *
 * ⚠️ **The whole route is searched, not just the tile it stopped on.** Ordering
 * a six-hex march that happens to cross a chest and being told nothing would
 * read as the feature being broken, and the player has no way to know a chest
 * was there: they are marching into fog. The first one on the route is dug up
 * and the unit still ends where it was sent, so the order the player gave is
 * never quietly rewritten.
 *
 * ⚠️ **Only the Profiler.** The scout's entire identity was a sight radius,
 * which is a passive virtue: build one, park it on a hill, forget it. This is
 * the one job that turns exploring into something the empire can spend.
 */
async function digAlong(unitId: string, route: readonly Hex[]): Promise<void> {
  const unit = state.units.get(unitId);
  if (!unit || unit.typeId !== 'profiler') return;
  if (finished || modal.isOpen()) return;

  let found: Treasure | undefined;
  for (const step of route) {
    const here = treasureAt(state.treasures, step);
    if (here) {
      found = here;
      break;
    }
  }
  if (!found) return;

  const chest = found;
  log(t('The Profiler turns up a buried cache.'), 'good');
  scene.focus(chest.hex);
  /*
   * ⚠️ The cue is played HERE, not inside the film player, because the film
   * is optional and the sound is not. 	reasureFilm degrades to nothing when
   * the clip is missing (a clone with no media, the public build), and that is
   * exactly the case where the sound is carrying the whole moment.
   */
  cues.play('treasure-found');
  await treasureFilm.play('found');

  /*
   * ⚠️ A real question through the provider, not a coin flip.
   *
   * Which means the answer feeds the spaced-repetition schedule exactly as a
   * battle or a research question does. That is the point: the chest exists to
   * make the map ask something, and a reward for knowing is worth nothing if
   * the knowing is not recorded.
   */
  const topic = state.research.current ?? state.topics.nodes[0]?.id;
  if (!topic) return;
  const outcome = await provider.present({
    kind: 'treasure',
    topicId: topic,
    tier: 1,
    timeLimitMs: timeLimit(RESEARCH_TIME_MS),
  });

  const claim = claimTreasure(chest, outcome.score >= 0);
  const treasures = new Map(state.treasures);
  if (claim.remaining) treasures.set(chest.id, claim.remaining);
  else treasures.delete(chest.id);
  state = { ...state, treasures };

  if (claim.gained > 0) {
    state = grantResource(state, claim.resource, claim.gained);
    log(
      t('The cache opens: {amount} {resource}.', {
        amount: claim.gained,
        resource: resourceLabel(claim.resource),
      }),
      'good',
    );
    effects.floatingText(chest.hex, `+${claim.gained}`, '#ffd166', 1.4);
    cues.play('treasure-opened');
    await treasureFilm.play('opened');
  } else if (claim.remaining) {
    // Say what it cost, or the shrinking is invisible and reads as a bug.
    log(
      t('The lock holds. {amount} {resource} left inside.', {
        amount: claim.remaining.amount,
        resource: resourceLabel(claim.resource),
      }),
      'bad',
    );
  } else {
    log(t('The lock holds, and the cache is picked clean.'), 'bad');
  }

  /*
   * ⚠️ A failed dig ends the Profiler's turn, and that is the real cost.
   *
   * The halving alone is not a brake: the same unit could stand on the chest
   * and answer again immediately, and again, so the optimal play would be to
   * grind every cache until a right answer arrived and the question would be
   * decorative. Spending the march makes a wrong answer cost tempo, which is
   * the currency this game is actually short of, while never costing the
   * chest itself. Retrying stays possible, as decided, just not free.
   */
  if (claim.gained === 0) {
    const digger = state.units.get(unitId);
    if (digger && digger.movesLeft > 0) {
      const units = new Map(state.units);
      units.set(unitId, { ...digger, movesLeft: 0 });
      state = { ...state, units };
    }
  }

  refreshHud();
  refreshSelection();
  dirty = true;
}

/** Add to the player's stores, without going through a whole turn. */
function grantResource(current: GameState, resource: ResourceId, amount: number): GameState {
  const factions = new Map(current.factions);
  const player = factions.get(mySeat);
  if (!player) return current;
  factions.set(mySeat, {
    ...player,
    resources: { ...player.resources, [resource]: player.resources[resource] + amount },
  });
  return { ...current, factions };
}

/**
 * ⚠️ Resource names are NOT translated: Data, Compute, CU and Trust are the
 * product's own words and a German Fabric user says them in English, which is
 * the same rule the unit names follow.
 */
function resourceLabel(resource: ResourceId): string {
  return resource === 'cu' ? 'CU' : resource[0]!.toUpperCase() + resource.slice(1);
}

/**
 * Run a battle as an animation rather than as a state change.
 *
 * The engine resolves the fight instantly; the point of this function is that
 * the player sees the strike, the damage and the consequence in that order.
 * Damage is applied at the moment of impact, not before, because a health bar
 * that empties while the attacker is still winding up reads as a bug.
 */
async function playAttack(
  unitId: string,
  target: Hex,
  challengeScore: number,
  preview: ReturnType<typeof previewAttack>,
  dramatic: boolean,
  cityOutcome: 'capture' | 'raze' = 'capture',
  tactic: AssaultTactic = DEFAULT_TACTIC,
): Promise<void> {
  const attacker = state.units.get(unitId);
  if (!attacker) return;

  const ranged = preview?.ranged ?? !isAdjacent(attacker.hex, target);
  const defenderUnit = unitAt(state, target);
  const defenderCity = cityAt(state, target);
  const defenderColour =
    state.factions.get((defenderUnit ?? defenderCity)?.factionId ?? '')?.colour ?? '#b5533f';
  const attackerColour = state.factions.get(attacker.factionId)?.colour ?? '#4a9fe0';

  const hpBefore = {
    attacker: attacker.hp,
    defender: defenderUnit?.hp ?? defenderCity?.hp ?? 0,
  };

  // The engine has already decided the result; resolving it here and handing
  // the numbers to the choreography means the animation can be as long or as
  // short as it likes without the rules caring. The state change is held back
  // until the moment of impact so a health bar never empties during a wind-up.
  const outcome = resolveAttack(state, unitId, target, {
    challengeScore,
    cityOutcome,
    // ⚠️ Must match the tactic the preview was taken with, or the odds the
    // player was shown are not the odds they fought.
    tactic,
  });
  if (!outcome.ok) {
    log(outcome.reason, 'bad');
    return;
  }
  const nextState = outcome.result.state;
  const { log: battle } = outcome.result;

  /*
   * A town gets a siege; a unit in a field gets a duel.
   *
   * ⚠️ Keyed on there being a CITY on the tile, not on `targetKind`. A
   * garrison standing in its own town makes `targetKind` 'unit', and staging
   * that as two machines meeting in the open would put the fight outside the
   * walls that are visibly right there.
   */
  const onImpact = (): void => {
    state = nextState;
    dirty = true;

    /*
     * The blow makes a noise.
     *
     * ⚠️ Fired on IMPACT rather than when the attack was ordered, so the sound
     * lands with the animation instead of a second before it. A ranged shot
     * gets a thinner sting than a melee hit, and a wall coming down gets the
     * heaviest one in the game, because those are three different events and
     * the ear can tell them apart faster than the eye can.
     */
    if (battle.wallBroken) cues.play('breach');
    else cues.play(unitType(attacker.typeId).range > 1 ? 'volley' : 'clash');

    // Damage numbers stay on the 2D layer: text is crisper drawn flat
    // than projected, and it needs to stay legible at every distance.
    if (battle.damageToDefender > 0) {
      effects.floatingText(
        target,
        `-${battle.damageToDefender}`,
        '#ffcf7a',
        dramatic ? 1.4 : 1.1,
      );
    }
    if (battle.damageToAttacker > 0) {
      effects.floatingText(
        attacker.hex,
        `-${battle.damageToAttacker}`,
        '#ff9b91',
        dramatic ? 1.2 : 1,
      );
    }
    if (battle.cityCaptured) {
      effects.floatingText(target, 'CAPTURED', '#8fd694', 1.5);
    }
    if (battle.cityRazed) {
      effects.floatingText(target, 'RAZED', '#ff9b91', 1.5);
    }
  };
  const shake = (magnitude: number): void => effects.shake(magnitude);

  if (defenderCity) {
    await playSiegeFramed(
      scene,
      {
        attackerId: unitId,
        attackerHex: attacker.hex,
        attackerColour,
        cityHex: target,
        defenderColour,
        wallLevel: defenderCity.wallLevel,
      },
      {
        damageToDefender: battle.damageToDefender,
        damageToAttacker: battle.damageToAttacker,
        breached: battle.wallBroken,
        taken: battle.cityCaptured || battle.cityRazed,
        attackerDestroyed: battle.attackerDestroyed,
        tactic: battle.tactic,
        stance: battle.stance,
      },
      { onImpact, shake },
    );
  } else {
    await playDuel(
      scene,
      {
      attackerId: unitId,
      attackerHex: attacker.hex,
      attackerColour,
      defenderId: defenderUnit?.id,
      defenderHex: target,
      defenderColour,
    },
      {
        damageToDefender: battle.damageToDefender,
        damageToAttacker: battle.damageToAttacker,
        defenderDestroyed: battle.defenderDestroyed,
        attackerDestroyed: battle.attackerDestroyed,
        ranged,
        dramatic,
      },
      { onImpact, shake },
    );
  }

  // Belt and braces: if the impact hook somehow did not run, the result must
  // still be applied. A silently skipped state change would be a real bug.
  if (state !== nextState) {
    state = nextState;
    dirty = true;
  }

  if (preview) {
    // The engine reports the answer's contribution separately, which is the
    // whole reason the banner can show it as its own bar segment instead of
    // quietly folding it into a total the player has to take on trust.
    const attackerType = unitType(attacker.typeId);
    const attackerSide: BattleSide = {
      label: attackerType.label,
      colour: attackerColour,
      base: preview.attacker.effective - preview.attacker.challengeModifier,
      modifier: preview.attacker.challengeModifier,
      effective: preview.attacker.effective,
      hpBefore: hpBefore.attacker,
      hpAfter: state.units.get(unitId)?.hp ?? 0,
      maxHp: attackerType.maxHp,
    };
    const defenderLabel = defenderCity
      ? defenderCity.name
      : defenderUnit
        ? unitType(defenderUnit.typeId).label
        : 'Defender';
    const defenderSide: BattleSide = {
      label: defenderLabel,
      colour: defenderColour,
      base: preview.defender.effective - preview.defender.challengeModifier,
      modifier: preview.defender.challengeModifier,
      effective: preview.defender.effective,
      hpBefore: hpBefore.defender,
      hpAfter: Math.max(0, hpBefore.defender - battle.damageToDefender),
      maxHp: Math.max(1, hpBefore.defender),
    };
    banner.show({
      attacker: attackerSide,
      defender: defenderSide,
      damageToDefender: battle.damageToDefender,
      damageToAttacker: battle.damageToAttacker,
      defenderDestroyed: battle.defenderDestroyed,
      attackerDestroyed: battle.attackerDestroyed,
      cityCaptured: battle.cityCaptured,
      ranged,
    });
  }

  if (challengeScore > 0) {
    log(t('Your answer strengthened the attack.'), 'good');
  } else if (challengeScore < 0) {
    log(t('Your answer weakened the attack.'), 'bad');
  }
  const odds = preview
    ? ` (${Math.round(preview.attacker.effective)} vs ${Math.round(preview.defender.effective)})`
    : '';
  log(
    `Attack${odds}: dealt ${battle.damageToDefender}, took ${battle.damageToAttacker}`,
    battle.damageToDefender >= battle.damageToAttacker ? 'good' : 'bad',
  );
  if (battle.defenderDestroyed) log(t('Enemy unit destroyed.'), 'good');
  if (battle.attackerDestroyed) log(t('Your unit was destroyed.'), 'bad');
  if (battle.cityCaptured) {
    const from = battle.cityFormerFactionId
      ? state.factions.get(battle.cityFormerFactionId)?.label
      : undefined;
    log(
    from
      ? t('{city} taken from {from}.', { city: defenderCity?.name ?? t('The village'), from })
      : t('{city} taken.', { city: defenderCity?.name ?? t('The village') }),
    'good',
  );
    if (battle.clusterOpened) {
      // The point of capturing rather than burning, said out loud.
      const topic = topicById(state.topics, battle.clusterOpened);
      log(
        `Their ground is yours to study: ${topic?.label ?? battle.clusterOpened} is now known.`,
        'good',
      );
    }
    void playCityFallsShot(target);
  }
  if (battle.cityRazed) {
    const from = battle.cityFormerFactionId
      ? state.factions.get(battle.cityFormerFactionId)?.label
      : undefined;
    log(
      `${defenderCity?.name ?? 'The village'} burned${from ? `, ${from} scattered` : ''}.`,
      'good',
    );
    if (battle.loot) {
      const parts = Object.entries(battle.loot)
        .filter(([, amount]) => (amount ?? 0) > 0)
        .map(([id, amount]) => `${amount} ${id}`);
      if (parts.length > 0) log(t('Carried off {spoils}.', { spoils: parts.join(', ') }), 'good');
    }
    log(t('Nothing was learned there.'), 'bad');
    void playCityFallsShot(target);
  }

  refreshCorruption();
  refreshFog();
  refreshCities();
  refreshReadiness();
  refreshThreats();
  refreshSelection();
  dirty = true;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * A city changing hands, in either direction.
 *
 * One shot for both cases on purpose. Whether the walls that just fell were
 * yours or theirs, it is the same event in the world and the same thing worth
 * looking at; the subtitle carries the difference.
 */
function playCityFallsShot(hex: Hex): Promise<void> {
  const city = cityAt(state, hex);
  const mine = city?.factionId === mySeat;
  return playOnce(
    descendShot({
      id: 'city-falls',
      title: 'The walls change hands',
      subtitle: mine
        ? `${city?.name ?? 'A city'} is yours now`
        : `${city?.name ?? 'A city'} has been taken from you`,
      centre: scene.groundAt(hex),
      startHeight: 34,
      endHeight: 6,
      radius: 20,
      sweepRad: 0.8,
      durationMs: 4400,
    }),
  );
}

function isAdjacent(a: Hex, b: Hex): boolean {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2 === 1;
}

/**
 * Pick the topics a founding asks about.
 *
 * ⚠️ **Due topics first, and that is the whole point of asking here.** Founding
 * is a natural pause in a turn, so it is the cheapest moment in the game to
 * make somebody retrieve something they learned twenty turns ago. Asking about
 * whatever is currently being researched would be easier and would test the
 * thing already freshest in mind, which is the one thing spaced repetition says
 * not to do.
 *
 * Falls back to current research and then to the graph, so a brand new empire
 * with nothing due still gets three questions rather than silently getting a
 * free city.
 */
function settleTopics(count: number): string[] {
  const picked: string[] = [];
  const add = (id: string | undefined): void => {
    if (id && !picked.includes(id) && picked.length < count) picked.push(id);
  };

  for (const id of provider.dueTopics(Date.now())) add(id);
  add(state.research.current);
  for (const node of state.topics.nodes) add(node.id);
  return picked;
}

/**
 * The map offers you something, and you decide whether to bother.
 *
 * ⚠️ **The point of this is that it is declinable.** Every other question in
 * the game happens TO the player: a raid arrives and you are asked, a topic
 * falls due and you are asked. Those are all good reasons to be asked and none
 * of them was ever chosen. A fortune is the one that is.
 *
 * ⚠️ **Answering can only help, so declining is never the safe play, it is the
 * quick one.** Walking away and getting it wrong land in exactly the same
 * place, which is what makes it safe to attempt a question you are unsure of.
 * The cost of saying yes is attention and nothing else.
 */
async function offerFortune(): Promise<void> {
  if (finished || modal.isOpen() || choice.open()) return;

  const offer = rollFortune(state, createRng(state.seed, `fortune:${state.turn}`), mySeat);
  if (!offer) return;

  const unit = state.units.get(offer.unitId);
  if (!unit) return;
  const who = t(unitType(unit.typeId).label);
  scene.focus(offer.hex);

  const gold = offer.kind === 'gold';
  const title = gold
    ? t('{unit} finds something in the ground.', { unit: who })
    : t('{unit} is bogged down.', { unit: who });
  const body = gold
    ? t('Answer one question and it is yours. Walk on and it stays buried. Getting it wrong costs nothing.')
    : t('Answer one question and it walks out today. Decline and it goes nowhere this turn. Getting it wrong costs nothing extra.');

  const TRY = 'try';
  const picked = await choice.ask(title, body, [
    {
      id: TRY,
      label: gold
        ? t('Dig for {amount} {resource}', {
            amount: String(offer.amount),
            resource: t(resourceLabel(offer.resource)),
          })
        : t('Work it free'),
      detail: t('One question. There is no penalty for missing it.'),
      primary: true,
    },
    { id: 'walk', label: t('Walk on'), detail: t('Lose nothing but the chance.') },
  ]);

  let score: number | undefined;
  if (picked === TRY) {
    const topic = settleTopics(1)[0];
    if (topic) {
      const outcome = await provider.present({
        kind: 'settle',
        topicId: topic,
        tier: 1,
        timeLimitMs: timeLimit(RESEARCH_TIME_MS),
      });
      // ⚠️ An abandoned modal is a refusal, not a wrong answer. They reach the
      // same outcome today, and encoding one as the other is how a refusal
      // eventually starts costing something.
      if (!outcome.abandoned) score = outcome.score;
    }
  }

  const won = score !== undefined && fortuneTaken(score);
  state = applyFortune(state, offer, score);

  if (gold) {
    if (won) {
      log(
        t('{amount} {resource} out of the dirt.', {
          amount: String(offer.amount),
          resource: t(resourceLabel(offer.resource)),
        }),
        'good',
      );
      effects.floatingText(offer.hex, `+${offer.amount}`, '#ffd479', 1.3);
      cues.play('windfall');
    } else {
      log(t('Whatever was down there stays down there.'));
    }
  } else if (won) {
    log(t('{unit} finds firm ground and marches on.', { unit: who }), 'good');
  } else {
    log(t('{unit} spends the day in the mud.', { unit: who }));
    effects.pulse(offer.hex, '#8a7f6a', 2);
  }

  refreshHud();
  refreshCities();
  dirty = true;
}

/**
 * Found a city, which is three questions and then a town.
 *
 * ⚠️ **The site is validated BEFORE anything is asked.** Asking three questions
 * and then saying "too close to another city" would waste the one thing the
 * game is actually spending: the player's attention.
 *
 * ⚠️ **Walking out cancels the founding; getting it wrong does not.** Those are
 * different failures. Closing the modal is a decision not to do this now, and
 * the Architect should still be standing there afterwards. Answering badly is a
 * decision to build anyway, and it costs the head start rather than the town,
 * because `settlingBonus` never goes below zero.
 */
async function doFound(): Promise<void> {
  if (!selectedUnitId) return;
  if (modal.isOpen()) return;

  /*
   * A dry run purely to check the site. `foundCity` is pure, so the state it
   * returns here is discarded and the real call happens below with the score.
   * Duplicating its checks in the app is the alternative, and a second copy of
   * "can you settle here" is a second copy that can disagree.
   */
  const check = foundCity(state, selectedUnitId);
  if (!check.ok) {
    log(check.reason, 'bad');
    return;
  }

  const architect = selectedUnitId;
  const topics = settleTopics(SETTLE_QUESTIONS);
  log(t('Site surveyed. Answer three, and build well.'));

  let total = 0;
  for (const topicId of topics) {
    const outcome = await provider.present({
      kind: 'settle',
      topicId,
      tier: 1,
      timeLimitMs: timeLimit(RESEARCH_TIME_MS),
    });
    if (outcome.abandoned) {
      log(t('The Architect puts the plans away. Nothing is built.'));
      return;
    }
    total += outcome.score;
  }
  const score = topics.length > 0 ? total / topics.length : 0;

  /*
   * ⚠️ Re-checked, because three questions is long enough for the world to
   * have moved. The modal blocks the map, but a raid resolving underneath it
   * could have taken the ground or killed the Architect.
   */
  const result = foundCity(state, architect, { challengeScore: score });
  if (!result.ok) {
    log(result.reason, 'bad');
    return;
  }
  state = result.state;
  const city = [...state.cities.values()].at(-1);
  log(t('Founded {city}.', { city: city?.name ?? t('a city') }), 'good');

  const bonus = settlingBonus(score);
  if (city) {
    if (bonus >= 2) {
      log(
        t('Your judgement holds. The weather turns fair and {city} is already growing.', {
          city: city.name,
        }),
        'good',
      );
    } else if (bonus === 1) {
      log(
        t('Sound ground, sound plans. {city} starts with a second household.', {
          city: city.name,
        }),
        'good',
      );
    } else {
      log(
        t('The plans were guesswork. {city} starts from nothing, as most towns do.', {
          city: city.name,
        }),
      );
    }
    effects.pulse(city.hex, '#8fd694', 3);
    effects.floatingText(city.hex, city.name, '#cfe6ff', 1.2);
    if (bonus > 0) effects.floatingText(city.hex, `+${bonus}`, '#8fd694', 1.3);
    /*
     * ⚠️ Only when the `first-city` film is NOT about to play, or the sting and
     * the cue land on top of each other. `playOnce` fires a cinematic at most
     * once per game, so without this every founding after the first would be
     * the silent one.
     */
    if (seenCinematics.has('first-city')) cues.play('settle');
    void playOnce(
      orbitShot({
        id: 'first-city',
        title: 'The first workspace',
        subtitle: `${city.name} stands where nothing stood`,
        centre: scene.groundAt(city.hex),
        radius: 13,
        fromHeight: 3.4,
        toHeight: 9,
        sweepRad: Math.PI * 0.75,
        startAngleRad: Math.PI * 0.25,
        durationMs: 5000,
      }),
    );
  }
  refreshCorruption();
  refreshFog();
  refreshCities();
  refreshReadiness();
  refreshThreats();
  select(undefined);
}

/**
 * Dig in, or stand down again.
 *
 * ⚠️ **One button, both directions.** It used to fortify and then disable
 * itself, which said "there is no way back" to anybody reading the interface,
 * and for a long time that was accurate: a fortified unit was stranded for the
 * rest of the game. Ordering it to move wakes it too, and that is the first
 * thing a 4X player tries, but an action that has visibly greyed itself out is
 * not an invitation to try anything.
 */
function doFortify(): void {
  if (!selectedUnitId) return;
  const unit = state.units.get(selectedUnitId);
  if (!unit) return;
  const result = unit.fortified
    ? wakeUnit(state, selectedUnitId)
    : fortifyUnit(state, selectedUnitId);
  if (!result.ok) {
    log(result.reason, 'bad');
    return;
  }
  state = result.state;
  refreshSelection();
  dirty = true;
}

function doSkip(): void {
  if (!selectedUnitId) return;
  const result = skipUnit(state, selectedUnitId);
  if (!result.ok) return;
  state = result.state;
  selectNextIdle();
}

/**
 * Call off a march.
 *
 * ⚠️ **Cancelling is NOT the same as skipping, and conflating them would be the
 * obvious mistake.** The unit keeps whatever movement it has left and can be
 * sent somewhere else on this turn: the player is withdrawing a standing
 * instruction, not giving up the turn. Spending the moves would punish somebody
 * for correcting a misclick.
 *
 * The dotted route disappears with the order, because `refreshSelection`
 * recomputes the overlay from `unit.order` and there is no longer one to draw.
 */
function doStand(): void {
  if (!selectedUnitId) return;
  const unit = state.units.get(selectedUnitId);
  if (!unit?.order) return;
  state = clearMarch(state, selectedUnitId);
  log(t('{unit} stands and awaits orders.', { unit: t(unitType(unit.typeId).label) }));
  refreshSelection();
  dirty = true;
}

/**
 * Refresh the council button.
 *
 * Cheap enough to call on every state change: the due list is a filter over a
 * handful of records and the opportunity list a filter over the cities.
 */
function pendingReviews(): ReturnType<typeof reviewOpportunities> {
  return reviewOpportunities(state, provider.dueTopics(Date.now()));
}

function refreshCouncil(): void {
  const available = pendingReviews();
  el.actCouncil.disabled = available.length === 0;
  // ⚠️ Rewritten on every state change, so the `data-i18n` tag on the markup
  // is overwritten within a frame of the language switching. Anything set from
  // code has to be translated in code.
  el.actCouncil.textContent =
    available.length > 1
      ? t('Council ({n})', { n: available.length })
      : t('Council');
}

/**
 * Hold a council review.
 *
 * The whole learning loop in one action: a topic the player learned a while
 * ago has fallen due, the city that holds it asks about it again, and getting
 * it right pays. Retrieval practice with a reason to want it.
 */
async function doCouncil(): Promise<void> {
  if (modal.isOpen()) return;
  const available = pendingReviews();
  const next = available[0];
  if (!next) return;

  const city = state.cities.get(next.cityId);
  if (city) scene.focus(city.hex);

  const outcome = await provider.present({
    kind: 'unrest',
    topicId: next.topicId,
    tier: 2,
    timeLimitMs: timeLimit(RESEARCH_TIME_MS),
  });

  const result = resolveReview(state, next.cityId, next.topicId, outcome.score);
  if (!result.ok) {
    log(result.reason, 'bad');
    return;
  }
  state = result.state;

  const node = topicById(state.topics, next.topicId);
  const label = node?.label ?? next.topicId;
  if (outcome.score >= 0) {
    log(t('{city} recalled {topic}. +{trust} Trust.', {
      city: next.cityName,
      topic: label,
      trust: result.trustGained,
    }), 'good');
  } else {
    log(t('{city} could not recall {topic}. It will come round again.', {
      city: next.cityName,
      topic: label,
    }), 'bad');
  }

  refreshSelection();
  refreshHud();
  dirty = true;
}

/**
 * End the turn, defending yourself if anyone is coming.
 *
 * ⚠️ **The turn is played twice, and that is the design, not an accident.**
 * `endTurn` is a pure function, so running it once on a throwaway copy costs
 * nothing but the work and answers the one question that has to be answered
 * *before* the fight: is anybody about to raid me, and who. Only then can the
 * player be asked the question that decides how well they hold.
 *
 * The alternative was to make the engine's AI loop async so it could stop and
 * ask mid-turn. That would have put a promise, and therefore the app, inside
 * the rules (D35), to buy a look-ahead that a pure function already gives away
 * for free.
 *
 * The two runs agree on whether a raid happens, because nothing about the
 * decision to attack depends on the defender's answer. They disagree on the
 * damage, which is exactly the point.
 */
async function doEndTurn(): Promise<void> {
  // A finished game has nothing left to resolve. The button is disabled too,
  // but the keyboard and the debug hook both reach this directly.
  if (finished) return;
  const dueTopics = provider.dueTopics(Date.now());

  const preview = endTurn(state, { dueTopics });
  const raids = preview.report.enemyEvents.filter(
    (e) => e.intent.kind === 'raid' && defends(e.intent.target),
  );
  /*
   * ⚠️ A raid on a town outranks a raid on anything else.
   *
   * The turn choreographs exactly one incoming attack: the camera flies to it,
   * the banner names the faction, and the question is asked about it. Taking
   * the first one in the list meant a lone scout being jumped could be shown
   * while a city was being stormed in the same turn and never mentioned. A
   * city is permanent, expensive and the thing the player actually loses the
   * game over, so it is the fight worth showing.
   *
   * `find` rather than a sort: the list order is otherwise meaningful (it is
   * the order the enemy acted) and only the town needs to jump the queue.
   */
  const incoming =
    raids.find((e) => e.intent.kind === 'raid' && cityAt(state, e.intent.target)) ?? raids[0];

  let defenderChallengeScore = 0;
  let defenceStance: DefenceStance = DEFAULT_STANCE;
  if (incoming && incoming.intent.kind === 'raid') {
    const who = state.factions.get(incoming.factionId)?.label ?? 'The enemy';
    const topicId = battleTopicFor(incoming.factionId);
    const target = incoming.intent.target;

    /*
     * ⚠️ **Show the attack before asking about it.**
     *
     * This used to open the question immediately, with a line in the log as
     * the only clue. Being asked to defend against an attack you have not been
     * shown is indistinguishable from being quizzed at random, which throws
     * away the whole point of the faction system: who is marching on you is
     * supposed to tell you what you are about to be tested on.
     *
     * So the camera goes to the threatened tile, it is marked in the
     * attacker's colour, and the banner names the faction and the topic. Only
     * then does the modal open, and the banner stays up behind it.
     */
    const colour = state.factions.get(incoming.factionId)?.colour ?? '#b5533f';
    const defender = unitAt(state, target);
    const city = cityAt(state, target);
    /*
     * ⚠️ Translated, because it is spliced into translated sentences.
     *
     * This was `your ${label}`, built in English and then dropped into both
     * the raid banner and the stance question. In a German game it read "Das
     * Ziel ist your Profiler": the outer sentence translated, the piece inside
     * it did not. The possessive is gone rather than translated, because
     * "dein" and "deine" depend on a gender the unit table does not carry.
     */
    const what = city
      ? city.name
      : defender
        ? t(unitType(defender.typeId).label)
        : t('your border');

    log(t('{who} is at your gates. Hold them.', { who }), 'bad');
    scene.focus(target);
    effects.flash(target, colour, 900);
    effects.pulse(target, colour, 1.6);
    effects.floatingText(target, 'UNDER ATTACK', colour, 1.3);

    raidAlert.show({
      faction: who,
      colour,
      target: what,
      topic: topicId ? topicById(state.topics, topicId)?.label : undefined,
      alsoComing: raids.length - 1,
    });

    // Long enough to read the banner and see where the camera went. Short
    // enough that it never becomes the thing standing between turns.
    await wait(1500);

    /*
     * How the player meets it (19.4, D143).
     *
     * ⚠️ **Asked before the question, not after.** The question decides how
     * well the defence goes; the stance decides what kind of defence it is,
     * and being asked to commit after already knowing the answer would turn a
     * decision into a formality.
     *
     * ⚠️ **Only for a town, and this reverses an earlier decision.** It used
     * to be asked on every raid, reasoning that "a defender always has a
     * choice" even in the open. In play that was wrong twice over. Sally and
     * hold are written in the language of a gate and a wall, so on a scout
     * caught in a field the words describe something that is not there; and
     * the whole point of the stance is trading away fortification you paid
     * for, which a unit standing in grass has not got. Three options where two
     * are nearly identical is a menu, not a decision.
     *
     * Everything that is not a town now defends as it always did before the
     * stance existed, which is `hold`: a no-op on every number in combat.
     */
    const stanceLabels: Record<DefenceStance, { label: string; detail: string }> = {
      hold: {
        label: t('Hold the line'),
        detail: t('Stand behind what you built. Nothing is risked and nothing is gained.'),
      },
      sally: {
        label: t('Sally out'),
        detail: t('Open the gates. Your cover counts for nothing, and you hit back far harder.'),
      },
      brace: {
        label: t('Brace'),
        detail: t('Everything into cover. Much harder to hurt, and you do not hit back at all.'),
      },
    };
    if (city) {
      defenceStance = await choice.ask(
        t('{who} is at your gates. How do you meet them?', { who }),
        t('The target is {what}.', { what }),
        DEFENCE_STANCES.map((id, i) => ({
          id,
          label: stanceLabels[id].label,
          detail: stanceLabels[id].detail,
          primary: i === 0,
        })),
      );
    }

    if (topicId) {
      defenderChallengeScore = await askBattle(topicId, 2, timeLimit(BATTLE_TIME_MS));
    }
    raidAlert.hide();
  }

  const result = endTurn(state, {
    dueTopics,
    defenderChallengeScore,
    defenceStance,
    /*
     * ⚠️ Both of the above count ONLY here, on the tile that was shown.
     *
     * They used to be handed to the whole enemy phase, so one answer stiffened
     * every unrelated fight on the map and one stance was adopted by units
     * that were never in the battle the player watched.
     */
    defendAt: incoming?.intent.kind === 'raid' ? incoming.intent.target : undefined,
  });
  const { report } = result;
  /*
   * ⚠️ **The result is held back until the raid has been watched.**
   *
   * `state` stays the pre-turn world for the next few lines so the first raid
   * can be choreographed like any other fight: both units still exist, still
   * stand where they stood, and the blow lands on screen at the moment the
   * damage is applied. Adopting the result here instead, as this used to,
   * meant the defender was already gone before anything could be drawn, which
   * is why enemy raids only ever got a camera shake and a number.
   *
   * The log lines below are safe on the old state: they read the report, and
   * city names, which are the same in both.
   */
  const nextState = result.state;
  const adoptResult = (): void => {
    state = nextState;
    dirty = true;
  };

  const gains: string[] = [];
  if (report.treasuryGained.compute) gains.push(`+${report.treasuryGained.compute} Compute`);
  if (report.treasuryGained.cu) gains.push(`${report.treasuryGained.cu >= 0 ? '+' : ''}${report.treasuryGained.cu} CU`);
  if (report.treasuryGained.trust) gains.push(`+${report.treasuryGained.trust} Trust`);

  log(t('Turn {n} ended. {gains}', { n: report.turn, gains: gains.join('  ') || t('No income yet.') }));
  for (const cityId of report.grownCities) {
    log(t('{name} grew.', { name: state.cities.get(cityId)?.name ?? t('A city') }), 'good');
  }

  /*
   * Settlements rise here, after the citizens have been counted.
   *
   * ⚠️ Run from the app rather than inside the turn pipeline, because a rank
   * is bought with retained knowledge as well as with people, and the mastery
   * tracker lives on this side of the D35 line. The engine is handed a plain
   * function from an opaque topic id to a number and never learns what the
   * topics are.
   */
  const risen = promoteCities(state, topicStrength);
  if (risen.promoted.length > 0) {
    state = risen.state;
    for (const p of risen.promoted) {
      log(
        t('{name} is now a {rank}. {why}', {
          name: p.cityName,
          rank: rankName(p.to.id),
          why: whyItRose(p.to),
        }),
        'good',
      );
    }
    dirty = true;
  }

  if (report.bankrupt) log(t('Upkeep could not be paid in full.'), 'bad');

  if (report.researchSpent > 0) {
    log(t('{spent} Compute into research.', { spent: report.researchSpent }));
  }
  /*
   * Say so when the empire chose for itself.
   *
   * ⚠️ Silence here would be the actual problem. Something picking your next
   * subject without telling you is indistinguishable from a bug the first time
   * you notice the tech tree moving on its own, and the whole point of the
   * message is that the player knows they may change it.
   */
  if (report.researchAutoSelected) {
    const node = provider.topics().nodes.find((n) => n.id === report.researchAutoSelected);
    log(
      t('Nothing was being studied, so the council began {topic}. Choose another if you like.', {
        topic: node?.label ?? report.researchAutoSelected,
      }),
    );
  }
  for (const made of report.unitsBuilt) {
    const label = unitType(made.typeId).label;
    log(
      `${state.cities.get(made.cityId)?.name ?? 'A city'} mustered ${article(label)} ${label}.`,
      'good',
    );
  }
  for (const cityId of report.citiesBlocked) {
    log(
      `${state.cities.get(cityId)?.name ?? 'A city'} finished a unit but has nowhere to put it.`,
      'bad',
    );
  }
  // Reviews are reported as an opportunity, never as a demand (D49). Ignoring
  // them costs the bonus and, eventually, a little yield; nothing is lost and
  // nothing accrues while the player is away.
  for (const cityId of report.citiesUnsettled) {
    log(t('{city} is restless without its council.', {
      city: state.cities.get(cityId)?.name ?? t('A city'),
    }), 'bad');
  }
  if (report.reviewsAvailable.length > 0) {
    const first = report.reviewsAvailable[0]!;
    const extra = report.reviewsAvailable.length - 1;
    log(
      `${first.cityName} can hold a council${extra > 0 ? ` (and ${extra} more)` : ''}.`,
      'good',
    );
  }

  /*
   * Watch the raid, then take the consequences.
   *
   * ⚠️ Awaited, unlike the rest of the presentation, because the world on
   * screen is still the old one until this resolves. Letting the player act
   * during it would mean acting on a state the engine has already replaced.
   */
  const presentedEnemyTurn = presentEnemyTurn(
    report.enemyEvents,
    defenderChallengeScore,
    adoptResult,
    incoming?.intent.kind === 'raid' ? incoming.intent.target : undefined,
  );
  resolvingTurn = true;
  try {
    await presentedEnemyTurn;
  } finally {
    // Never leave the game locked, whatever the presentation did.
    resolvingTurn = false;
  }
  // Belt and braces: a turn with nothing to show still has to be adopted.
  adoptResult();

  /*
   * ⚠️ After the result is adopted, never before.
   *
   * `resolveResearch` asks a question and then writes to `state`. Started
   * while the turn's result was still being held back, its work would have
   * been silently overwritten by the adoption a moment later.
   */
  if (report.researchReadyTopicId) {
    void resolveResearch(report.researchReadyTopicId);
  }

  refreshSelection();
  refreshResearch();
  refreshCorruption();
  refreshFog();
  refreshCities();
  refreshReadiness();
  refreshThreats();
  dirty = true;

  // The map's own offer, if it made one. Voluntary, so it comes after the turn
  // has been reported rather than interrupting it.
  await offerFortune();

  /*
   * Standing orders, walked one turn's worth.
   *
   * ⚠️ After the enemy phase and the fortune, not before. A march that stepped
   * first would walk into ground a raider is about to take, and a unit that
   * has just been bogged down by a mire should stay bogged: `advanceMarch`
   * reads `movesLeft`, so ordering it after the mire is what makes the two
   * agree instead of the march quietly undoing it.
   */
  const marched = advanceMarches(state, mySeat);
  if (marched.reports.length > 0) {
    state = marched.state;
    for (const report of marched.reports) {
      const unit = state.units.get(report.unitId);
      const who = unit ? t(unitType(unit.typeId).label) : t('a unit');
      if (report.stop === 'spotted') {
        log(t('{unit} halts: something is out there.', { unit: who }), 'bad');
        if (report.spotted) {
          effects.pulse(report.spotted, '#ff9b91', 3);
          scene.focus(report.spotted);
        }
      } else if (report.stop === 'arrived') {
        log(t('{unit} arrives.', { unit: who }), 'good');
      } else if (report.stop === 'blocked') {
        log(t('{unit} cannot get through and stops.', { unit: who }), 'bad');
      }
    }
    refreshSelection();
    dirty = true;

    /*
     * ⚠️ **A march digs up what it walks over, exactly as a hand-driven move
     * does.** It did not, and the asymmetry was invisible from the outside:
     * walking a Profiler onto a chest opened it, ordering the same Profiler to
     * the same tile marched it over the chest and said nothing. The tile was
     * crossed, the fog opened, and the cache stayed buried. That reads as the
     * treasure being broken rather than as the march never having mentioned
     * the route.
     *
     * ⚠️ Sequential, not `Promise.all`. `digAlong` plays a film and opens a
     * question modal; two of them at once would race for the same modal, and
     * `digAlong` itself bails when one is already open, so the second chest
     * would be silently lost rather than queued.
     */
    for (const report of marched.reports) {
      await digAlong(report.unitId, report.walked);
    }
  }

  /*
   * The autosave point.
   *
   * End of turn rather than after every action, for two reasons. It is the
   * only moment the game state is unambiguously between things, with no unit
   * half-moved and no question waiting for an answer. And it is the natural
   * unit of loss: the worst a crash can cost is the turn being played, which
   * is what a player would expect to redo anyway.
   */
  saveGame(slot, state);

  /*
   * The ending, if this turn was one.
   *
   * The raids above are presented unawaited so an ordinary turn hands control
   * straight back. A finishing turn is different: the overlay must not cover
   * the blow that caused it, so here we wait for the presentation to run out
   * before putting anything on top of the map.
   */
  if (!report.outcome) return;
  finished = true;
  el.endTurn.disabled = true;
  await presentedEnemyTurn;
  const myCities = [...state.cities.values()].filter((c) => c.factionId === mySeat).length;
  endScreen.show(report.outcome, {
    turn: report.turn,
    skills: `${state.research.known.length}/${state.topics.nodes.length}`,
    cities: myCities,
    cheats: state.cheatsUsed,
  });

  /*
   * The one moment a campaign is worth recording.
   *
   * ⚠️ Deliberately AFTER the end screen is shown, and not awaited. The player
   * has finished; making them wait on a network write to see their own result
   * would be charging them for the statistics. If it fails, it fails quietly.
   */
  void recordRun({
    seed: state.seed,
    difficulty: state.difficulty,
    players: lastSetup.players,
    outcome: String(report.outcome).toLowerCase().includes('vic') ? 'victory' : 'defeat',
    turns: report.turn,
    cities: myCities,
    readinessPercent: Math.round(libraryModel().examRetained * 100),
    skillsResearched: state.research.known.length,
    cheatsUsed: state.cheatsUsed,
  });
}

/**
 * Show what the antagonists did.
 *
 * ⚠️ The engine has already applied all of this, which is why raids get the
 * camera, a shake and floating damage rather than the full duel the player's
 * own attacks get: choreographing a fight needs the result held back until the
 * moment of impact, and by the time this runs the loser is already gone from
 * the state. Pretending otherwise would mean animating a unit that no longer
 * exists.
 *
 * What matters is that the player is never quietly attacked. Something has to
 * move the camera to the place they just lost health, or the first they will
 * know of it is a missing unit.
 */
/**
 * Show what the antagonists did.
 *
 * ⚠️ **The first raid against the player is now a real fight.** It used to get
 * a camera shake and a floating number, because the engine had already applied
 * the whole turn by the time this ran and the defender was gone before
 * anything could be drawn. Being asked a question and then simply losing
 * health, with no blow on screen, made the question feel like a toll rather
 * than a defence.
 *
 * So `doEndTurn` now holds the result back and hands it over as `adopt`, which
 * this calls at the exact frame of impact. That is the same contract the
 * player's own attacks have always used.
 *
 * Only the first player-facing raid gets the full duel. Adopting the result
 * applies the WHOLE turn at once, so every later raid is already resolved and
 * cannot be choreographed; those keep the camera, the shake and the number,
 * and the warning banner has already said how many fronts were coming.
 */
async function presentEnemyTurn(
  events: readonly AiEvent[],
  defenceScore = 0,
  adopt?: () => void,
  featuredAt?: Hex,
): Promise<void> {
  if (events.length === 0) {
    adopt?.();
    return;
  }

  const raids = events.filter((e) => e.intent.kind === 'raid');
  const movers = new Set(events.filter((e) => e.intent.kind === 'move').map((e) => e.unitId));
  const faction = (id: string) => state.factions.get(id)?.label ?? 'Something';

  /**
   * Where a raider was standing when it struck.
   *
   * ⚠️ Not simply its position in the state: a unit may move up to three times
   * and then attack in the same turn, so the hex it started the turn on is not
   * the hex it swung from. Replaying its own move events gives the real one,
   * and a lunge that starts in the wrong place is worse than no lunge.
   */
  const strikeHexOf = (index: number): Hex | undefined => {
    const raid = events[index];
    if (!raid) return undefined;
    let hex = state.units.get(raid.unitId)?.hex;
    for (let i = 0; i < index; i++) {
      const step = events[i];
      if (step && step.unitId === raid.unitId && step.intent.kind === 'move') {
        hex = step.intent.to;
      }
    }
    return hex;
  };

  // The one the player was asked about, and the only one that can be fought
  // on screen, because adopting the result resolves all of them at once.
  //
  // ⚠️ **`featuredAt` is passed in rather than re-derived.** `doEndTurn`
  // prefers a raid on a town when choosing what to show and ask about, so
  // "the first raid the player defends" is no longer the same event. Working
  // it out twice, from two different rules, put the banner and the question on
  // a city while the duel was fought over whichever scout happened to be
  // earlier in the list.
  const featuredIndex = events.findIndex(
    (e) =>
      e.intent.kind === 'raid' &&
      defends(e.intent.target) &&
      (featuredAt === undefined || hexKey(e.intent.target) === hexKey(featuredAt)),
  );
  const featured = featuredIndex >= 0 ? events[featuredIndex] : undefined;

  if (movers.size > 0 && raids.length === 0) {
    /*
     * Once per advance, not once per turn.
     *
     * The horde takes several turns to cross the map, and saying so on every
     * one of them filled the log with four identical lines before anything
     * happened. Repetition is how a log teaches the player to stop reading it.
     */
    if (!hordeAdvancing) {
      hordeAdvancing = true;
      log(t('{who} is on the move.', { who: faction(events[0]!.factionId) }));
    }
  } else if (raids.length > 0) {
    // They have arrived, so the next quiet spell is a new advance.
    hordeAdvancing = false;
  }

  if (featured && featured.intent.kind === 'raid' && featured.log) {
    const target = featured.intent.target;
    const from = strikeHexOf(featuredIndex);
    const battle = featured.log;
    const defender = unitAt(state, target);
    const city = cityAt(state, target);
    const attackerColour = state.factions.get(featured.factionId)?.colour ?? '#b5533f';
    const defenderColour = state.factions.get(mySeat)?.colour ?? '#4a9fe0';

    if (from) {
      const onImpact = (): void => {
        adopt?.();
        // ⚠️ The same sting on a raid as on your own attack. A blow that
        // sounded different depending on who threw it would read as two
        // different events rather than one seen from the other side.
        if (battle.wallBroken) cues.play('breach');
        else cues.play('clash');
        if (battle.damageToDefender > 0) {
          effects.floatingText(target, `-${battle.damageToDefender}`, '#ff9b91', 1.3);
        }
        if (battle.damageToAttacker > 0 && from) {
          effects.floatingText(from, `-${battle.damageToAttacker}`, '#ffcf7a', 1.1);
        }
      };
      const shake = (magnitude: number): void => effects.shake(magnitude);

      if (city) {
        /*
         * ⚠️ The stance and tactic come off the LOG, not from the local
         * variables the turn was driven with. `defenceStance` here is what the
         * player picked for the raid they were shown; the log records what
         * this particular blow was actually resolved with, and section 91
         * scoped those two apart on purpose.
         */
        await playSiegeFramed(
          scene,
          {
            attackerId: featured.unitId,
            attackerHex: from,
            attackerColour,
            cityHex: target,
            defenderColour,
            wallLevel: city.wallLevel,
          },
          {
            damageToDefender: battle.damageToDefender,
            damageToAttacker: battle.damageToAttacker,
            breached: battle.wallBroken,
            taken: battle.cityCaptured || battle.cityRazed,
            attackerDestroyed: battle.attackerDestroyed,
            tactic: battle.tactic,
            stance: battle.stance,
          },
          { onImpact, shake },
        );
      } else {
        await playDuel(
          scene,
          {
            attackerId: featured.unitId,
            attackerHex: from,
            attackerColour,
            defenderId: defender?.id,
            defenderHex: target,
            defenderColour,
          },
          {
            damageToDefender: battle.damageToDefender,
            damageToAttacker: battle.damageToAttacker,
            defenderDestroyed: battle.defenderDestroyed,
            attackerDestroyed: battle.attackerDestroyed,
            ranged: !isAdjacent(from, target),
            dramatic: false,
          },
          { onImpact, shake },
        );
      }
    }
  }

  // Whatever happened above, the turn's result is now the world.
  adopt?.();

  for (const event of raids) {
    if (event.intent.kind !== 'raid') continue;
    const battle = event.log;
    const target = event.intent.target;
    const who = faction(event.factionId);
    const wasFought = event === featured;

    if (!wasFought) {
      scene.focus(target);
      effects.shake(battle?.defenderDestroyed ? 1.4 : 0.9);
      if (battle && battle.damageToDefender > 0) {
        effects.floatingText(target, `-${battle.damageToDefender}`, '#ff9b91', 1.3);
      }
    }

    if (battle?.cityCaptured) {
      log(t('{who} has taken one of your cities.', { who }), 'bad');
      await playCityFallsShot(target);
    } else if (battle?.defenderDestroyed) {
      log(t('{who} destroyed one of your units.', { who }), 'bad');
    } else if (battle?.attackerDestroyed) {
      log(t('You held. A raider from {who} was destroyed.', { who }), 'good');
    } else {
      log(t('{who} raided you for {damage}.', {
        who,
        damage: battle?.damageToDefender ?? 0,
      }), 'bad');
    }

    /*
     * What the stance bought, said out loud.
     *
     * ⚠️ Exactly the argument the block below makes about the answer, applied
     * to the choice made moments earlier. Sallying promises "you hit back far
     * harder" and then reported nothing at all, so the one stance whose entire
     * point is the counter was indistinguishable from holding. The engine was
     * applying the damage the whole time, which is the worst version of this:
     * a mechanic that works and cannot be seen is a mechanic nobody uses.
     *
     * Not said when the raider died, because "a raider was destroyed" above
     * already carries it and twice is noise.
     */
    const struckBack = battle?.damageToAttacker ?? 0;
    if (struckBack > 0 && !battle?.attackerDestroyed) {
      log(t('Your defenders struck back for {damage}.', { damage: String(struckBack) }), 'good');
    }

    // Say what the answer bought, once, on the first raid of the turn. The
    // player should be able to connect knowing the material to taking less
    // damage, and that connection is invisible if it is never stated.
    if (event === raids[0] && defenceScore !== 0) {
      log(
        defenceScore > 0
          ? 'Your defenders knew the ground. The blow was softened.'
          : 'Your defenders were unsure, and it cost you.',
        defenceScore > 0 ? 'good' : 'bad',
      );
    }

    dirty = true;
    // A beat between raids, so three of them in one turn read as three
    // events rather than one flicker.
    await new Promise((resolve) => window.setTimeout(resolve, 650));
  }
}
// Presentation ---------------------------------------------------------

function refreshResearch(): void {
  const current = state.research.current;
  const node = current ? topicById(state.topics, current) : undefined;

  if (node) {
    const cost = researchCost(node);
    const pct = Math.min(100, Math.round((state.research.progress / cost) * 100));
    el.resTitle.textContent = node.label;
    el.resBar.style.width = `${pct}%`;
    el.resStatus.textContent = `${node.cluster}  ${state.research.progress}/${cost} Compute`;
  } else {
    el.resTitle.textContent = t('Researching nothing');
    el.resBar.style.width = '0%';
    el.resStatus.textContent = t('{known}/{total} known ({percent}%)', {
      known: state.research.known.length,
      total: state.topics.nodes.length,
      percent: Math.round(researchProgress(state) * 100),
    });
  }

  /*
   * ⚠️ **Every option stays put, and the current one is marked rather than
   * removed.**
   *
   * This used to `continue` past the topic being researched, which meant
   * picking a different one made two buttons trade places: the new choice
   * vanished into the heading and the old one appeared in the list. The row
   * you just clicked moved, so the next click landed on something else.
   *
   * A stable list with one active entry is the ordinary control for "one of
   * these", and it costs nothing but not skipping.
   */
  el.resOptions.replaceChildren();
  const spent = state.research.progress;
  for (const option of researchable(state)) {
    const isCurrent = option.id === current;
    const button = document.createElement('button');
    button.className = isCurrent ? 'active' : '';
    button.setAttribute('aria-pressed', String(isCurrent));

    /*
     * ⚠️ Switching resets `progress` to 0 in the engine, so a click here can
     * quietly bin the Compute already spent. Saying so on the button is the
     * cheapest honest answer: a confirmation dialog for every change would be
     * friction on the common case, where nothing has been spent yet.
     */
    const note = isCurrent
      ? t('studying now')
      : spent > 0
        ? t('discards {spent} Compute', { spent })
        : '';
    const suffix = note ? ` &middot; ${note}` : '';
    button.innerHTML =
      `<span class="cluster">${option.cluster} &middot; ${researchCost(option)} Compute${suffix}</span>` +
      `<br>${option.label}`;

    // The engine rejects restarting the current topic ("Already researching
    // this"), so an enabled button here would only ever log an error.
    if (isCurrent) {
      button.disabled = true;
    } else {
      button.addEventListener('click', () => {
        const result = startResearch(state, option.id);
        if (!result.ok) {
          log(t(result.reason), 'bad');
          return;
        }
        state = result.state;
        log(t('Researching: {topic}', { topic: option.label }));
        refreshResearch();
      });
    }
    el.resOptions.append(button);
  }

  /*
   * ⚠️ Keep the active entry on screen.
   *
   * Marking rather than removing means the list only grows: finishing one
   * topic unlocks its children, and it was seven entries by the second turn
   * against a `max-height: 30vh` scroller. An active marker nobody can see is
   * no better than the swap it replaced.
   *
   * `block: 'nearest'` moves the options list by the minimum and leaves the
   * page alone, which matters because this runs on every refresh.
   */
  const active = el.resOptions.querySelector('button.active');
  active?.scrollIntoView({ block: 'nearest' });
}

/**
 * Resolve a funded topic.
 *
 * The engine reports a topic as ready and stops; presenting the challenge is
 * the app's job, and the score is all that goes back across the boundary.
 */
async function resolveResearch(topicId: string): Promise<void> {
  const node = topicById(state.topics, topicId);
  const outcome = await provider.present({
    kind: 'research',
    topicId,
    tier: 1,
    timeLimitMs: timeLimit(RESEARCH_TIME_MS),
  });

  const done = completeResearch(state, outcome.score);
  if (!done.ok) return;
  state = done.state;

  if (outcome.score >= 0) {
    log(t('Learned: {topic}', { topic: node?.label ?? topicId }), 'good');
  } else {
    log(t('{topic} not yet mastered. Try again next turn.', {
      topic: node?.label ?? topicId,
    }), 'bad');
  }
  refreshResearch();
  dirty = true;
}

function describeTile(h: Hex | undefined): void {
  if (!h) {
    el.tileName.textContent = 'Hover a tile';
    el.tileDetail.innerHTML = '&nbsp;';
    return;
  }
  const tile = state.map.tiles.get(hexKey(h));
  if (!tile) {
    el.tileName.textContent = t('Beyond the map');
    el.tileDetail.innerHTML = '&nbsp;';
    return;
  }

  const info = terrain(tile.terrain);
  const y = tileYields(tile.terrain, tile.river);
  const parts: string[] = [];
  if (y.data) parts.push(`Data ${y.data}`);
  if (y.compute) parts.push(`Compute ${y.compute}`);
  if (y.cu) parts.push(`CU ${y.cu}`);
  if (y.trust) parts.push(`Trust ${y.trust}`);

  const occupant = unitAt(state, h);
  const city = cityAt(state, h);
  const ruin = ruinAt(state, h);
  /*
   * A town you found once, seen through the fog that has closed over it.
   *
   * ⚠️ Only consulted when there is nothing live to report. The memory is a
   * snapshot and the live city is the truth: preferring the snapshot while
   * standing next to the place would be the one moment the map lies.
   */
  const inSight =
    city !== undefined &&
    (city.factionId === mySeat || currentSight.has(hexKey(h)));
  const remembered = inSight ? undefined : memoryOf(state, mySeat).seenCities.get(hexKey(h));

  const who = city && inSight
    ? ` | ${city.name} (${state.factions.get(city.factionId)?.label ?? '?'})`
    : remembered
      ? ` | ${remembered.name} (${state.factions.get(remembered.factionId)?.label ?? '?'})`
      : occupant
        ? ` | ${unitType(occupant.typeId).label} (${state.factions.get(occupant.factionId)?.label ?? '?'})`
        : ruin
          ? ` | ruins of ${ruin.name}`
          : '';

  el.tileName.textContent = info.label + (tile.river ? ' (river)' : '') + who;
  /*
   * ⚠️ A city's health is appended here, not substituted for the yields.
   *
   * The tile is still a tile: what it grows is the reason to settle there and
   * the reason to take it off somebody. Replacing that with the town's health
   * would answer a question the player did not ask while hiding the one this
   * panel exists for.
   *
   * ⚠️ **Gated on sight, using the same rule the 3D scene uses for the town
   * itself**: your own always, anybody else's only while you can see it. The
   * scene is emphatic that remembered ground must not carry a live readout of
   * a place you walked past once, and a hover panel reporting "140/200" for a
   * siege happening in the dark is exactly that readout.
   *
   * ⚠️ Note this panel already names the city and its owner with NO such gate,
   * which contradicts the scene and predates this change. Left alone rather
   * than quietly widened: fixing it is a separate decision about how much the
   * map should hide, not a detail of showing health.
   */
  const yields = parts.length > 0 ? parts.join('  ') : t('No yield');
  const cityVisible = city !== undefined && inSight;
  el.tileDetail.textContent = cityVisible
    ? `${yields}  |  ${t('HP')} ${city.hp}/${maxCityHp(city)}`
    : remembered
      ? /*
         * ⚠️ How stale, not how healthy. The whole contract of a remembered
         * town is that it reports what was seen and when; printing live hit
         * points here would be the surveillance the fog rule exists to
         * prevent, wearing the word "remembered" as a disguise.
         */
        `${yields}  |  ${t('Last seen turn {turn}', { turn: String(remembered.turnSeen) })}`
      : yields;
}

/**
 * The cities panel: what each city is, and what it is building.
 *
 * Rebuilt wholesale on every refresh. There are rarely more than a handful of
 * cities and each row is a few nodes, so the simplest correct thing is also
 * fast enough, and a diffing scheme here would be an invitation to leave a
 * stale progress bar on screen.
 */
function refreshCities(): void {
  const mine = [...state.cities.values()].filter((c) => c.factionId === mySeat);
  el.cities.hidden = mine.length === 0;
  if (mine.length === 0) return;

  const buildable = buildableUnits(state);
  el.citiesList.replaceChildren();

  for (const city of mine) {
    const row = document.createElement('div');
    row.className = 'city';

    const head = document.createElement('div');
    head.className = 'city-head';
    const name = document.createElement('b');
    name.textContent = city.name;
    const meta = document.createElement('span');
    meta.textContent =
      `${rankName(city.rank)} · ${t('pop {n}', { n: city.population })}` +
      (city.unrest > 0 ? ` · ${t('unrest {n}', { n: city.unrest })}` : '');
    head.append(name, meta);
    row.append(head);

    /*
     * What the next rank is waiting for.
     *
     * ⚠️ Spelled out rather than left to be inferred. A settlement that has
     * quietly stopped growing because a topic lapsed is indistinguishable from
     * one that is merely slow, and a player who cannot tell the difference
     * learns nothing from either. The knowledge case is called out separately
     * because it is the one the player can do something about right now.
     */
    const need = nextRankNeed(city, topicStrength);
    if (need) {
      const wants = document.createElement('div');
      wants.className = need.blockedByKnowledge ? 'city-need knowledge' : 'city-need';
      const parts: string[] = [];
      if (need.citizensShort > 0) {
        parts.push(
          plural(need.citizensShort, '{n} more citizen', '{n} more citizens'),
        );
      }
      if (need.topicsShort > 0) {
        const band = t(need.rank.strengthRequired >= 0.95 ? 'strong' : 'familiar');
        parts.push(
          plural(
            need.topicsShort,
            '{n} more topic held at {band}',
            '{n} more topics held at {band}',
            { band },
          ),
        );
      }
      /*
       * ⚠️ The rank named here is the one being climbed TO, never the one the
       * city holds. Phrased as "{rank} needs {what}" it read as a statement
       * about the city: a Settlement announced "Village needs 1 more topic at
       * familiar", which names two things the player can see on the same row
       * and gets the relationship between them backwards.
       */
      wants.textContent =
        parts.length > 0
          ? t('Next rank {rank}: {what}', {
              rank: rankName(need.rank.id),
              what: parts.join(t(' and ')),
            })
          : t('Rising to {rank}', { rank: rankName(need.rank.id) });
      row.append(wants);
    }

    if (city.wallLevel > 0) {
      const walls = document.createElement('div');
      walls.className = 'status';
      const full = maxWallHp(city.wallLevel);
      walls.textContent = t('Walls level {level} · {hp}/{full}', {
        level: String(city.wallLevel),
        hp: String(city.wallHp),
        full: String(full),
      });
      row.append(walls);
    }

    /*
     * The city's own health, under the walls that are supposed to protect it.
     *
     * ⚠️ **Marked when hurt, because it never mends.** Nothing in the engine
     * restores a city's HP: promotion raises the ceiling and keeps the damage.
     * So this is not a bar that will quietly refill, it is a standing record
     * of every assault that got through, and a player who does not know that
     * will read "160/200" as something time will fix.
     */
    const integrity = document.createElement('div');
    integrity.className = city.hp < maxCityHp(city) ? 'status hurt' : 'status';
    integrity.textContent = t('{hp}/{full} HP', {
      hp: String(city.hp),
      full: String(maxCityHp(city)),
    });
    row.append(integrity);

    if (city.producing) {
      // ⚠️ `producing` is a unit OR a wall, so nothing here may call
      // `unitType` before it has asked which. Narrowed inline rather than
      // through a boolean, because TypeScript cannot carry a type guard's
      // result across a separate variable.
      const orders = city.producing;
      const work = isWallTarget(orders) ? wallWork(city) : undefined;
      const label = work
        ? work.kind === 'repair'
          ? t('Repair walls (level {level})', { level: String(work.level) })
          : t('Walls level {level}', { level: String(work.level) })
        : isWallTarget(orders)
          ? t('Walls level {level}', { level: String(city.wallLevel) })
          : unitType(orders).label;
      const cost = productionCost(city);
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('div');
      fill.style.width = `${Math.min(100, (city.productionProgress / Math.max(1, cost)) * 100)}%`;
      bar.append(fill);

      const status = document.createElement('div');
      status.className = 'status';
      const left = Math.max(0, cost - city.productionProgress);
      const turns = Math.ceil(left / PRODUCTION_CAP_PER_TURN);
      status.textContent = `${label}: ${city.productionProgress}/${cost} Compute${
        left > 0 ? ` · ${turns} turn${turns === 1 ? '' : 's'}` : ' · ready'
      }`;
      row.append(bar, status);
    }

    const build = document.createElement('div');
    build.className = 'build';

    const picker = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = city.producing ? 'Stop building' : 'Build nothing';
    picker.append(none);
    // Walls first, because they are the one thing in the list that is not a
    // soldier and would otherwise be lost at the bottom of twelve unit names.
    // ⚠️ `wallWork` decides whether this is a new level or mending the one
    // that is there, so the label cannot just say `wallLevel + 1`.
    const work = wallWork(city);
    if (work !== undefined) {
      const option = document.createElement('option');
      option.value = WALL_TARGET;
      const text =
        work.kind === 'repair'
          ? t('Repair walls (level {level})', { level: String(work.level) })
          : t('Walls level {level}', { level: String(work.level) });
      option.textContent = `${text} (${work.cost})`;
      option.selected = city.producing === WALL_TARGET;
      picker.append(option);
    }
    for (const id of buildable) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = `${unitType(id).label} (${unitCost(unitType(id))})`;
      option.selected = city.producing === id;
      picker.append(option);
    }
    picker.addEventListener('change', () => {
      const chosen = picker.value;
      const result = chosen
        ? setProduction(state, city.id, chosen as ProductionTarget)
        : cancelProduction(state, city.id);
      if (!result.ok) {
        log(result.reason, 'bad');
        refreshCities();
  refreshReadiness();
  refreshThreats();
        return;
      }
      state = result.state;
      log(chosen
        ? t('{city} begins {unit}.', {
            city: city.name,
            unit: t(unitType(chosen as UnitTypeId).label),
          })
        : t('{city} downs tools.', { city: city.name }));
      refreshCities();
  refreshReadiness();
  refreshThreats();
      dirty = true;
    });

    build.append(picker);
    row.append(build);
    el.citiesList.append(row);
  }
}

/**
 * "a Profiler", but "an Engineer" and "an RLS Sentinel".
 *
 * The vowel test alone gets Architect and Engineer right and RLS Sentinel
 * wrong, because the article follows how a name is *said* and an initialism
 * starting with R is said "ar". There is exactly one of those in the unit
 * table, so the rule is a vowel check plus the letters whose names begin with
 * a vowel sound.
 */
function article(label: string): string {
  const first = label[0] ?? '';
  const initialism = /^[A-Z]{2,}\b/.test(label);
  const spoken = initialism ? 'AEFHILMNORSX' : 'AEIOU';
  return spoken.includes(first) ? 'an' : 'a';
}

/**
 * The current library model, which is also where exam readiness comes from.
 *
 * Built on demand rather than cached: it reads mastery, research and the bank,
 * all of which move, and a stale readiness number would be worse than a slow
 * one. It is a few hundred array operations.
 */
function libraryModel() {
  const now = Date.now();
  const campaign = worldCampaign();
  return buildLibraryModel({
    records: new Map(state.topics.nodes.map((n) => [n.id, mastery.get(n.id)])),
    researched: new Set(state.research.known),
    questions: campaign.questions,
    outline: campaign.outline,
    campaignId: campaign.id,
    due: new Set(provider.dueTopics(now)),
  });
}

/**
 * Write the readiness figure, and nothing else.
 *
 * ⚠️ Split out of `refreshReadiness` so it can be painted at startup. The
 * markup ships `0% exam` as static text, which is English, so a German player
 * read it in English for the whole of the setup screen and until the first
 * HUD refresh. `refreshReadiness` itself cannot be called that early: it also
 * decides whether the Proctor is ready and can write to the log, neither of
 * which means anything before there is a game.
 */
function paintReadiness(percent: number): void {
  el.readiness.textContent = t('{percent}% exam', { percent });
}

/**
 * Exam readiness, and the Proctor's interest in it.
 *
 * ⚠️ Readiness is weighted by the published branch percentages, so it moves
 * much more slowly than a skill count and is meant to. Twenty of forty-one
 * skills is not half the exam.
 */
function refreshReadiness(): void {
  const model = libraryModel();
  const exam = worldCampaign().exam;
  const percent = Math.round(model.examRetained * 100);
  paintReadiness(percent);

  const ready = proctorReady(model, exam.threshold);
  el.faceProctor.hidden = !ready || finished;
  if (ready && !proctorAnnounced) {
    proctorAnnounced = true;
    log(
      t('The Proctor has noticed you at {percent}% readiness. {count} questions await.', {
        percent,
        count: exam.length,
      }),
      'good',
    );
    // Straight down onto the capital, because the exam is not coming for a
    // unit or a border: it is coming for the whole empire's account of itself.
    const capital = [...state.cities.values()].find((c) => c.factionId === mySeat);
    if (capital) {
      void playOnce(
        descendShot({
          id: 'proctor',
          title: 'The Proctor',
          subtitle: `${percent} percent of the exam, by weight. It has come to check`,
          centre: scene.groundAt(capital.hex),
          startHeight: 60,
          endHeight: 10,
          radius: 8,
          sweepRad: 1.6,
          durationMs: 5200,
        }),
      );
    }
  }
}

/**
 * Sit the exam.
 *
 * ⚠️ **Every answer still feeds the review schedule.** The siege is the
 * hardest study session in the game and it would be perverse for it to be the
 * one that teaches the spaced repetition system nothing. A player who fails
 * comes back to a schedule that knows exactly which branch let them down.
 *
 * The paper is drawn from the seed, so two players comparing a run sit the
 * same exam.
 */
async function faceTheProctor(): Promise<void> {
  if (finished || siegeRunning) return;
  siegeRunning = true;
  el.faceProctor.disabled = true;

  const campaign = worldCampaign();
  const paper = buildSiege(
    campaign.questions,
    state.seed,
    campaign.outline,
    campaign.exam.length,
  );
  const correctIds = new Set<string>();
  log(t('The Proctor sets {count} questions.', { count: paper.length }), 'bad');

  try {
    for (const entry of paper) {
      const request = {
        kind: 'boss' as const,
        topicId: `exam-${entry.position}`,
        tier: 3 as const,
        timeLimitMs: timeLimit(campaign.exam.questionMs),
      };
      const given = await modal.ask({ question: entry.question, request });
      const answer = given.answer;
      const correct =
        !given.abandoned &&
        answer !== undefined &&
        (Array.isArray(answer) ? answer.length > 0 : String(answer).length > 0) &&
        (await checkAnswer(entry.question.id, answer, entry.question.answerHash));

      if (correct) correctIds.add(entry.question.id);

      // The schedule learns from the exam too.
      mastery.record(
        topicIdForSkill(entry.question.skillId) ?? entry.question.id,
        scoreFor(correct, given.elapsedMs, request.timeLimitMs, given.abandoned),
        given.abandoned,
      );

      /*
       * ⚠️ Teach on the way out, exactly as an ordinary question does.
       *
       * This block is a hand-written copy of the tail of `presentQuestion`,
       * and it copied everything except the reasoning: it passed
       * `explanation: undefined`, so the one session where a learner is most
       * likely to meet something they got wrong was the only session that
       * never told them why. The exam already stops to show the right answer,
       * so withholding the sentence underneath it was not even buying speed.
       *
       * The explanation is encrypted under its own answer, so it can only be
       * read once the answer has been recovered, which is why this waits for
       * `revealCorrectAnswer` rather than decrypting up front.
       */
      const correctAnswer = await revealCorrectAnswer(entry.question);
      const explanation =
        correctAnswer === undefined
          ? undefined
          : await decryptExplanation(
              entry.question.id,
              correctAnswer,
              entry.question.explanationCipher,
            );

      await modal.reveal({
        question: entry.question,
        correct,
        given: answer,
        correctAnswer,
        explanation,
        score: correct ? 1 : -1,
        elapsedMs: given.elapsedMs,
      });
    }
  } finally {
    siegeRunning = false;
    el.faceProctor.disabled = false;
  }

  const result = scoreSiege(paper, correctIds);
  const percent = Math.round(result.share * 100);

  if (!result.passed) {
    log(
      `The Proctor is unconvinced: ${result.correct} of ${result.asked} (${percent}%). Study and try again.`,
      'bad',
    );
    refreshReadiness();
  refreshThreats();
    return;
  }

  finished = true;
  el.endTurn.disabled = true;
  el.faceProctor.hidden = true;
  endScreen.show(
    {
      kind: 'exam',
      summary: t('{correct} of {asked} correct, {percent} percent. The Proctor has no further questions.', {
        correct: String(result.correct),
        asked: String(result.asked),
        percent: String(percent),
      }),
    },
    {
      turn: state.turn,
      skills: `${state.research.known.length}/${state.topics.nodes.length}`,
      cities: [...state.cities.values()].filter((c) => c.factionId === mySeat).length,
      cheats: state.cheatsUsed,
    },
  );
}

/**
 * Who is coming, and what they will ask about.
 *
 * ⚠️ **This panel is what makes the central mechanic legible.** Each faction
 * quizzes one cluster of the outline, so who is marching on you tells you what
 * you are about to be tested on. That has been true in the code for a while
 * and completely invisible on screen: a player could be raided by the Scan
 * Wraiths four times without ever learning that the Scan Wraiths mean B3, or
 * that B3 is the branch they have not revised.
 *
 * It joins the two halves of the game in one row: where a faction is, from the
 * engine, and how ready you are for it, from the learning layer.
 */
function refreshThreats(): void {
  const model = libraryModel();

  // Retention per cluster, which is the number that makes a distance mean
  // something. Six hexes away is fine if you know the material.
  const readiness = new Map<string, { label: string; retained: number; total: number }>();
  for (const branch of model.branches) {
    for (const cluster of branch.clusters) {
      const retained = cluster.skills.filter(
        (s) => s.band === 'familiar' || s.band === 'strong',
      ).length;
      readiness.set(cluster.id, {
        label: cluster.label,
        retained,
        total: cluster.skills.length,
      });
    }
  }

  const mine = [
    ...unitsOf(state, mySeat).map((u) => u.hex),
    ...[...state.cities.values()].filter((c) => c.factionId === mySeat).map((c) => c.hex),
  ];
  const limit = aggroRadius(state.turn);

  // ⚠️ Only the factions this game actually has. A game can be started with
  // three rivals rather than seven, and listing all of them would have shown
  // four enemies that do not exist, permanently "gone" and at infinite range.
  const rows = worldCampaign().antagonists
    .filter((a) => state.factions.has(a.id))
    .map((antagonist) => {
    const units = unitsOf(state, antagonist.id);
    let distance = Number.POSITIVE_INFINITY;
    for (const unit of units) {
      for (const hex of mine) distance = Math.min(distance, hexDistance(unit.hex, hex));
    }
    return { antagonist, alive: units.length > 0, distance };
  }).sort((a, b) => a.distance - b.distance);

  el.threatsList.replaceChildren();

  for (const row of rows) {
    const cluster = readiness.get(row.antagonist.topicCluster);
    const share = cluster && cluster.total > 0 ? cluster.retained / cluster.total : 0;

    const node = document.createElement('div');
    node.className = 'foe';
    if (!row.alive) node.classList.add('gone');
    else if (Number.isFinite(row.distance) && row.distance <= limit) node.classList.add('closing');

    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = row.antagonist.colour;

    const middle = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = row.antagonist.label;
    const what = document.createElement('span');
    what.className = 'cluster';
    what.textContent = cluster
      ? `${row.antagonist.topicCluster} ${cluster.label}`
      : row.antagonist.topicCluster;
    middle.append(name, what);

    const right = document.createElement('div');
    right.className = 'range';
    right.textContent = !row.alive
      ? 'broken'
      : !Number.isFinite(row.distance)
        ? '-'
        : row.distance <= limit
          ? `${row.distance} closing`
          : `${row.distance} hexes`;

    if (cluster) {
      const ready = document.createElement('span');
      ready.className = `ready ${share >= 0.6 ? 'solid' : share < 0.3 ? 'weak' : ''}`;
      ready.textContent = t('{known}/{total} known', {
        known: cluster.retained,
        total: cluster.total,
      });
      right.append(ready);
    }

    node.append(swatch, middle, right);
    el.threatsList.append(node);
  }
}

function refreshHud(): void {
  const resources = state.factions.get(mySeat)!.resources;
  el.turn.textContent = t('Turn {n}', { n: state.turn });
  el.compute.textContent = String(resources.compute);
  el.cu.textContent = String(resources.cu);
  el.trust.textContent = String(resources.trust);
  // What is left to do changes with almost anything, so it is repainted with
  // the rest of the HUD rather than from each of the dozen places that could
  // have changed it.
  refreshTurnButton();
}

function viewportSize(): { width: number; height: number } {
  /*
   * ⚠️ Measured from the board itself, not from `window`.
   *
   * On a phone the map is only the top 56vh and the rest of the screen is the
   * HUD column. Sizing the renderer to the whole window there would draw a
   * full-height world into a short canvas, squashing it, and would stretch the
   * effects overlay across the interface underneath.
   *
   * three.js is told `setSize(w, h, false)`, which means CSS owns the display
   * size and nothing here fights it. So this only has to report what CSS
   * already decided, and the mobile breakpoint stays in one place: the
   * stylesheet. Falls back to the window before layout has happened.
   */
  const rect = canvas.getBoundingClientRect();
  return {
    width: Math.round(rect.width) || window.innerWidth,
    height: Math.round(rect.height) || window.innerHeight,
  };
}

function fitCanvas(): void {
  const { width, height } = viewportSize();
  const dpr = window.devicePixelRatio || 1;
  fxCanvas.width = Math.round(width * dpr);
  fxCanvas.height = Math.round(height * dpr);
  fxCanvas.style.width = `${width}px`;
  fxCanvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scene.setSize(width, height);
  dirty = true;
}

function newGame(rawSeed: string): void {
  const seed = normaliseSeed(rawSeed);
  const shape = WORLD_SHAPES.find((s) => s.id === lastSetup.shape);
  const size = WORLD_SIZES.find((s) => s.id === lastSetup.size);
  /*
   * ⚠️ The world comes from the chosen course, all three parts of it.
   *
   * `antagonists` hands the engine the faction DEFINITIONS and `antagonistIds`
   * picks the subset this game wants. Passing only the ids, which is what this
   * used to do, silently fell back to the engine's built-in DP-600 roster: a
   * Klasse 1 game would have been fought against The Silo Horde.
   */
  const campaign = worldCampaign();
  const roster = rosterFor(campaign.antagonists, lastSetup.focus, lastSetup.rivals);
  adopt(
    createGameState(seed, {
      map: worldOptions(lastSetup),
      topics: topicsFor(campaign),
      antagonists: campaign.antagonists,
      antagonistIds: roster,
    }),
    t('New empire on seed {seed}. {shape}, {size}, {rivals} rivals.', {
      seed,
      shape: t(shape?.label ?? ''),
      // ⚠️ Not lower-cased. English happily reads "one great continent,
      // standard", and German capitalises its nouns, so the same call that
      // tidies one language misspells the other.
      size: t(size?.label ?? ''),
      rivals: roster.length,
    }),
  );
  // Write immediately rather than waiting for the first turn to end, so a
  // player who starts a game and closes the tab comes back to that game and
  // not to the one before it.
  saveGame(slot, state);
}

/**
 * Ask what kind of world, then build it.
 *
 * ⚠️ The await is what lets the setup screen double as a loading screen. Map
 * generation and the terrain build together measured 8.1 seconds on the
 * enlarged map (section 22.2), and until now every second of that was a blank
 * page. Now it is spent on a menu, and the world appears when the player has
 * finished choosing rather than before they have started.
 */
async function askAndStart(resume?: { offer: ResumeOffer; state: GameState }): Promise<void> {
  const choice = await setup.ask(lastSetup, resume?.offer);

  /*
   * ⚠️ Resuming happens HERE, not in `boot`, and that is the whole fix.
   *
   * `boot` used to adopt a save the instant it loaded one, so a returning
   * player never saw this screen at all: no options, no seed, no way back.
   * The attract card's "Skip to setup" button could not help, because skipping
   * only ever skipped the film. Every route in led to the same place.
   */
  if (choice === 'resume' && resume) {
    adopt(resume.state, t('Resumed on seed {seed}, turn {turn}.', {
      seed: resume.state.seed,
      turn: resume.state.turn,
    }));
    // A resumed empire plays no opening, so nothing else would start the score.
    startMusicOnFirstGesture();
    return;
  }

  lastSetup = choice as SetupResult;
  // A new campaign is a new row. Also clears any attempts queued but never
  // flushed by the game being abandoned.
  beginRun();
  buildSecondSeat();
  newGame(lastSetup.seed);
  // Build the shaders before the film starts rather than during it. The world
  // exists by now and the setup screen is still up, which is the last moment
  // nobody is watching the frame rate.
  await scene.world.prewarm();
  await playOpening();
}

/**
 * The opening: four shots over the world that has just been generated.
 *
 * ⚠️ **Runs after `newGame`, and that ordering is the whole feature.** The
 * sequence flies over the map the player just chose the shape and the seed
 * for, so it cannot be recorded once and reused, and it is not the same film
 * twice. It is also why the music may start: clicking Begin is the user
 * gesture browsers require before any audio will play.
 */
async function playOpening(): Promise<void> {
  const home = homeOfPlayer();
  if (!home) return;

  const shots = introShots({
    centre: scene.groundAt({ q: 0, r: 0 }),
    // Hex centres are 2 * cos(30) apart, so this is the map's real reach.
    extent: Math.max(12, (state.map.radius ?? 45) * 1.732 * 0.62),
    home,
  });

  openingSkipped = false;
  openingRunning = true;
  revealingForOpening = true;
  /*
   * ⚠️ Lift the fog BEFORE the music, not between the music and the first cut.
   *
   * Rebuilding the fog for several thousand hexes blocks the main thread for
   * the best part of a second. Doing it after `anthem.start()` handed the
   * anthem a head start over a film that had not begun animating yet.
   */
  refreshFog();

  anthem.start();
  /*
   * ⚠️ And wait for the anthem to be genuinely playing before the first card.
   *
   * `play()` resolves long before audio actually reaches the speakers: the
   * anthem was measured starting about 0.85 s after the film did, so every
   * card sat that far ahead of the line it names. Small next to the passage
   * the sequence used to be out by, and free to remove.
   *
   * Capped, because a build with no anthem file will never start one, and the
   * film must not wait on something that is never coming.
   */
  const startedBy = performance.now() + 900;
  while (anthem.available && anthem.at === 0 && performance.now() < startedBy) {
    await new Promise((resolve) => window.setTimeout(resolve, 30));
  }

  try {
    /*
     * ⚠️ **Each beat is measured from the anthem's own clock, not from the
     * end of the last shot.**
     *
     * Shot lengths used to accumulate: every beat ran `durationMs` from
     * whenever the previous one happened to finish. That is fine on a smooth
     * machine and wrong on any other, because a dropped frame, a slow fog
     * rebuild or an audio start that lags the film pushes every later card
     * out and never pulls it back. The cards drift away from the song in one
     * direction only.
     *
     * Anchoring to `anthem.at` makes each cut land where the recording says
     * it should, whatever happened during the beat before it. A beat that is
     * already late gets a shorter shot rather than an even later one.
     */
    let mark = 0;
    for (const shot of shots) {
      if (finished || openingSkipped) break;
      mark += shot.durationMs;
      // ⚠️ The Latin titles are NOT translated. They are the words of the anthem
      // and the same in every language, which is the whole reason the film uses
      // Latin (D255). Only the English glosses beneath them change.
      //
      // A beat with no title is the anthem's wordless build, and it gets no
      // card at all rather than an empty one.
      if (shot.title) {
        cinemaOverlay.show(shot.title, t(shot.subtitle));
      } else {
        cinemaOverlay.hide();
      }
      // The fog falls on the last beat, under the title, rather than after the
      // sequence has ended. Letting it happen off screen wastes the one moment
      // the player can see what was taken away from them.
      if (shot.id === 'intro-title' && revealingForOpening) {
        revealingForOpening = false;
        fogSignature = '';
        refreshFog();
      }
      /*
       * With no anthem file there is nothing to sync to, so the authored
       * length stands. The floor keeps a very late start from collapsing a
       * beat into a single frame, which would read as a glitch rather than as
       * a cut.
       */
      const playing = anthem.available && anthem.at > 0;
      const remaining = playing
        ? Math.max(900, mark - anthem.at * 1000)
        : shot.durationMs;
      await scene.cinema.play({ ...shot, durationMs: remaining });
    }
  } finally {
    revealingForOpening = false;
    openingRunning = false;
    fogSignature = '';
    refreshFog();
    cinemaOverlay.hide();
    anthem.fade();
    /*
     * The handover.
     *
     * ⚠️ **Timed off the anthem's fade, not off a number picked by feel.**
     * `fade()` returns immediately and takes `ANTHEM_FADE_OUT_MS` to finish, so
     * the score has to wait for it or the first background track plays
     * underneath the last bar of the anthem.
     *
     * ⚠️ **A short gap, deliberately, rather than a true crossfade.** Overlapping
     * the two would be the smoother edit if they were one piece of music, and
     * they are not: the anthem and the score are different recordings in
     * different keys, and the module's own ducking note is about exactly this,
     * that two pieces at once argue. So the anthem finishes, the world is
     * silent for a breath, and the score rises into it over its own
     * `FADE_IN_MS`. Both ends are ramps; only the join is empty.
     *
     * It used to be a flat 2,400 ms, which was the fade plus 800 of dead air.
     * The breath is a quarter of that now, so the sequence reads as one
     * continuous piece of sound rather than as music stopping and later
     * starting again.
     */
    window.setTimeout(() => music.start(), ANTHEM_FADE_OUT_MS + HANDOVER_BREATH_MS);
  }
}

/** Where the player's people are standing, on the ground, or nothing. */
function homeOfPlayer(): Vector3 | undefined {
  const mine = unitsOf(state, mySeat);
  const first = mine[0];
  return first ? scene.groundAt(first.hex) : undefined;
}

/**
 * Take a game state, from wherever, and make it the one on screen.
 *
 * Shared by starting a new empire and by resuming a saved one, because the
 * only difference between the two is where the state came from and what the
 * log says about it. Keeping them apart is how one of the two ends up missing
 * a step, and the missing step is always the one that leaves a stale unit
 * pose or a stale overlay behind.
 */
function adopt(next: GameState, message: string): void {
  state = next;
  // A resumed game gets one dramatic battle too. The flag marks the first
  // fight of a *session*, and there is no way to know from a save whether the
  // player already had theirs.
  hadFirstBattle = false;
  hordeAdvancing = false;
  finished = false;
  proctorAnnounced = false;
  siegeRunning = false;
  seenCinematics.clear();
  scene.cinema.skip();
  cinemaOverlay.hide();
  raidAlert.hide();
  el.endTurn.disabled = false;
  el.faceProctor.disabled = false;
  endScreen.hide();
  banner.hide();
  // A duel interrupted by a new game would otherwise leave its pose behind,
  // and a pose keeps a wreck alive on screen for as long as it exists.
  scene.fx.clearAllPoses();
  el.seedInput.value = state.seed;
  el.log.replaceChildren();
  log(message);

  const first = unitsOf(state, mySeat).find((u) => u.typeId === 'architect');
  scene.loadMap(state.map);
  if (first) {
    scene.focus(first.hex, true);
    select(first.id);
  } else {
    select(undefined);
  }
  refreshHud();
  refreshResearch();
  refreshCorruption();
  refreshFog();
  refreshCities();
  refreshReadiness();
  refreshThreats();
  dirty = true;
}

/**
 * Always ask, and offer the stored empire as one of the answers.
 *
 * ⚠️ **This no longer resumes on its own.** It used to adopt the save the
 * moment it read one, which meant the setup screen was unreachable for anybody
 * who had ever played: the options, the seed and the course pickers all existed
 * and could not be got to. Handing the save to the setup screen as a Continue
 * card keeps the resume one click away and puts the alternative back on screen.
 *
 * ⚠️ It also removes a freeze. The setup screen is what covers the ~8 s of
 * world generation (§22.2); resuming straight from boot skipped the cover and
 * not the work, so the page simply stopped responding for several seconds.
 *
 * An unreadable save says so in the log instead of failing silently. The
 * player cannot do anything about it, but "could not be read" and "you never
 * had a game" are different facts and only one of them is alarming.
 */
function boot(): void {
  const loaded = loadGame(slot, provider.topics());
  if (loaded.ok) {
    void askAndStart({
      state: loaded.state,
      offer: {
        seed: loaded.state.seed,
        turn: loaded.state.turn,
        cities: [...loaded.state.cities.values()].filter((c) => c.factionId === mySeat).length,
      },
    });
    return;
  }
  void askAndStart();
  if (loaded.reason === 'unreadable') {
    log(t('A saved game was found but could not be read, so this is a new one.'), 'bad');
  }
}

// Input ----------------------------------------------------------------
//
// Orbiting, panning and zooming all belong to the camera controller. What is
// left here is deciding whether a left-button gesture was a click on a hex or
// a drag of the world, which the controller cannot know.

let pressed = false;
let dragMoved = 0;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pressed = true;
  dragMoved = 0;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.classList.add('dragging');
});

canvas.addEventListener('pointermove', (e) => {
  if (pressed) {
    dragMoved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  }

  const next = scene.hexAt(e.clientX, e.clientY);
  const changed =
    (next === undefined) !== (hover === undefined) ||
    (next && hover && (next.q !== hover.q || next.r !== hover.r));
  if (changed) {
    hover = next;
    describeTile(hover);
    dirty = true;
  }
});

function endDrag(e: PointerEvent): void {
  if (!pressed) return;
  pressed = false;
  canvas.classList.remove('dragging');
  // A few pixels of slack: a mouse always moves a little during a click.
  if (dragMoved < 5) {
    const target = scene.hexAt(e.clientX, e.clientY);
    if (target) void actOn(target);
  }
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/**
 * The seat table: leave the empire you are playing and take one nobody is.
 *
 * ⚠️ **The empire you leave is handed to the machine, not frozen.** A seat that
 * simply stopped would be a dead empire on the board taking no turns, which is
 * neither a rival nor a ruin. The AI picking it up means the thing you walked
 * away from carries on without you, and can be walked back into later.
 *
 * ⚠️ **`activeFactionId` moves with the seat.** `endTurn` reads it to decide
 * whose turn just ended, so leaving it behind would end the turn of the empire
 * you no longer play and then hand your new one to the AI loop. That coupling
 * is only correct because exactly one person is at this table; a game with
 * several humans rotates the active seat instead, which is why `takeSeat` in
 * the engine deliberately does not touch it.
 */
async function openSeats(): Promise<void> {
  if (modal.isOpen() || choice.open()) return;
  // The board is a turn behind while a raid plays out; switching mid-resolve
  // would move the camera to an empire that is still being fought over.
  if (resolvingTurn) return;

  const table = seatTable(state, mySeat);
  if (table.offers.length === 0) {
    log(t('Every empire on the board is being played.'));
    return;
  }

  const STAY = 'stay';
  const picked = await choice.ask(table.title, table.body, [
    ...table.offers.map((offer: SeatOffer) => ({
      id: offer.id,
      label: offer.label,
      detail: offer.detail,
    })),
    {
      id: STAY,
      label: t('Stay where you are'),
      detail: t('Keep the empire you are playing.'),
      primary: true,
    },
  ]);
  if (picked === STAY) return;

  const left = state.factions.get(mySeat)?.label ?? mySeat;
  const joined = state.factions.get(picked)?.label ?? picked;

  state = takeSeat(vacateSeat(state, mySeat), picked);
  state = { ...state, activeFactionId: picked };
  mySeat = picked;

  /*
   * ⚠️ Everything selected belonged to the empire you just left. A stale
   * selection would leave the panel offering orders for a unit that is now
   * somebody else's, and the first click would look like the game ignoring it.
   */
  selectedUnitId = undefined;
  reach = undefined;
  attackTargets = undefined;
  settleSuggestions = [];

  log(t('You leave {left} to the machine and take {joined}.', { left, joined }), 'good');
  log(t('You know nothing of this map. Scout it.'));
  dirty = true;
  refreshHud();
  /*
   * Saved immediately rather than at the end of the turn.
   *
   * ⚠️ Changing seats is not an action inside a turn, it is a change of who
   * is playing. A reload between here and the next end of turn would otherwise
   * put the player back in the empire they just walked away from, with the
   * board already showing the consequences of leaving it.
   */
  saveGame(slot, state);
}

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.tagName === 'INPUT') return;
  // While a question is on screen the modal owns the keyboard.
  if (modal.isOpen()) return;

  /*
   * The cheat console, on the traditional key.
   *
   * Checked before everything else so it can always be closed, and its own
   * input stops propagation so typing a code cannot also play the game.
   */
  if (e.key === '`' || e.key === '~') {
    e.preventDefault();
    cheats.toggle();
    return;
  }
  if (cheats.isOpen() && e.key === 'Escape') {
    cheats.hide();
    return;
  }

  /*
   * Fullscreen, on `v` for Vollbild.
   *
   * ⚠️ Not `f`: free flight already spends `r` and `f` on spinning the camera,
   * and a key that means two things depending on a mode the player may not
   * know they are in is worse than an unmemorable one.
   *
   * Handled here, above the turn and library guards, because it is a property
   * of the window rather than a move in the game. There is no state in which
   * "make this bigger" should be refused.
   */
  if (e.key === 'v') {
    e.preventDefault();
    void toggleFullscreen();
    return;
  }

  // Unit actions are refused while a raid is being watched, for the same
  // reason clicks are: the world on screen is a turn behind the engine.
  if (resolvingTurn && e.key !== 'l') return;

  // The library is a reference screen, so it may be opened at any time, but
  // while it is up the map must not act on stray keys behind it.
  if (e.key === 'l') {
    e.preventDefault();
    library.toggle();
    return;
  }
  if (library.isOpen()) return;

  if (e.key === ' ') {
    e.preventDefault();
    /*
     * ⚠️ Ctrl+Space ends the turn even with work outstanding, and plain Space
     * does whatever the button currently says. One key, one meaning: "do the
     * obvious next thing". Space used to end the turn unconditionally, which
     * made the fastest way to play also the way to abandon four units.
     */
    if (e.ctrlKey || e.metaKey) void doEndTurn();
    else turnButtonAction();
  } else if (e.key === 'Enter') {
    // Always steps, never ends. The one key that cannot cost a turn.
    e.preventDefault();
    nextAction();
  } else if (e.key === 'n' || e.key === 'Tab') {
    e.preventDefault();
    selectNextIdle();
  } else if (e.key === '[') {
    /*
     * ⚠️ Brackets, not the arrow keys.
     *
     * Free flight already gives the arrow keys a meaning: they turn the
     * camera to look around (`flyControls.ts`). Binding them to selection on
     * the map would make the same four keys mean "look" in one mode and
     * "change unit" in the other, which is the kind of thing a player learns
     * once, in the wrong mode, and then distrusts. Brackets sit next to each
     * other, are unused, and read as previous/next.
     */
    e.preventDefault();
    stepUnit(-1);
  } else if (e.key === ']') {
    e.preventDefault();
    stepUnit(1);
  } else if (e.key === 'b') {
    void doFound();
  } else if (e.key === 'p') {
    doRaid();
  } else if (e.key === 'h') {
    doFortify();
  } else if (e.key === 'x') {
    doSkip();
  } else if (e.key === 'c') {
    void doCouncil();
  } else if (e.key === 'o') {
    void openSeats();
  } else if (e.key === 'g') {
    gridVisible = !gridVisible;
    scene.setGridVisible(gridVisible);
    log(gridVisible ? t('Hex grid shown.') : t('Hex grid hidden.'));
  }
});

window.addEventListener('resize', fitCanvas);
/*
 * ⚠️ Rotating a phone fires `resize` before the new layout has settled, so a
 * fit computed at that instant measures the old board. `orientationchange`
 * plus a frame is the pair that gets the right numbers, and running both is
 * harmless because `fitCanvas` is idempotent.
 */
window.addEventListener('orientationchange', () => {
  requestAnimationFrame(() => requestAnimationFrame(fitCanvas));
});

/*
 * The shell is not a document and must never sit at a scroll offset.
 *
 * ⚠️ `overflow: hidden` is not the guarantee it looks like. It removes the
 * scrollbar and the wheel, and leaves PROGRAMMATIC scrolling untouched: the
 * browser scrolls an element into view whenever it takes focus, and the setup
 * card is taller than a short window, so clicking play scrolled `body` by
 * 422px on a 1365x768 screen. Nothing then puts it back, because the two
 * things that normally would - the scrollbar and the wheel - are the two
 * things `overflow: hidden` took away.
 *
 * ⚠️ It is `body` that moves, not `documentElement`, because `html, body`
 * both carry `height: 100%`. So `window.scrollTo(0, 0)` does NOT fix it: that
 * addresses the scrolling element, which is the one that did not move.
 * Measured, and it is why the obvious fix reads as no fix at all.
 *
 * The board is `position: fixed` and so cannot be dragged out of view by this
 * any more. This is the belt to that pair of braces: an offset shell would
 * still displace anything laid out in normal flow later.
 */
const pinShell = (): void => {
  if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
  if (document.body.scrollLeft !== 0) document.body.scrollLeft = 0;
  if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
  if (document.documentElement.scrollLeft !== 0) document.documentElement.scrollLeft = 0;
};
// Capture, because a scroll event does not bubble.
document.addEventListener('scroll', pinShell, true);
el.endTurn.addEventListener('click', turnButtonAction);
el.openLibrary.addEventListener('click', () => library.toggle());
el.openSeats.addEventListener('click', () => void openSeats());
el.faceProctor.addEventListener('click', () => void faceTheProctor());
el.actFound.addEventListener('click', () => void doFound());
el.actRaid.addEventListener('click', doRaid);
el.actFortify.addEventListener('click', doFortify);
  el.actStand.addEventListener('click', doStand);
el.actSkip.addEventListener('click', doSkip);
el.selPrev.addEventListener('click', () => stepUnit(-1));
el.selNext.addEventListener('click', () => stepUnit(1));
el.actCouncil.addEventListener('click', () => void doCouncil());
el.seedGo.addEventListener('click', () => {
  lastSetup = { ...lastSetup, seed: el.seedInput.value };
  void askAndStart();
});
el.seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    lastSetup = { ...lastSetup, seed: el.seedInput.value };
    void askAndStart();
  }
});

// Render loop ----------------------------------------------------------

let frameMs = 0;
let gridVisible = true;
let lastFrameAt = performance.now();

/**
 * Tiles the Silo Horde holds.
 *
 * Recomputed only when the state changes, not per frame: territory is a
 * derived map over every city and its work radius, and it is stable between
 * turns.
 */
let corrupted: ReadonlySet<string> = new Set();

/**
 * What the player can see this instant.
 *
 * Held here and recomputed only when the world changes, because `sync` runs
 * every frame and walking every unit's sight radius per frame would be a
 * measurable cost for an answer that only moves when something moves.
 */
let currentSight: ReadonlySet<string> = new Set();

/**
 * Rebuild the fog.
 *
 * ⚠️ **Only when the ground actually changed.** Merging six thousand hex
 * patches is the most expensive thing in this file, and the explored set only
 * grows, so the signature is its size plus the current sight. Rebuilding on
 * every sync would have made selecting a unit cost more than ending a turn.
 */
let fogSignature = '';

/**
 * The opening sees the whole world; the game does not.
 *
 * ⚠️ **Measured: the establishing shots were 73 to 82 percent black without
 * this.** The opening runs at turn one, when a player has explored 61 of 6,211
 * hexes, so "here is the world you are about to play" was in fact a small lit
 * patch in a void, and the widest, slowest, most expensive shot in the
 * sequence was the emptiest thing on screen.
 *
 * Lifting it for the film is not a cheat, it is the better reading of the
 * scene. The land rises out of nothing, whole, and then the fog falls on it
 * and you are left knowing only your own corner. That is the same order the
 * words are in.
 */
let revealingForOpening = false;

/**
 * The fog is off entirely, because somebody typed the code for it.
 *
 * ⚠️ **Separate from `revealingForOpening`, which lifts LESS than this.** The
 * opening lights the land and still hides every army on it, because an
 * establishing shot that showed all seven camps would give away the whole
 * scouting game before the first turn. This lifts both halves: the ground and
 * the things standing on it.
 *
 * ⚠️ **A view flag, not state.** Fog is the one feature whose entire content is
 * that something is NOT drawn, and there is nothing in the rules to change: the
 * engine's memory is untouched, so turning this off puts the player back
 * exactly where they were rather than having permanently learnt the map. The
 * code is still recorded in `cheatsUsed` and still lands on the victory screen,
 * which is the part that has to be permanent.
 */
let fogLifted = false;

/**
 * What the player has been shown so far, while a unit is walking.
 *
 * ⚠️ Undefined at every other moment, and that is deliberate: the fog agrees
 * with the rules unless something is actively being uncovered, so there is
 * exactly one short-lived window in which the view is allowed to lag.
 */
let walkReveal: { explored: ReadonlySet<string>; sight: ReadonlySet<string> } | undefined;

/**
 * How long one hex of a march takes.
 *
 * ⚠️ Slower than the old single glide of 260 ms for the whole move, because
 * the fog now uncovers per step and a step the eye cannot follow uncovers
 * ground the player never saw arrive. The fade in the fog shader runs 750 ms,
 * so a unit crossing several hexes leaves a trail of ground still opening
 * behind it, which is the intended reading: the fog thins where you have been.
 */
const STEP_MS = 240;

function refreshFog(): void {
  currentSight = sightOf(state, mySeat);

  if (revealingForOpening) {
    fogSignature = 'opening';
    scene.setFog([], []);
    dirty = true;
    return;
  }

  /*
   * ⚠️ Its own signature, not `revealingForOpening`'s. Sharing one would mean
   * turning the code off left the signature reading 'opening', the next
   * `refreshFog` would find it unchanged and return early, and the fog would
   * stay off until something else happened to move a unit.
   */
  if (fogLifted) {
    fogSignature = 'lifted';
    scene.setFog([], []);
    dirty = true;
    return;
  }

  /*
   * ⚠️ **The view can lag the rules, and during a walk it does.**
   *
   * The engine folds sight in at every hex a unit passes, so by the time
   * `moveUnit` returns, `state.explored` already contains the whole corridor.
   * Showing that immediately would uncover six hexes of ground the instant the
   * unit set off, while it is still standing at the near end of the march.
   *
   * `walkReveal`, when set, is what the player has been shown SO FAR: the
   * explored set as of the step the animation has actually reached. It is
   * cleared when the walk finishes, and the fog then agrees with the rules
   * again.
   */
  const explored = walkReveal?.explored ?? memoryOf(state, mySeat).explored;
  const sight = walkReveal?.sight ?? currentSight;

  const signature = `${explored.size}:${sight.size}:${state.seed}:${walkReveal ? 'w' : ''}`;
  if (signature === fogSignature) return;
  fogSignature = signature;

  const unseen: Hex[] = [];
  const remembered: Hex[] = [];
  for (const [key, tile] of state.map.tiles) {
    if (sight.has(key)) continue;
    if (explored.has(key)) remembered.push(tile.hex);
    else unseen.push(tile.hex);
  }

  scene.setFog(unseen, remembered);
  dirty = true;
}

function refreshCorruption(): void {  const next = new Set<string>();
  const hexes: Hex[] = [];

  /*
   * ⚠️ Two sources, and the first one was missing entirely.
   *
   * D56 says the Ungoverned Wastes are corrupted ground in their own right,
   * not only the tiles an antagonist has taken. Without the wastes the effect
   * would not appear at all until a faction founded a city, which none of them
   * currently do, so the whole thing would have stayed invisible on a second
   * count.
   */
  for (const tile of state.map.tiles.values()) {
    if (tile.terrain !== 'ungovernedWastes') continue;
    const key = hexKey(tile.hex);
    if (next.has(key)) continue;
    next.add(key);
    hexes.push(tile.hex);
  }

  const territory = cityTerritory(state);
  for (const [key, cityId] of territory) {
    const city = state.cities.get(cityId);
    // Any antagonist's ground is corrupted, not just the Silo Horde's. This
    // checked one hard-coded faction id and would have silently ignored the
    // other six the moment they took a city.
    if (!city || city.factionId === mySeat) continue;
    if (next.has(key)) continue;
    next.add(key);
    const hex = territoryHex(key);
    if (hex) hexes.push(hex);
  }

  corrupted = next;
  scene.setCorrupted(hexes);
}

/** Recover a hex from a map key, since city territory is keyed rather than typed. */
function territoryHex(key: string): Hex | undefined {
  return state.map.tiles.get(key)?.hex;
}

/**
 * How the 2D effects layer finds a hex on screen.
 *
 * The scale is measured rather than assumed: it is the on-screen distance
 * between a hex centre and a point one hex radius away, which is the only
 * honest answer under perspective, where two hexes at different depths are
 * different sizes.
 */
const projection = {
  project(hex: Hex) {
    const point = scene.groundAt(hex);
    return scene.project(point);
  },
  scaleAt(hex: Hex) {
    const centre = scene.groundAt(hex);
    const edge = centre.clone();
    edge.x += HEX_RADIUS;
    const a = scene.project(centre);
    const b = scene.project(edge);
    return Math.max(6, Math.hypot(b.x - a.x, b.y - a.y) * (BASE_HEX_SIZE / 48));
  },
};

/**
 * World-space offset for a unit that is mid-animation.
 *
 * The effects system works in the 2D layout the old renderer used, so the
 * offset comes back in those pixels and is converted here. Keeping the
 * conversion in one place means the animation code never has to know which
 * renderer is attached.
 */
function unitWorldOffset(unitId: string): { x: number; z: number } | undefined {
  const offset = effects.offsetOf(unitId);
  if (!offset) return undefined;
  return {
    x: (offset.x / BASE_HEX_SIZE) * HEX_RADIUS,
    z: (offset.y / BASE_HEX_SIZE) * HEX_RADIUS,
  };
}

function frame(now: number): void {
  const delta = Math.min(0.1, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  const animating = effects.update(now);
  const started = performance.now();

  // A duel drives the units through pose overrides, which only take effect
  // when the scene is reconciled. Reconciling only on `dirty` would freeze
  // the fight on its first frame.
  const fighting = scene.fx.active();

  if (dirty || animating || fighting) {
    scene.sync(state, {
      selectedUnitId,
      reachable: reach,
      attackTargets,
      settleSites: settleSuggestions.map((s) => s.hex),
      /*
       * ⚠️ Filtered against `state.explored`, not against current sight.
       *
       * A cache the Profiler walked past three turns ago is still there and
       * the player still knows it: gating on what is lit *now* would make
       * chests blink out the moment the unit moved on, which reads as them
       * being taken by someone else.
       */
      treasures: [...state.treasures.values()]
        .filter((chest) => memoryOf(state, mySeat).explored.has(hexKey(chest.hex)))
        .map((chest) => chest.hex),
      hover,
      unitOffset: unitWorldOffset,
      unitOpacity: (id) => effects.opacityOf(id),
      /*
       * ⚠️ `undefined` is how the scene is told there is no fog at all, which
       * is what the map editor and every scene test pass. Handing it the full
       * tile set instead would look identical and would cost a six thousand
       * entry lookup per unit, per town and per overlay, every frame.
       */
      visibleHexes: fogLifted ? undefined : currentSight,
      // Whose ghosts to draw. Per seat, so taking a chair does not inherit the
      // towns the previous occupant of this browser had found.
      seenCities: memoryOf(state, mySeat).seenCities,
    });
    dirty = false;
    refreshHud();
  }

  scene.render(delta, effects.shakeOffset());
  droneHud.update(scene.drone.telemetry());

  ctx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  if (animating) effects.draw(ctx, projection);

  frameMs = performance.now() - started;
  requestAnimationFrame(frame);
}

fitCanvas();
/*
 * ⚠️ The attract sequence runs BEFORE boot, and boot is deferred behind it.
 *
 * That ordering is the feature: the Enter card's click is the user gesture the
 * browser needs before any audio will play, so it unlocks the teaser's own
 * sound AND the anthem that follows. Running boot first would put the setup
 * screen underneath the film and start a game nobody has asked for yet.
 *
 * `run()` resolves whether the film played, was skipped, or was never there,
 * so a clone without the gitignored file simply arrives at the setup screen.
 */
void createAttract().run().then(boot);

/*
 * Save when the page goes away.
 *
 * `visibilitychange` rather than `beforeunload`: a phone or a tab that is
 * closed by the operating system often never fires `beforeunload` at all,
 * and `hidden` is the last moment guaranteed to arrive. Writing a few
 * kilobytes here is cheap enough that doing it on every tab switch does not
 * matter.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveGame(slot, state);
});
requestAnimationFrame(frame);
// Exposed for automated checks, so a test can assert the game actually plays
// rather than assuming a screenshot means success.
declare global {
  interface Window {
    __fabricEmpires?: {
      seed: () => string;
      turn: () => number;
      lastFrameMs: () => number;
      unitCount: (factionId: string) => number;
      factionUnits: (
        factionId: string,
      ) => { id: string; typeId: string; q: number; r: number; hp: number }[];
      seat: () => string;
      seats: () => {
        title: string;
        body: string;
        offers: { id: string; label: string; detail: string }[];
      };
      sitIn: (factionId: string) => { left: string; now: string };
      cityCount: () => number;
      cities: () => {
        id: string;
        factionId: string;
        q: number;
        r: number;
        hp: number;
        wallLevel: number;
        wallHp: number;
      }[];
      playerCityCount: () => number;
      resources: () => Record<string, number>;
      selected: () => string | undefined;
      unitById: (id: string) =>
        | {
            typeId: string;
            hp: number;
            movesLeft: number;
            movement: number;
            fortified: boolean;
          }
        | undefined;
      selectFirstIdle: () => void;
      hexAt: (x: number, y: number) => Hex;
      screenOf: (hex: Hex) => { x: number; y: number };
      reachableCount: () => number;
      reachableHexes: () => { q: number; r: number; cost: number }[];
      drone: () => {
        engaged: boolean;
        camera: { x: number; y: number; z: number };
        target: { x: number; y: number; z: number };
        speedMs: number;
        altitudeM: number;
        aglM: number | null;
        headingDeg: number;
        cruiseMs: number;
      };
      faceNorth: () => void;
      saveNow: () => boolean;
      savedBytes: () => number;
      wipeSave: () => void;
      unitHex: (unitId: string) => Hex | undefined;
      research: () => {
        known: number;
        total: number;
        current: string | undefined;
        currentLabel: string | undefined;
        progress: number;
        options: { id: string; label: string; cluster: string; cost: number }[];
      };
      startResearch: (topicId: string) => boolean;
      grantCompute: (amount: number) => void;
      cityBindings: () => Record<string, readonly string[]>;
      expireReviews: () => number;
      masterySummary: () => Record<string, number>;
      readiness: () => number;
      proctorReady: () => boolean;
      faceProctor: () => Promise<void>;
      studyAll: (times: number) => void;
      answerOpen: (correct?: boolean) => Promise<string | undefined>;
      openQuestion: () => Promise<
        { id: string; isOpen: boolean; options: number; accepted: number[] } | undefined
      >;
      terrainProbe: () => unknown;
      vision: () => {
        total: number;
        explored: number;
        visible: number;
        hidden: number;
      };
      cheatsUsed: () => string[];
      exploredCount: () => number;
      /**
       * Every buried cache still on the map, and whether it can be seen.
       *
       * Exists because a cache is otherwise unobservable from outside: it is
       * hidden until explored, it is only triggered by one unit type, and a
       * game can run for an hour without meeting one. A test that cannot find
       * a cache cannot check that finding one works.
       */
      treasures: () => {
        id: string;
        q: number;
        r: number;
        resource: string;
        amount: number;
        explored: boolean;
      }[];
      /**
       * Towns the player remembers, and whether each is currently in sight.
       *
       * Exists because a memory is otherwise invisible from outside: the whole
       * point is that it survives the fog, and "survives the fog" is precisely
       * the state no screenshot can distinguish from "was never recorded".
       */
      seenCities: () => {
        q: number;
        r: number;
        name: string;
        factionId: string;
        turnSeen: number;
        inSight: boolean;
      }[];
      drownedLand: () => { land: number; below: number; share: number };
      /**
       * The live three.js objects.
       *
       * Present so a lighting question can be answered by toggling one thing
       * at a time in a running page instead of by editing, rebuilding and
       * re-photographing for every hypothesis. Diagnosing the terrain by
       * screenshot alone cost several wrong guesses in a row.
       */
      gfx: () => unknown;
      /**
       * Put the camera on a hex at a given distance, immediately.
       *
       * For photographing one village or one unit close up. Judging a model
       * from the map camera is judging a thing four hundred pixels away.
       */
      look: (hex: Hex, distance?: number) => void;
      playOpening: () => Promise<void>;
      anthemReady: () => boolean;
      /** Seconds into the anthem, or 0 when it is not playing. */
      anthemTime: () => number;
      /**
       * What the background score is doing.
       *
       * ⚠️ The player builds detached `Audio` objects, so a check running in
       * the page cannot find them with a DOM query and has no other way to
       * tell music from silence. Reported here rather than inferred.
       */
      music: () => {
        available: boolean;
        muted: boolean;
        playing: string | undefined;
        volume: number;
      };
      /**
       * Render a cinematic's cue without playing it, and measure it.
       *
       * ⚠️ The unit tests can check which note sounds when and can never
       * check that the graph makes a sound, because WebAudio does not exist
       * under test. This renders the real code into an `OfflineAudioContext`
       * and returns the peak and RMS of the samples, which is the difference
       * between "the cue was scheduled" and "the cue is audible".
       */
      renderCue: (id: string) => Promise<{ peak: number; rms: number; seconds: number }>;
      setRank: (
        rank: string,
        population: number,
      ) => { rank: string; population: number; label: string } | undefined;
      showcase: (typeIds: string[], centre: Hex) => string[];
      quality: (level: 'high' | 'low') => void;
      spawnEnemyAdjacent: (unitId: string) => Hex | undefined;
      besiegeMyCity: (cityId?: string) => Hex | undefined;
      hurtCity: (cityId: string, hp: number) => number | undefined;
      plantWalledCity: (unitId: string, wallLevel?: number, wallHp?: number) => Hex | undefined;
      clickHex: (hex: Hex) => void;
      endTurn: () => Promise<void>;
    };
  }
}

window.__fabricEmpires = {
  seed: () => state.seed,
  turn: () => state.turn,
  lastFrameMs: () => frameMs,
  unitCount: (factionId: string) => unitsOf(state, factionId).length,
  // ⚠️ Every settlement on the map, the player's and all seven villages. It
  // used to be the same number as the player's because nobody else had a city.
  cityCount: () => state.cities.size,
  /**
   * Every settlement, flattened, walls included.
   *
   * ⚠️ Added because antagonist fortification was untestable from a browser:
   * the engine could prove a wall went up, and nothing outside it could see
   * one. A rule that cannot be observed in the running game is a rule nobody
   * will notice breaking.
   */
  cities: () =>
    [...state.cities.values()].map((c) => ({
      id: c.id,
      factionId: c.factionId,
      q: c.hex.q,
      r: c.hex.r,
      hp: c.hp,
      wallLevel: c.wallLevel,
      wallHp: c.wallHp,
    })),
  playerCityCount: () =>
    [...state.cities.values()].filter((c) => c.factionId === mySeat).length,
  resources: () => ({ ...state.factions.get(mySeat)!.resources }),
  selected: () => selectedUnitId,
  /**
   * One unit, flattened.
   *
   * ⚠️ A fortified unit is deliberately skipped by next-idle cycling, so the
   * selection panel cannot be steered back onto it and a browser check has no
   * other way to ask what happened to it across a turn.
   */
  unitById: (id: string) => {
    const unit = state.units.get(id);
    return unit
      ? {
          typeId: unit.typeId,
          hp: unit.hp,
          movesLeft: unit.movesLeft,
          movement: unitType(unit.typeId).movement,
          fortified: unit.fortified,
        }
      : undefined;
  },
  selectFirstIdle: () => selectNextIdle(),
  hexAt: (x, y) => scene.hexAt(x, y) ?? { q: 0, r: 0 },
  screenOf: (hex) => scene.project(scene.groundAt(hex)),
  reachableCount: () => reach?.size ?? 0,
  reachableHexes: () =>
    [...(reach?.values() ?? [])].map((entry) => ({
      q: entry.hex.q,
      r: entry.hex.r,
      cost: entry.cost,
    })),
  drone: () => {
    const t = scene.drone.telemetry();
    const cam = scene.world.camera.position;
    const target = scene.drone.orbitTarget();
    return {
      engaged: t.engaged,
      camera: { x: cam.x, y: cam.y, z: cam.z },
      target: { x: target.x, y: target.y, z: target.z },
      speedMs: t.speedMs,
      altitudeM: t.altitudeM,
      aglM: t.aglM,
      headingDeg: t.headingDeg,
      cruiseMs: t.cruiseMs,
    };
  },
  faceNorth: () => scene.drone.faceNorth(),
  readiness: () => libraryModel().examRetained,
  proctorReady: () => proctorReady(libraryModel()),
  faceProctor: () => faceTheProctor(),
  /**
   * Answer every topic correctly, repeatedly.
   *
   * Reaching the Proctor honestly means researching and revising most of the
   * outline, which is many turns. This is the only way an automated check can
   * reach the endgame at all.
   */
  studyAll: (times: number) => {
    recordHarnessGrant('studyAll');
    for (let i = 0; i < times; i++) {
      for (const node of state.topics.nodes) mastery.record(node.id, 1, false);
    }
    refreshReadiness();
  refreshThreats();
  },
  factionUnits: (factionId: string) =>
    unitsOf(state, factionId).map((u) => ({
      id: u.id,
      typeId: u.typeId,
      q: u.hex.q,
      r: u.hex.r,
      hp: u.hp,
    })),
  /*
   * The empire table, and the seat this browser is playing.
   *
   * ⚠️ Exposed because the alternative is driving a modal to find out whether
   * the fog actually changed hands, and "the panel said something" is not
   * evidence that the memory moved. `seat()` plus `vision()` together are.
   */
  seat: () => mySeat,
  seats: () => {
    const table = seatTable(state, mySeat);
    return {
      title: table.title,
      body: table.body,
      offers: table.offers.map((o) => ({ id: o.id, label: o.label, detail: o.detail })),
    };
  },
  /** Sit down in a vacant empire, exactly as the panel does. */
  sitIn: (factionId: string) => {
    const before = mySeat;
    state = takeSeat(vacateSeat(state, mySeat), factionId);
    state = { ...state, activeFactionId: factionId };
    mySeat = factionId;
    selectedUnitId = undefined;
    reach = undefined;
    attackTargets = undefined;
    settleSuggestions = [];
    dirty = true;
    refreshHud();
    saveGame(slot, state);
    return { left: before, now: mySeat };
  },
  saveNow: () => saveGame(slot, state),
  savedBytes: () => slot.read()?.length ?? 0,
  wipeSave: () => slot.clear(),
  unitHex: (unitId: string) => state.units.get(unitId)?.hex,
  research: () => {
    const current = state.research.current;
    const node = current ? topicById(state.topics, current) : undefined;
    return {
      known: state.research.known.length,
      total: state.topics.nodes.length,
      current,
      currentLabel: node?.label,
      progress: state.research.progress,
      options: researchable(state).map((o) => ({
        id: o.id,
        label: o.label,
        cluster: o.cluster,
        cost: researchCost(o),
      })),
    };
  },
  startResearch: (topicId: string) => {
    const result = startResearch(state, topicId);
    if (!result.ok) return false;
    state = result.state;
    refreshResearch();
    return true;
  },
  grantCompute: (amount: number) => {
    // Test affordance: skip the twenty turns of economy it would otherwise
    // take to fund a topic.
    recordHarnessGrant('grantCompute');
    const factions = new Map(state.factions);
    const player = factions.get(mySeat)!;
    factions.set(mySeat, {
      ...player,
      resources: { ...player.resources, compute: player.resources.compute + amount },
    });
    state = { ...state, factions };
    refreshHud();
  },
  terrainProbe: () => ({ ...scene.probe(), ...scene.stats() }),
  /**
   * What the player can currently see, and what they remember.
   *
   * ⚠️ Fog is the one feature whose whole point is that things are NOT drawn,
   * so "it looks right" is not evidence and a screenshot cannot count. These
   * are the numbers a test can assert on.
   */
  vision: () => ({
    total: state.map.tiles.size,
    explored: memoryOf(state, mySeat).explored.size,
    visible: currentSight.size,
    hidden: state.map.tiles.size - memoryOf(state, mySeat).explored.size,
  }),
  cheatsUsed: () => [...state.cheatsUsed],
  exploredCount: () => memoryOf(state, mySeat).explored.size,
  treasures: () =>
    [...state.treasures.values()].map((chest) => ({
      id: chest.id,
      q: chest.hex.q,
      r: chest.hex.r,
      resource: chest.resource,
      amount: chest.amount,
      explored: memoryOf(state, mySeat).explored.has(hexKey(chest.hex)),
    })),
  seenCities: () =>
    [...memoryOf(state, mySeat).seenCities.values()].map((seen) => ({
      q: seen.hex.q,
      r: seen.hex.r,
      name: seen.name,
      factionId: seen.factionId,
      turnSeen: seen.turnSeen,
      inSight: currentSight.has(hexKey(seen.hex)),
    })),
  /*
   * How much of the land is drawn under the sea.
   *
   * ⚠️ The map and the render can disagree, and when they do it is the render
   * that the player believes. The generator can report one compact continent
   * while the screen shows thin ribbons, because a land tile whose surface
   * ends up below the water plane simply is not land any more as far as anyone
   * looking at it is concerned. Nothing measured this before.
   */
  drownedLand: () => {
    let land = 0;
    let below = 0;
    for (const tile of state.map.tiles.values()) {
      if (tile.terrain === 'onelake') continue;
      land += 1;
      if (scene.groundAt(tile.hex).y <= SEA_LEVEL) below += 1;
    }
    return { land, below, share: land === 0 ? 0 : +(below / land).toFixed(3) };
  },

  cityBindings: () => {
    const out: Record<string, readonly string[]> = {};
    for (const city of state.cities.values()) out[city.name] = city.boundSkills;
    return out;
  },

  /**
   * Test affordance: make every bound topic fall due immediately.
   *
   * Built from the tracker's public API by recording a review far enough in
   * the past that any interval has elapsed. Waiting out a real interval in a
   * test would mean either a slow test or a fake clock, and a fake clock
   * would stop the test proving that the real wiring works.
   */
  expireReviews: () => {
    recordHarnessGrant('expireReviews');
    const longAgo = Date.now() - 400 * DAY_MS;
    let touched = 0;
    for (const city of state.cities.values()) {
      for (const topicId of city.boundSkills) {
        mastery.record(topicId, 1, false, longAgo);
        touched += 1;
      }
    }
    refreshSelection();
    return touched;
  },

  masterySummary: () => mastery.summary(state.topics.nodes.map((n) => n.id)),

  /**
   * Answer whatever question is on screen, correctly or deliberately wrongly.
   *
   * Needed because an automated run otherwise cannot get past research at
   * all: the right answer is only revealed after submitting, and the retry
   * next turn is a different question, so blind clicking never converges. The
   * option is found the same way the player's click is judged, by hashing it,
   * so this proves the real path rather than bypassing it.
   *
   * Returns the option that was chosen, or undefined if nothing is open.
   */
  answerOpen: async (correct = true) => answerCurrentQuestion(correct),

  /**
   * What the answer check makes of the question currently on screen.
   *
   * `answerOpen` returning undefined has two very different causes: no modal,
   * or a modal whose options all fail the hash check. The second would mean
   * the shipped question bank and the shipped hashes disagree, which is a
   * content bug that no screenshot could ever show.
   */
  openQuestion: async () => {
    const question = modal.current();
    if (!question) return undefined;
    const options = question.options ?? [];
    const accepted: number[] = [];
    for (let i = 0; i < options.length; i++) {
      if (await checkAnswer(question.id, options[i]!, question.answerHash)) accepted.push(i);
    }
    return { id: question.id, isOpen: modal.isOpen(), options: options.length, accepted };
  },

  gfx: () => scene.world,
  look: (hex: Hex, distance = 8) => scene.focusWorld(scene.groundAt(hex), distance),
  /** Replay the opening. Exists so the trailer can be recorded from the game. */
  playOpening: () => playOpening(),
  anthemReady: () => anthem.available,
  anthemTime: () => anthem.at,
  music: () => ({
    available: music.available,
    muted: music.muted,
    playing: music.nowPlaying,
    volume: music.volume,
  }),
  renderCue: async (id: string) => {
    const seconds = 8;
    const rate = 44_100;
    const offline = new OfflineAudioContext(2, rate * seconds, rate);
    createCues(() => offline).play(id);
    const rendered = await offline.startRendering();
    const data = rendered.getChannelData(0);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const v = Math.abs(data[i]!);
      if (v > peak) peak = v;
      sum += data[i]! * data[i]!;
    }
    return { peak, rms: Math.sqrt(sum / data.length), seconds };
  },
  /**
   * Force the player's first settlement to a rank.
   *
   * For photographing all five without playing a whole game to reach the last
   * one. Sets population too, because a rank with the wrong number of people
   * in it would be a picture of a state the rules cannot produce.
   */
  setRank: (rank: string, population: number) => {
    recordHarnessGrant('setRank');
    const city = [...state.cities.values()].find((c) => c.factionId === mySeat);
    if (!city) return undefined;
    const cities = new Map(state.cities);
    cities.set(city.id, { ...city, rank: rank as CityRank, population });
    state = { ...state, cities };
    dirty = true;
    return { rank, population, label: rankInfo(rank as CityRank).label };
  },
  quality: (level: 'high' | 'low') => {
    scene.setQuality(level === 'low' ? LOW_QUALITY : HIGH_QUALITY);
    fitCanvas();
  },
  /**
   * Line up one unit of each type on neighbouring hexes.
   *
   * For photographing the roster side by side. Comparing two units by playing
   * until you own both takes a whole game, and "do these read as different
   * things" is a question about a single frame.
   */
  showcase: (typeIds: string[], centre: Hex) => {
    recordHarnessGrant('showcase');
    const units = new Map(state.units);
    for (const [id, u] of units) if (u.factionId === mySeat) units.delete(id);

    const placed: string[] = [];
    let next = state.nextEntityId;
    for (const [i, typeId] of typeIds.entries()) {
      const hex = i === 0 ? centre : hexNeighbour(centre, (i - 1) % 6);
      const tile = state.map.tiles.get(hexKey(hex));
      if (!tile || tile.terrain === 'onelake') continue;
      const id = `showcase-${next++}`;
      units.set(id, {
        id,
        typeId: typeId as Unit['typeId'],
        factionId: mySeat,
        hex,
        hp: 100,
        movesLeft: 2,
        fortified: false,
      });
      placed.push(`${typeId}@${hex.q},${hex.r}`);
    }
    state = { ...state, units, nextEntityId: next };
    dirty = true;
    return placed;
  },

  spawnEnemyAdjacent: (unitId: string) => {
    // Test affordance: put a hostile next door so the combat choreography
    // can be exercised without marching across the continent first.
    recordHarnessGrant('spawnEnemyAdjacent');
    const unit = state.units.get(unitId);
    if (!unit) return undefined;
    for (let d = 0; d < 6; d++) {
      const hex = hexNeighbour(unit.hex, d);
      const tile = state.map.tiles.get(hexKey(hex));
      if (!tile || tile.terrain === 'onelake' || tile.terrain === 'semanticPeaks') continue;
      if (unitAt(state, hex) || cityAt(state, hex)) continue;
      const id = `test-foe-${state.nextEntityId}`;
      const units = new Map(state.units);
      units.set(id, {
        id,
        typeId: 'pipelineRunner',
        factionId: ANTAGONIST_FACTION_ID,
        hex,
        hp: 100,
        movesLeft: 0,
        fortified: false,
      });
      state = { ...state, units, nextEntityId: state.nextEntityId + 1 };
      refreshSelection();
      dirty = true;
      return hex;
    }
    return undefined;
  },
  besiegeMyCity: (cityId?: string) => {
    /*
     * Test affordance: a hostile next to one of YOUR towns, ready to strike.
     *
     * ⚠️ Added because the defender's side of a siege could not be staged at
     * all. `spawnEnemyAdjacent` takes a unit, and `plantWalledCity` plants an
     * *enemy* town: both exist to exercise the player as the ATTACKER. There
     * was no way to make the AI come at a town of yours, so the stance dialog,
     * which is now the one thing that only appears when a town is attacked,
     * could be reasoned about but not watched. Measured: fourteen turns of
     * ending the turn next to a hostile city produced no raid on my own.
     *
     * That is the exact complaint the docblock below already records about
     * assault tactics, seen from the other side of the wall.
     *
     * `movesLeft: 1` rather than 0, unlike `spawnEnemyAdjacent`: this one has
     * to be able to act in the enemy phase that follows, or it just stands
     * there and the siege never happens.
     */
    recordHarnessGrant('besiegeMyCity');
    const city = cityId
      ? state.cities.get(cityId)
      : [...state.cities.values()].find((c) => c.factionId === mySeat);
    if (!city || city.factionId !== mySeat) return undefined;

    for (let d = 0; d < 6; d++) {
      const hex = hexNeighbour(city.hex, d);
      const tile = state.map.tiles.get(hexKey(hex));
      if (!tile || tile.terrain === 'onelake' || tile.terrain === 'semanticPeaks') continue;
      if (unitAt(state, hex) || cityAt(state, hex)) continue;
      const id = `test-siege-${state.nextEntityId}`;
      const units = new Map(state.units);
      units.set(id, {
        id,
        typeId: 'pipelineRunner',
        factionId: ANTAGONIST_FACTION_ID,
        hex,
        hp: 100,
        movesLeft: 1,
        fortified: false,
      });
      state = { ...state, units, nextEntityId: state.nextEntityId + 1 };
      refreshSelection();
      dirty = true;
      return hex;
    }
    return undefined;
  },
  hurtCity: (cityId: string, hp: number) => {
    /*
     * Test affordance: put a town at a chosen health.
     *
     * ⚠️ Added because a damaged city could not be produced on demand at all,
     * and the health bar only exists when one is. The honest routes are an
     * assault, which needs an army the harness cannot conjure in a turn, or an
     * AI siege, which section 91 records as not happening. So the one visual
     * this feature ships could be reasoned about and never looked at, which is
     * the complaint `plantWalledCity` was written to answer for walls.
     *
     * Clamped to the real ceiling rather than trusting the caller: a bar drawn
     * from a fraction above 1 or below 0 renders as a glitch instead of as a
     * wrong number, which is the harder thing to notice.
     */
    recordHarnessGrant('hurtCity');
    const city = state.cities.get(cityId);
    if (!city) return undefined;
    const full = maxCityHp(city);
    const next = Math.max(0, Math.min(full, Math.round(hp)));
    const cities = new Map(state.cities);
    cities.set(cityId, { ...city, hp: next });
    state = { ...state, cities };
    refreshCities();
    refreshSelection();
    dirty = true;
    return next;
  },
  plantWalledCity: (unitId: string, wallLevel = MAX_WALL_LEVEL, wallHp?: number) => {
    /*
     * Test affordance: a walled enemy city, next door.
     *
     * ⚠️ Added because the assault tactics could not be exercised at all. They
     * only appear against a city that has walls, and in a real game the nearest
     * enemy town is a dozen hexes away and unwalled until the AI has finished
     * its army. Section 59 shipped the whole feature with the dialog never once
     * opened in a browser, which is the third time this plan has recorded a
     * rule that was proven in the engine and never seen where it runs.
     */
    recordHarnessGrant('plantWalledCity');
    const unit = state.units.get(unitId);
    if (!unit) return undefined;
    for (let d = 0; d < 6; d++) {
      const hex = hexNeighbour(unit.hex, d);
      const tile = state.map.tiles.get(hexKey(hex));
      if (!tile || tile.terrain === 'onelake' || tile.terrain === 'semanticPeaks') continue;
      if (unitAt(state, hex) || cityAt(state, hex)) continue;

      const level = Math.max(0, Math.min(MAX_WALL_LEVEL, Math.round(wallLevel)));
      const id = `test-fort-${state.nextEntityId}`;
      const cities = new Map(state.cities);
      cities.set(id, {
        id,
        factionId: ANTAGONIST_FACTION_ID,
        hex,
        name: 'Bastion',
        kind: 'workspace',
        hp: 200,
        wallLevel: level,
        // ⚠️ An override so a **breached** wall can be planted directly. The
        // rule that sap is useless once the breach is open only applies at
        // `wallHp === 0`, and reaching that through the interface means
        // battering a wall down one blow and one question at a time.
        wallHp: wallHp === undefined ? maxWallHp(level) : Math.max(0, Math.min(maxWallHp(level), wallHp)),
        population: 3,
        rank: 'siedlung',
        growthStore: 0,
        boundSkills: [],
        unrest: 0,
        ignoredReviews: 0,
        reviewBonusUntilTurn: 0,
        lastReviewTurn: -1,
        productionProgress: 0,
        lastRaidedTurn: -1,
      });
      state = { ...state, cities, nextEntityId: state.nextEntityId + 1 };
      refreshCities();
      refreshSelection();
      dirty = true;
      return hex;
    }
    return undefined;
  },
  clickHex: (hex) => void actOn(hex),
  endTurn: () => doEndTurn(),
};
