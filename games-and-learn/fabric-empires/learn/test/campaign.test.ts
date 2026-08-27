/**
 * Campaigns.
 *
 * ⚠️ **These tests are the D35 claim, written down as assertions.** The engine
 * has always said it is a complete strategy game that knows nothing about
 * certifications, and until there was a second subject that was an untested
 * belief. What is checked here is not that DP-600 works, which the rest of the
 * suite covers, but that the things a SECOND campaign will depend on are real:
 * that the engine needs no knowledge of the subject, that a campaign long
 * enough to unlock every unit is required rather than hoped for, and that the
 * join between an outline's clusters and its factions is validated rather than
 * assumed.
 */

import { describe, expect, it } from 'vitest';
import {
  buildableUnits,
  createGameState,
  minimumTopicCount,
  unitsOf,
  PLAYER_FACTION_ID,
  UNIT_TYPES,
  UNIT_TYPE_IDS,
  type AntagonistDefinition,
} from '@fabric-empires/engine';
import {
  CAMPAIGNS,
  DEFAULT_CAMPAIGN_ID,
  DP600_CAMPAIGN,
  KLASSE1_CAMPAIGN,
  campaignById,
  topicsFor,
  validateCampaign,
  type Campaign,
} from '../src/index.js';

describe('the campaign registry', () => {
  it('has a default that exists', () => {
    expect(campaignById(DEFAULT_CAMPAIGN_ID)).toBeDefined();
  });

  it('gives every campaign a unique id', () => {
    const ids = CAMPAIGNS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns nothing for an unknown id rather than throwing', () => {
    expect(campaignById('klasse-99')).toBeUndefined();
  });

  it('validates every shipped campaign', () => {
    for (const campaign of CAMPAIGNS) {
      expect(validateCampaign(campaign), campaign.id).toEqual([]);
    }
  });
});

describe('⚠️ the unit ladder, which used to be a floor', () => {
  it('is computed from the unit table, not written down', () => {
    const highest = Object.values(UNIT_TYPES).reduce(
      (most, type) => Math.max(most, type.unlockedBySkill ?? 0),
      0,
    );
    expect(minimumTopicCount()).toBe(highest);
    // If this ever drops to zero the scaling below becomes meaningless.
    expect(minimumTopicCount()).toBeGreaterThan(0);
  });

  it('is met exactly by the shipped campaign, which is why it was invisible', () => {
    /*
     * ⚠️ These two numbers being EQUAL is the whole story. DP-600 has 41
     * topics and the last unit unlocks at 41, so reading `unlockedBySkill` as
     * a literal index worked, and worked only by coincidence.
     */
    expect(topicsFor(DP600_CAMPAIGN).nodes.length).toBe(minimumTopicCount());
  });

  it('⚠️ no longer rejects a campaign shorter than the ladder', () => {
    /*
     * This test used to assert the opposite, and asserting the opposite was
     * correct at the time: units unlocked at a literal index, so a short
     * curriculum really did have unit unlocks that could never fire.
     *
     * `unitUnlocked` now scales the ladder onto whatever length the campaign
     * has, so the reason is gone. The validator went on enforcing it anyway,
     * one package away from the change, and would have kept a Year 1
     * curriculum permanently invalid for a fault it no longer had.
     *
     * Measured before the check was removed: a 24-topic curriculum with every
     * topic known reaches 12 of 12 units, exactly as a 41-topic one does.
     */
    const short: Campaign = {
      ...DP600_CAMPAIGN,
      id: 'too-short',
      outline: {
        ...DP600_CAMPAIGN.outline,
        branches: DP600_CAMPAIGN.outline.branches.slice(0, 1),
      },
      antagonists: DP600_CAMPAIGN.antagonists.filter((a) =>
        DP600_CAMPAIGN.outline.branches[0]?.clusters.some((c) => c.id === a.topicCluster),
      ),
    };
    expect(topicsFor(short).nodes.length).toBeLessThan(minimumTopicCount());
    expect(validateCampaign(short).join(' ')).not.toContain('unit unlock');
    expect(validateCampaign(short)).toEqual([]);
  });
});

describe('the outline and the factions must agree', () => {
  const roster = (over: Partial<AntagonistDefinition>[]): AntagonistDefinition[] =>
    DP600_CAMPAIGN.antagonists.map((a, i) => ({ ...a, ...(over[i] ?? {}) }));

  it('complains when a faction quizzes on a cluster that does not exist', () => {
    const broken: Campaign = {
      ...DP600_CAMPAIGN,
      id: 'renamed',
      antagonists: roster([{ topicCluster: 'Z9' }]),
    };
    const problems = validateCampaign(broken).join(' ');
    expect(problems).toContain('Z9');
    expect(problems).toContain('does not define');
  });

  it('complains when a cluster has no faction to hold it', () => {
    const broken: Campaign = {
      ...DP600_CAMPAIGN,
      id: 'orphan',
      antagonists: DP600_CAMPAIGN.antagonists.slice(0, -1),
    };
    expect(validateCampaign(broken).join(' ')).toContain('no faction holds');
  });

  it('complains when a cluster has no questions', () => {
    const broken: Campaign = {
      ...DP600_CAMPAIGN,
      id: 'unasked',
      questions: DP600_CAMPAIGN.questions.filter((q) => q.cluster !== 'B1'),
    };
    expect(validateCampaign(broken).join(' ')).toContain('B1 has no questions');
  });
});

describe('the exam settings are per campaign', () => {
  it('rejects an exam of no questions', () => {
    const broken: Campaign = {
      ...DP600_CAMPAIGN,
      id: 'empty-exam',
      exam: { ...DP600_CAMPAIGN.exam, length: 0 },
    };
    expect(validateCampaign(broken).join(' ')).toContain('not an exam');
  });

  it('rejects a pass mark that is not a share', () => {
    for (const passMark of [0, 1.5, -0.2]) {
      const broken: Campaign = {
        ...DP600_CAMPAIGN,
        id: 'bad-mark',
        exam: { ...DP600_CAMPAIGN.exam, passMark },
      };
      expect(validateCampaign(broken).join(' '), String(passMark)).toContain('pass mark');
    }
  });
});

describe('⚠️ the engine takes a roster it knows nothing about', () => {
  /*
   * The whole point. These factions quiz on clusters from an invented
   * curriculum, and the engine places them, gives them villages and fights
   * them without any idea what subject it is teaching.
   */
  const GERMAN_ROSTER: AntagonistDefinition[] = [
    { id: 'zahlendreher', label: 'Die Zahlendreher', topicCluster: 'M1', colour: '#b5533f', seat: 'Zahlenburg', seatKind: 'lakehouse' },
    { id: 'silbenschlucker', label: 'Die Silbenschlucker', topicCluster: 'D1', colour: '#4f7f7a', seat: 'Silbenhain', seatKind: 'eventhouse' },
    { id: 'punktvergesser', label: 'Die Punktvergesser', topicCluster: 'D2', colour: '#8a6fb0', seat: 'Satzende', seatKind: 'warehouse' },
  ];

  it('spawns a roster the engine has never seen', () => {
    const state = createGameState('KLASSE1', { antagonists: GERMAN_ROSTER });

    expect([...state.factions.keys()]).toHaveLength(GERMAN_ROSTER.length + 1);
    for (const antagonist of GERMAN_ROSTER) {
      expect(state.factions.get(antagonist.id)?.label).toBe(antagonist.label);
      expect(state.factions.get(antagonist.id)?.topicCluster).toBe(antagonist.topicCluster);
    }
  });

  it('gives each of them a village with the name the campaign chose', () => {
    const state = createGameState('KLASSE1', { antagonists: GERMAN_ROSTER });
    const seats = [...state.cities.values()].map((c) => c.name).sort();
    expect(seats).toEqual(['Satzende', 'Silbenhain', 'Zahlenburg']);
  });

  it('still lets the player choose a subset of that roster', () => {
    const state = createGameState('KLASSE1', {
      antagonists: GERMAN_ROSTER,
      antagonistIds: ['zahlendreher'],
    });
    expect([...state.factions.keys()]).toHaveLength(2);
    expect(state.factions.has('zahlendreher')).toBe(true);
  });

  it('leaves the player exactly as they always were', () => {
    // A different curriculum must not change how a game starts.
    const german = createGameState('FABRIC', { antagonists: GERMAN_ROSTER });
    const normal = createGameState('FABRIC');
    expect(unitsOf(german, PLAYER_FACTION_ID).map((u) => u.typeId)).toEqual(
      unitsOf(normal, PLAYER_FACTION_ID).map((u) => u.typeId),
    );
  });

  it('falls back to the built-in roster when handed an empty one', () => {
    // Better a normal game than a world with nobody in it.
    const state = createGameState('FABRIC', { antagonists: [] });
    expect([...state.factions.keys()].length).toBeGreaterThan(1);
  });
});

describe('⚠️ a course is not a world', () => {
  /*
   * Both names exist because they are read in different places and only one
   * of them answers "what am I being asked about". DP-600's world is called
   * Fabric Empires, which is a fine name for a world and tells a player
   * nothing when it sits on a seat beside "1. Klasse: Mathe und Deutsch".
   */
  it('names the subject on every campaign', () => {
    for (const campaign of CAMPAIGNS) {
      expect(campaign.course.trim(), campaign.id).not.toBe('');
    }
  });

  it('gives the two seats labels a player can tell apart', () => {
    const courses = CAMPAIGNS.map((c) => c.course);
    expect(new Set(courses).size).toBe(courses.length);
  });

  it('says which certification the DP-600 course is', () => {
    // The submission is a DP-600 study aid, so the exam code has to appear.
    expect(DP600_CAMPAIGN.course).toContain('DP-600');
  });
});

describe('⚠️ the second seat', () => {
  const klasse1 = campaignById('klasse1');

  it('is registered', () => {
    expect(klasse1).toBeDefined();
  });

  it('⚠️ builds a world of its own, not just a question bank', () => {
    /*
     * It used to be `role: 'questions'`, and the comment here used to explain
     * that the exemption WAS the feature. It was, while two things were true:
     * the unit ladder was a literal index that a 24-topic curriculum could
     * never climb, and the app built every world from DP-600 whatever the
     * setup screen said. Both are fixed, so the exemption became the only
     * thing standing between a six-year-old and their own empire.
     */
    expect(klasse1?.role).toBe('world');
    expect(klasse1?.antagonists).toHaveLength(7);
  });

  it('⚠️ is a shorter curriculum than the ladder, and valid anyway', () => {
    expect(validateCampaign(klasse1!)).toEqual([]);
    expect(topicsFor(klasse1!).nodes.length).toBeLessThan(minimumTopicCount());
  });

  it('fields one faction per cluster, each named for its own mistake', () => {
    const clusters = klasse1!.outline.branches.flatMap((b) => b.clusters.map((c) => c.id));
    const held = klasse1!.antagonists.map((a) => a.topicCluster);
    expect([...held].sort()).toEqual([...clusters].sort());
    // Distinct ids, distinct seats, or the engine places two factions in one
    // village and the second silently wins.
    expect(new Set(klasse1!.antagonists.map((a) => a.id)).size).toBe(7);
    expect(new Set(klasse1!.antagonists.map((a) => a.seat)).size).toBe(7);
  });

  it('⚠️ names its factions in German, like the rest of the course', () => {
    // A child reading "The Silo Horde" in a German maths game is being asked
    // to do the one thing this campaign exists to avoid.
    for (const antagonist of klasse1!.antagonists) {
      expect(antagonist.label, antagonist.id).toMatch(/^Die /);
    }
  });

  it('asks in German', () => {
    expect(klasse1?.language).toBe('de');
  });

  it('asks a six-year-old a shorter question than an exam candidate', () => {
    // D216: a stem has to be readable by somebody still learning to read.
    for (const question of klasse1!.questions) {
      expect(question.stem.length, question.stem).toBeLessThanOrEqual(60);
    }
    const longest = Math.max(...DP600_CAMPAIGN.questions.map((q) => q.stem.length));
    expect(longest).toBeGreaterThan(60);
  });

  it('gives them a gentler paper than the real certification', () => {
    expect(klasse1!.exam.length).toBeLessThan(DP600_CAMPAIGN.exam.length);
    expect(klasse1!.exam.questionMs).toBeGreaterThan(DP600_CAMPAIGN.exam.questionMs);
  });

  it('covers both subjects rather than only the maths', () => {
    const branches = new Set(klasse1!.questions.map((q) => q.cluster[0]));
    expect([...branches].sort()).toEqual(['D', 'M']);
  });
});

describe('⚠️ a second world, built end to end', () => {
  /*
   * The claim this whole file exists to test, finally testable.
   *
   * Until now there was exactly one campaign that could build a world, so
   * "the engine knows nothing about the subject" was a belief supported by
   * the fact that nothing had ever contradicted it. A DP-600 world and a
   * DP-600 world agree about everything.
   *
   * ⚠️ It also covers a live bug in the app: `newGame` passed only
   * `antagonistIds` and let the engine fall back to its built-in roster, so a
   * Klasse 1 game would have been fought against The Silo Horde in English.
   * Passing the DEFINITIONS is what makes the world actually change.
   */
  const world = (campaign: Campaign) =>
    createGameState('KLASSE1', {
      topics: topicsFor(campaign),
      antagonists: campaign.antagonists,
      antagonistIds: campaign.antagonists.map((a) => a.id),
    });

  it('fields the German factions, not the Fabric ones', () => {
    const state = world(KLASSE1_CAMPAIGN);
    const labels = [...state.factions.values()]
      .map((f) => f.label)
      .filter((l) => l !== state.factions.get(PLAYER_FACTION_ID)?.label);

    expect(labels).toContain('Die Silbenschlucker');
    expect(labels).not.toContain('The Silo Horde');
  });

  it('names the villages in German too', () => {
    const seats = [...world(KLASSE1_CAMPAIGN).cities.values()].map((c) => c.name);
    expect(seats).toContain('Zahlenburg');
    expect(seats).toContain('Satzende');
  });

  it('builds the tech tree out of Klasse 1 topics', () => {
    const state = world(KLASSE1_CAMPAIGN);
    expect(state.topics.nodes.length).toBe(topicsFor(KLASSE1_CAMPAIGN).nodes.length);
    for (const node of state.topics.nodes) {
      expect(node.id, node.id).toMatch(/^klasse1-/);
    }
  });

  it('⚠️ hands out the whole army on 24 topics, exactly as on 41', () => {
    /*
     * The measurement that justified deleting the topic floor. If this ever
     * fails, the floor was doing something after all and its removal was the
     * mistake, not the check.
     */
    for (const campaign of [DP600_CAMPAIGN, KLASSE1_CAMPAIGN]) {
      const topics = topicsFor(campaign);
      const known = world(campaign);
      const state = {
        ...known,
        research: { ...known.research, known: topics.nodes.map((n) => n.id) },
      };
      expect(buildableUnits(state).length, campaign.id).toBe(UNIT_TYPE_IDS.length);
    }
  });

  it('leaves the player exactly as they always were', () => {
    // A different curriculum must not change how a game starts.
    const german = world(KLASSE1_CAMPAIGN);
    const normal = world(DP600_CAMPAIGN);
    expect(unitsOf(german, PLAYER_FACTION_ID).map((u) => u.typeId)).toEqual(
      unitsOf(normal, PLAYER_FACTION_ID).map((u) => u.typeId),
    );
  });
});
