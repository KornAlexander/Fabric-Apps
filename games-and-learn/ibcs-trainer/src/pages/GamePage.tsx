import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/hooks/AuthContext';
import { getRayfinClient } from '@/services/rayfinClient';

/** Shape posted by the game's `stats.publish()` (see public/game/ibcs_trainer.html). */
interface GameStatsPayload {
  player_name: string;
  timestamp: string;
  duration_seconds: number;
  score: number;
  won: boolean;
  lives_left: number;
  deaths_total: number;
  deaths_enemy: number;
  deaths_water: number;
  deaths_fall: number;
  deaths_lava: number;
  coins_collected: number;
  enemies_stomped: number;
  enemies_zapped: number;
  bosses_killed: number;
  attacks_used: number;
  jumps: number;
  forms_collected: string;
  final_form: string;
  max_x_reached: number;
  level_reached: number;
  // Optional IBCS SUCCESS progression fields (v2).
  pillars_completed?: number;
  ibcs_certified?: boolean;
  iso_memorized?: boolean;
  unlocked_substages?: string;
}

/** Shape posted by the platformer's `emitStageComplete()` the moment a substage is cleared. */
interface StageCompletePayload {
  substage_index: number;
  substage_code: string;
  substage_title: string;
  stage_index: number;
  stage_pillar: string;
  stage_world?: string;
  level_reached?: number;
  stage_completed?: boolean;
  timestamp: string;
}

/** The 7 SUCCESS stages × 5 substages = 35 substages drive the progress display. */
const TOTAL_SUBSTAGES = 35;
const TOTAL_STAGES = 7;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** The three IBCS mini-games, each a self-contained HTML5 game in /public/game. */
const GAMES = [
  {
    id: 'platformer',
    label: 'Rule Platformer',
    src: '/game/ibcs_trainer.html',
    icon: '🎮',
    tag: 'Platformer',
    card: 'Run and jump through nine IBCS rule levels. Stomp the bad charts, collect the compliant ones and learn one SUCCESS rule per stage. Arrow keys / WASD + Space — or touch controls on mobile.',
    blurb: 'Jump & run through all 98 IBCS rules, 7 stages & the ISO 24896 vault.',
  },
  {
    id: 'swipe',
    label: 'Chart Swipe',
    src: '/game/ibcs_swipe.html',
    icon: '🔥',
    tag: 'Quick reflex',
    card: 'Swipe right on the IBCS-compliant chart, left on the rule-breaker. A fast-paced way to train your eye for clean design. How many can you classify before the timer runs out?',
    blurb: 'Swipe right on compliant charts, left on the violations. Beat the clock.',
  },
  {
    id: 'escape',
    label: 'IBCS Escape Room',
    src: '/game/ibcs_escape.html',
    icon: '🔐',
    tag: 'Puzzle',
    card: 'Work through chart puzzles room by room. Pick the compliant visual to unlock the next door and escape — each room hides a different SUCCESS rule.',
    blurb: 'Solve a rule puzzle on each door to escape and present the message.',
  },
] as const;

type GameId = (typeof GAMES)[number]['id'];

/**
 * The IBCS Trainer Arcade landing styling, mirrored 1:1 from the standalone
 * public/game/index.html menu. Scoped under `.ibcs-arcade` so it never collides
 * with Tailwind or global styles. We recreate the menu in React (rather than
 * iframing index.html) because the games post their stats to `window.parent` —
 * they must stay a DIRECT child of this page for auth-linked progress to work.
 */
const ARCADE_CSS = `
.ibcs-arcade{--bg:#0a0a1a;--panel:#0d1428;--panel2:#11193a;--accent:#60a8ff;--accent2:#3b6fe2;--good:#37a76a;--text:#eef2fb;--muted:#9aa6c4;--border:rgba(96,168,255,0.22);min-height:100vh;background:radial-gradient(1200px 700px at 50% -10%,#16224d 0%,var(--bg) 60%);color:var(--text);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;overflow-x:hidden}
.ibcs-arcade *{box-sizing:border-box}
.ibcs-arcade .topbar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 16px;flex:0 0 auto;border-bottom:1px solid transparent}
.ibcs-arcade .topbar.solid{background:#070a16;border-bottom:1px solid var(--border)}
.ibcs-arcade .topbar .left{display:flex;align-items:center;gap:12px;min-width:0}
.ibcs-arcade .topbar .right{display:flex;align-items:center;gap:14px;font-size:12px;color:var(--muted)}
.ibcs-arcade .wordmark{font-size:13px;font-weight:600;letter-spacing:.02em;color:var(--muted)}
.ibcs-arcade .signout{appearance:none;background:transparent;border:0;color:var(--muted);cursor:pointer;font-size:12px;transition:color .15s ease}
.ibcs-arcade .signout:hover{color:var(--text)}
.ibcs-arcade .back{appearance:none;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text);font-size:14px;font-weight:600;padding:7px 13px;border-radius:9px;display:flex;align-items:center;gap:7px;transition:background .15s ease}
.ibcs-arcade .back:hover{background:rgba(96,168,255,.12)}
.ibcs-arcade .ptitle{font-size:14px;font-weight:600;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ibcs-arcade .menu{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:32px 20px 48px;width:100%}
.ibcs-arcade .logo{width:88px;height:88px;margin-bottom:8px;filter:drop-shadow(0 8px 22px rgba(48,104,220,.45))}
.ibcs-arcade .brand{display:flex;align-items:center;gap:10px;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
.ibcs-arcade .brand .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent)}
.ibcs-arcade h1{font-size:clamp(26px,4.5vw,42px);font-weight:800;letter-spacing:-.02em;text-align:center;line-height:1.1}
.ibcs-arcade h1 .hl{color:var(--accent)}
.ibcs-arcade .sub{margin-top:12px;max-width:640px;text-align:center;color:var(--muted);font-size:clamp(14px,1.8vw,16px);line-height:1.55}
.ibcs-arcade .cards{margin-top:36px;display:grid;gap:20px;width:100%;max-width:1040px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.ibcs-arcade .card{background:linear-gradient(180deg,var(--panel2) 0%,var(--panel) 100%);border:1px solid var(--border);border-radius:16px;padding:24px 22px 22px;display:flex;flex-direction:column;position:relative;overflow:hidden;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}
.ibcs-arcade .card:hover{transform:translateY(-4px);border-color:var(--accent);box-shadow:0 14px 40px rgba(20,40,90,.55)}
.ibcs-arcade .card .ico{font-size:34px;line-height:1;margin-bottom:14px}
.ibcs-arcade .card h2{font-size:20px;font-weight:700;margin-bottom:8px}
.ibcs-arcade .card p{color:var(--muted);font-size:14px;line-height:1.55;flex:1}
.ibcs-arcade .tag{display:inline-block;margin-top:14px;margin-bottom:18px;align-self:flex-start;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:rgba(96,168,255,.1);border:1px solid var(--border);padding:4px 10px;border-radius:999px}
.ibcs-arcade .play{appearance:none;cursor:pointer;border:0;border-radius:10px;background:linear-gradient(180deg,var(--accent) 0%,var(--accent2) 100%);color:#04102b;font-weight:700;font-size:15px;padding:11px 16px;width:100%;transition:filter .15s ease}
.ibcs-arcade .play:hover{filter:brightness(1.08)}
.ibcs-arcade .foot{margin-top:34px;color:var(--muted);font-size:12.5px;text-align:center;line-height:1.6}
.ibcs-arcade .foot a{color:var(--accent);text-decoration:none}
.ibcs-arcade .foot a:hover{text-decoration:underline}
.ibcs-arcade .frameWrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#05060e;padding:16px}
.ibcs-arcade .gframe{width:min(900px,100%);height:min(600px,calc(100vh - 120px));border:0;border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.5);display:block;background:#05060e}
@media(max-width:520px){.ibcs-arcade .menu{padding:24px 14px 36px}.ibcs-arcade .card{padding:20px 18px}}
`;

export function GamePage() {
  const { user, signOut } = useAuth();
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastScore, setLastScore] = useState<number | null>(null);
  // `null` shows the arcade landing menu; a GameId shows that game's iframe.
  const [activeGame, setActiveGame] = useState<GameId | null>(null);
  // Guard against the game re-publishing the same run twice.
  const lastSavedKey = useRef<string | null>(null);
  // The signed-in player's durable IBCS progression (StageProgress entity).
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const completedSubstages = useRef<Set<number>>(new Set());
  const [completedCount, setCompletedCount] = useState(0);
  const [stagesCompleted, setStagesCompleted] = useState(0);

  // Push the substages already recorded in the DB into the platformer iframe so
  // checkpoints unlock across devices. We send each completed substage plus the
  // next index (the platformer unlocks "the next substage" on completion).
  const syncProgressToGame = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow || activeGame !== 'platformer') return;
    const unlocked = new Set<number>([0]);
    for (const idx of completedSubstages.current) {
      unlocked.add(idx);
      if (idx + 1 < TOTAL_SUBSTAGES) unlocked.add(idx + 1);
    }
    frame.contentWindow.postMessage(
      { type: 'rayfin-progress-init', unlocked: [...unlocked] },
      window.location.origin
    );
  }, [activeGame]);

  // Load the player's existing progress once they are known.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await getRayfinClient().data.StageProgress.findMany({
          user_id: { eq: user.id },
        });
        if (cancelled) return;
        const subs = new Set<number>();
        const stages = new Set<number>();
        for (const r of rows) {
          subs.add(r.substage_index);
          if (r.stage_completed) stages.add(r.stage_index);
        }
        completedSubstages.current = subs;
        setCompletedCount(subs.size);
        setStagesCompleted(stages.size);
        syncProgressToGame();
      } catch (err) {
        console.error('Failed to load stage progress:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, syncProgressToGame]);

  // Persist a freshly-cleared substage to the player's profile (idempotent).
  const saveStageProgress = useCallback(
    async (payload: StageCompletePayload) => {
      if (!user) return;
      const idx = payload.substage_index;
      if (completedSubstages.current.has(idx)) return; // already recorded
      completedSubstages.current.add(idx);
      setCompletedCount(completedSubstages.current.size);
      if (payload.stage_completed) {
        setStagesCompleted((n) => Math.min(TOTAL_STAGES, n + 1));
      }
      try {
        // Guard against a duplicate row if the same substage was saved earlier.
        const existing = await getRayfinClient().data.StageProgress.findFirst({
          user_id: { eq: user.id },
          substage_index: { eq: idx },
        });
        if (existing) return;
        await getRayfinClient().data.StageProgress.create({
          user_id: user.id,
          player_name: user.name,
          substage_index: idx,
          substage_code: payload.substage_code,
          substage_title: payload.substage_title,
          stage_index: payload.stage_index,
          stage_pillar: payload.stage_pillar,
          stage_world: payload.stage_world,
          stage_completed: payload.stage_completed,
          level_reached: payload.level_reached,
          completedAt: new Date(payload.timestamp),
        });
      } catch (err) {
        console.error('Failed to save stage progress:', err);
      }
    },
    [user]
  );

  const saveRun = useCallback(
    async (payload: GameStatsPayload) => {
      if (!user) return;
      const key = `${payload.timestamp}|${payload.score}|${payload.level_reached}`;
      if (lastSavedKey.current === key) return;
      lastSavedKey.current = key;

      setSaveState('saving');
      try {
        await getRayfinClient().data.GameStats.create({
          player_name: payload.player_name,
          score: payload.score,
          won: payload.won,
          lives_left: payload.lives_left,
          duration_seconds: payload.duration_seconds,
          deaths_total: payload.deaths_total,
          deaths_enemy: payload.deaths_enemy,
          deaths_water: payload.deaths_water,
          deaths_fall: payload.deaths_fall,
          deaths_lava: payload.deaths_lava,
          coins_collected: payload.coins_collected,
          enemies_stomped: payload.enemies_stomped,
          enemies_zapped: payload.enemies_zapped,
          bosses_killed: payload.bosses_killed,
          attacks_used: payload.attacks_used,
          jumps: payload.jumps,
          forms_collected: payload.forms_collected,
          final_form: payload.final_form,
          max_x_reached: payload.max_x_reached,
          level_reached: payload.level_reached,
          pillars_completed: payload.pillars_completed,
          ibcs_certified: payload.ibcs_certified,
          iso_memorized: payload.iso_memorized,
          unlocked_substages: payload.unlocked_substages,
          playedAt: new Date(payload.timestamp),
          user_id: user.id,
        });
        setLastScore(payload.score);
        setSaveState('saved');
      } catch (err) {
        console.error('Failed to save game stats:', err);
        setSaveState('error');
      }
    },
    [user]
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Same-origin iframe: only trust messages from our own window's children.
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        payload?: GameStatsPayload & StageCompletePayload;
      };
      if (data?.type === 'rayfin-game-stats' && data.payload) {
        void saveRun(data.payload as GameStatsPayload);
      } else if (data?.type === 'rayfin-stage-complete' && data.payload) {
        void saveStageProgress(data.payload as StageCompletePayload);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [saveRun, saveStageProgress]);

  const current = activeGame ? GAMES.find((g) => g.id === activeGame) : null;

  const saveStatus = (
    <span aria-live="polite">
      {saveState === 'saving' && 'Saving run…'}
      {saveState === 'saved' &&
        `Run saved${lastScore !== null ? ` · score ${lastScore}` : ''}`}
      {saveState === 'error' && 'Could not save run'}
    </span>
  );

  return (
    <div className="ibcs-arcade">
      <style>{ARCADE_CSS}</style>

      <header className={`topbar${current ? ' solid' : ''}`}>
        <div className="left">
          {current ? (
            <>
              <button
                className="back"
                onClick={() => setActiveGame(null)}
                aria-label="Back to all games"
              >
                ‹ All games
              </button>
              <span className="ptitle">{current.label}</span>
            </>
          ) : (
            <span className="wordmark">IBCS Trainer</span>
          )}
        </div>
        <div className="right">
          <span title="Substages and SUCCESS stages you have completed">
            Progress: {completedCount}/{TOTAL_SUBSTAGES} · {stagesCompleted}/
            {TOTAL_STAGES} stages
          </span>
          {saveStatus}
          <button className="signout" onClick={() => void signOut()} aria-label="Sign out">
            Sign out
          </button>
        </div>
      </header>

      {current ? (
        /*
          Keying by game id intentionally remounts the iframe when switching
          games, giving each game a clean start. The game stays a DIRECT child
          of this page so its `window.parent.postMessage` stats/progress calls
          reach the Rayfin listener above.
        */
        <div className="frameWrap">
          <iframe
            key={current.id}
            ref={iframeRef}
            src={current.src}
            title={current.label}
            onLoad={() => syncProgressToGame()}
            className="gframe"
            allow="autoplay"
          />
        </div>
      ) : (
        <main className="menu">
          <img
            className="logo"
            src="/game/logo.svg"
            width={88}
            height={88}
            alt="IBCS Trainer Arcade logo"
            decoding="async"
          />
          <div className="brand">
            <span className="dot" />
            Actionable Reporting · Learn by Playing
          </div>
          <h1>
            The <span className="hl">IBCS</span> Trainer Arcade
          </h1>
          <p className="sub">
            Three browser mini-games that teach the <strong>IBCS® SUCCESS</strong>{' '}
            rules for business charts — spot the violations, collect the compliant
            visuals and make better reports without reading a single standard. No
            install, runs right here.
          </p>

          <section className="cards">
            {GAMES.map((g) => (
              <article className="card" key={g.id}>
                <div className="ico" aria-hidden="true">
                  {g.icon}
                </div>
                <span className="tag">{g.tag}</span>
                <h2>{g.label}</h2>
                <p>{g.card}</p>
                <button className="play" onClick={() => setActiveGame(g.id)}>
                  ▶ Play {g.label.replace(/^Rule |^IBCS /, '')}
                </button>
              </article>
            ))}
          </section>

          <p className="foot">
            Built on <strong>Rayfin Apps</strong> in Microsoft Fabric · charts
            illustrate the{' '}
            <a
              href="https://www.ibcs.com/standards/"
              target="_blank"
              rel="noopener noreferrer"
            >
              IBCS® Standards
            </a>
            .
            <br />
            Tip: click a game, then click the canvas once so keyboard &amp; sound
            activate.
          </p>
        </main>
      )}
    </div>
  );
}
