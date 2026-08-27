/**
 * The battle banner.
 *
 * Its job is to make the central mechanic legible: that answering the question
 * changed the fight. The modifier is shown as its own bar segment rather than
 * folded into a total, because a player who cannot see the contribution has no
 * reason to believe the studying matters.
 */

export interface BattleSide {
  readonly label: string;
  readonly colour: string;
  /** Strength before the challenge modifier. */
  readonly base: number;
  /** Signed contribution from the answer. */
  readonly modifier: number;
  readonly effective: number;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly maxHp: number;
}

export interface BattleReport {
  readonly attacker: BattleSide;
  readonly defender: BattleSide;
  readonly damageToDefender: number;
  readonly damageToAttacker: number;
  readonly defenderDestroyed: boolean;
  readonly attackerDestroyed: boolean;
  readonly cityCaptured: boolean;
  readonly ranged: boolean;
}

const STYLE = `
.fe-battle {
  position: fixed; top: 84px; left: 50%; transform: translateX(-50%) translateY(-14px);
  z-index: 40; width: min(560px, 92vw);
  background: rgba(12, 16, 24, 0.92); color: #e8eaf0;
  border: 1px solid rgba(255,255,255,0.14); border-radius: 12px;
  padding: 14px 18px; box-shadow: 0 18px 50px rgba(0,0,0,0.55);
  font: 13px/1.5 "Segoe UI", system-ui, sans-serif;
  opacity: 0; pointer-events: none;
  transition: opacity .18s ease, transform .18s ease;
}
.fe-battle.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.fe-battle .fe-b-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; }
.fe-battle .fe-b-name { font-weight: 600; }
.fe-battle .fe-b-right { text-align: right; }
.fe-battle .fe-b-vs { color: #7c8699; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
.fe-battle .fe-b-bar {
  height: 8px; border-radius: 4px; background: rgba(255,255,255,0.08);
  margin-top: 6px; display: flex; overflow: hidden;
}
.fe-battle .fe-b-bar i { display: block; height: 100%; }
.fe-battle .fe-b-bar i.base { background: currentColor; opacity: .75; }
.fe-battle .fe-b-bar i.plus { background: #6fe08a; }
.fe-battle .fe-b-bar i.minus { background: #e0625a; }
.fe-battle .fe-b-num { font-variant-numeric: tabular-nums; font-weight: 600; font-size: 15px; }
.fe-battle .fe-b-mod { font-size: 12px; font-weight: 600; }
.fe-battle .fe-b-mod.up { color: #8fd694; }
.fe-battle .fe-b-mod.down { color: #ff9b91; }
.fe-battle .fe-b-out {
  margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);
  display: flex; justify-content: space-between; color: #b9c1d1;
}
.fe-battle .fe-b-out b.hit { color: #ffcf7a; }
.fe-battle .fe-b-verdict { font-weight: 600; }
.fe-battle .fe-b-verdict.good { color: #8fd694; }
.fe-battle .fe-b-verdict.bad { color: #ff9b91; }
`;

export interface BattleBanner {
  show(report: BattleReport): void;
  hide(): void;
}

export function createBattleBanner(): BattleBanner {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const root = document.createElement('div');
  root.className = 'fe-battle';
  document.body.append(root);

  let hideTimer: number | undefined;

  function sideMarkup(side: BattleSide, alignRight: boolean): string {
    const total = Math.max(side.effective, side.base, 1);
    const basePct = (Math.min(side.base, total) / total) * 100;
    const modPct = (Math.abs(side.modifier) / total) * 100;
    const modClass = side.modifier >= 0 ? 'plus' : 'minus';
    const modLabel =
      side.modifier === 0
        ? ''
        : `<span class="fe-b-mod ${side.modifier > 0 ? 'up' : 'down'}">${
            side.modifier > 0 ? '+' : ''
          }${Math.round(side.modifier)} from your answer</span>`;

    return `
      <div class="${alignRight ? 'fe-b-right' : ''}" style="color:${side.colour}">
        <div class="fe-b-name">${side.label}</div>
        <div class="fe-b-num">${Math.round(side.effective)}</div>
        ${modLabel}
        <div class="fe-b-bar">
          ${
            alignRight
              ? `<i class="${modClass}" style="width:${modPct}%"></i><i class="base" style="width:${basePct}%"></i>`
              : `<i class="base" style="width:${basePct}%"></i><i class="${modClass}" style="width:${modPct}%"></i>`
          }
        </div>
      </div>`;
  }

  return {
    show(report) {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);

      const verdict = report.cityCaptured
        ? { text: 'City captured', tone: 'good' }
        : report.attackerDestroyed
          ? { text: 'Your unit fell', tone: 'bad' }
          : report.defenderDestroyed
            ? { text: 'Enemy destroyed', tone: 'good' }
            : report.damageToDefender >= report.damageToAttacker
              ? { text: 'You had the better of it', tone: 'good' }
              : { text: 'You came off worse', tone: 'bad' };

      root.innerHTML = `
        <div class="fe-b-row">
          ${sideMarkup(report.attacker, false)}
          <div class="fe-b-vs">${report.ranged ? 'volley' : 'clash'}</div>
          ${sideMarkup(report.defender, true)}
        </div>
        <div class="fe-b-out">
          <span>Dealt <b class="hit">${report.damageToDefender}</b></span>
          <span class="fe-b-verdict ${verdict.tone}">${verdict.text}</span>
          <span>Took <b class="hit">${report.damageToAttacker}</b></span>
        </div>`;

      root.classList.add('show');
      hideTimer = window.setTimeout(() => root.classList.remove('show'), 4200);
    },

    hide() {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      root.classList.remove('show');
    },
  };
}
