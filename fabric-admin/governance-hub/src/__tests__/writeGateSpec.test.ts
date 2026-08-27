import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { evaluateWriteGates, type DryRunRecord, type WriteGateId } from '@/domain/writeGates';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = new Date('2026-08-04T12:00:00Z');

interface Case {
  name: string;
  request: {
    bindingKind: string;
    module: string;
    scopeId: string;
    role?: string;
    dryRun: boolean;
    writable: boolean;
  };
  config: {
    writesEnabled: boolean;
    armedKinds: string[];
    scopeAllowlist: string[];
    enabledModules: string[];
  };
  dryRuns: { bindingKind: string; scopeId: string; agoDays: number }[];
  expect: 'allow' | WriteGateId;
}

const CASES: Case[] = JSON.parse(
  readFileSync(join(ROOT, 'spec', 'write_gate_cases.json'), 'utf8')
).cases;

function dryRuns(raw: Case['dryRuns']): DryRunRecord[] {
  return raw.map((entry) => ({
    bindingKind: entry.bindingKind,
    scopeId: entry.scopeId,
    succeededAt: new Date(NOW.getTime() - entry.agoDays * 24 * 60 * 60 * 1000),
  }));
}

/**
 * The gates are implemented twice — here for the UI, and in `collectors/gates.py`
 * for the actuator, which is the real enforcement point. Both suites run this
 * same file. If the two implementations ever disagree, one of them fails here,
 * which is the only reliable way to stop the app promising a refusal the
 * notebook would not make (or worse, the other way round).
 */
describe('shared write-gate specification', () => {
  it('loads a non-trivial set of cases', () => {
    // Otherwise a renamed or unreadable spec file makes both suites pass by
    // testing nothing at all.
    expect(CASES.length).toBeGreaterThanOrEqual(15);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const decision = evaluateWriteGates(
      testCase.request,
      testCase.config,
      dryRuns(testCase.dryRuns),
      NOW
    );
    if (testCase.expect === 'allow') {
      expect(decision.allowed, JSON.stringify(decision)).toBe(true);
    } else {
      expect(decision.allowed, JSON.stringify(decision)).toBe(false);
      expect(decision.failedGate).toBe(testCase.expect);
    }
  });

  it('covers every gate id at least once', () => {
    // A gate with no case is a gate nobody has ever proved fires.
    const covered = new Set(CASES.map((c) => c.expect));
    for (const gate of [
      'master',
      'kind',
      'scope',
      'dryRun',
      'deniedRole',
      'moduleOff',
      'notWritable',
      'allow',
    ]) {
      expect(covered, `no case expects ${gate}`).toContain(gate);
    }
  });

  it('gives the UI a localisable reason for every refusal', () => {
    for (const testCase of CASES) {
      if (testCase.expect === 'allow') continue;
      const decision = evaluateWriteGates(
        testCase.request,
        testCase.config,
        dryRuns(testCase.dryRuns),
        NOW
      );
      expect(decision.reasonKey, testCase.name).toBeTruthy();
    }
  });
});
