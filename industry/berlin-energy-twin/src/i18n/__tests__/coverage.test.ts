import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STRINGS } from '../strings'

/**
 * The Definition of Done requires that the DE/EN toggle covers 100 % of visible
 * strings. Reviewing that by eye does not survive a second pass, so it is
 * enforced here instead.
 */

const SRC = join(process.cwd(), 'src')
const PORTED = new Set(['reorder', 'finanzen', 'nachbestellung'])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry === '__tests__') continue
      // D51: the Caldova order and IBCS finance tabs are ported unchanged from Caldova Köln, with
      // their own catalogue (reorder) or German-only labels (Michael Tenner's cockpit).
      if (PORTED.has(entry) && dir === SRC) continue
      walk(p, out)
    } else if (entry.endsWith('.tsx')) {
      out.push(p)
    }
  }
  return out
}

describe('i18n coverage', () => {
  it('defines every key in BOTH languages', () => {
    const de = Object.keys(STRINGS.de).sort()
    const en = Object.keys(STRINGS.en).sort()
    expect(en).toEqual(de)
  })

  it('has no empty translations', () => {
    for (const lang of ['de', 'en'] as const) {
      for (const [key, value] of Object.entries(STRINGS[lang])) {
        expect(value, `${lang}.${key}`).toBeTruthy()
      }
    }
  })

  it('actually differs between the languages where it should', () => {
    // A handful legitimately match across languages (SIMULATION, LIVE, 2D...).
    // If almost everything matched, someone has copied one language over the
    // other and the toggle would be cosmetic.
    const keys = Object.keys(STRINGS.de) as (keyof typeof STRINGS.de)[]
    const identical = keys.filter((k) => STRINGS.de[k] === STRINGS.en[k])
    expect(identical.length / keys.length).toBeLessThan(0.2)
  })

  it('renders no hardcoded user-visible text in components', () => {
    // Catches the failure mode this rule exists for: a label typed straight
    // into JSX, which silently stays German (or English) when the user toggles.
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8')
      for (const [i, line] of src.split('\n').entries()) {
        // JSX text nodes: >Some words< with a letter and a space, i.e. prose
        const m = line.match(/>\s*([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß]+(?: [A-Za-zÄÖÜäöüß]+)+)\s*</)
        if (!m) continue
        offenders.push(`${file.replace(SRC, 'src')}:${i + 1}  ${m[1]}`)
      }
    }
    expect(offenders, `hardcoded strings:\n${offenders.join('\n')}`).toEqual([])
  })
})
