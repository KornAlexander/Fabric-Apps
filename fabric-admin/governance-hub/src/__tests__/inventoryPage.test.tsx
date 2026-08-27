import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';
import type { MergedInventory } from '@/modules';

const refreshInventory = vi.fn().mockResolvedValue(undefined);

const t0Inventory: MergedInventory = {
  items: [
    { id: 'ws-1', module: 'fabric', kind: 'workspace', name: 'Finance' },
    {
      id: 'it-1',
      module: 'fabric',
      kind: 'fabricItem',
      name: 'Quarterly Sales',
      itemType: 'Report',
      scopeId: 'ws-1',
      scopeName: 'Finance',
    },
    { id: 'g-1', module: 'entra', kind: 'group', name: 'Finance Analysts' },
  ],
  byModule: {
    fabric: {
      items: [],
      tier: 'T0',
      partial: true,
      partialReasonKey: 'reason.fabric.noAdmin',
      errors: [],
    },
    entra: {
      items: [],
      tier: 'T0',
      partial: true,
      partialReasonKey: 'partial.entra.ownMembershipOnly',
      errors: [],
    },
    pp: {
      items: [],
      tier: 'T0',
      partial: true,
      partialReasonKey: 'partial.pp.serverSideOnly',
      errors: [],
    },
  },
  partial: true,
  tier: 'T0',
  errors: [],
};

vi.mock('@/hooks/GovernanceContext', () => ({
  useGovernance: () => ({
    inventory: t0Inventory,
    inventoryLoading: false,
    refreshInventory,
  }),
}));

const { InventoryPage } = await import('@/pages/InventoryPage');

function renderPage(locale: 'en' | 'de' = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <InventoryPage />
    </I18nProvider>
  );
}

/**
 * Phase 2 exit criterion (PLAN.md §17 Track A):
 * *"a user with no admin consent sees a useful Inventory + Setup"*.
 *
 * These assertions are the criterion, written down.
 */
describe('Inventory at T0 — no admin consent', () => {
  it('shows real objects the user can already reach', () => {
    renderPage();
    // "Finance" legitimately appears twice: as the workspace row and as the
    // container of the report inside it.
    expect(screen.getAllByText('Finance').length).toBeGreaterThan(0);
    expect(screen.getByText('Quarterly Sales')).toBeInTheDocument();
    expect(screen.getByText('Finance Analysts')).toBeInTheDocument();
  });

  it('admits it is incomplete, per plane, with a reason', () => {
    renderPage();
    expect(screen.getByText(/this view is incomplete/i)).toBeInTheDocument();
    // Power Platform has no browser path at all — that must be stated, not hidden.
    expect(
      screen.getByText(/power platform admin apis are not reachable from a browser/i)
    ).toBeInTheDocument();
    // ...and Entra's degraded reason must be its own, not a generic one.
    expect(screen.getByText(/only your own group memberships/i)).toBeInTheDocument();
  });

  it('shows the reach tier so nobody mistakes this for the whole tenant', () => {
    renderPage();
    expect(screen.getByLabelText(/current reach tier/i)).toHaveTextContent('T0');
  });

  it('summarises counts by kind', () => {
    renderPage();
    // Kind labels appear in the summary cards, the filter dropdown and the
    // table cells — all three are intentional.
    for (const label of ['Workspace', 'Fabric item', 'Group']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    const cards = screen.getAllByText('1');
    expect(cards.length).toBe(3);
  });

  it('does not re-collect when data is already present', () => {
    refreshInventory.mockClear();
    renderPage();
    expect(refreshInventory).not.toHaveBeenCalled();
  });

  it('renders in German without falling back to English', () => {
    renderPage('de');
    expect(screen.getByText('Inventar')).toBeInTheDocument();
    expect(screen.getByText(/diese sicht ist unvollständig/i)).toBeInTheDocument();
    // Real umlauts, not ASCII substitutes.
    expect(screen.queryByText(/unvollstaendig/i)).not.toBeInTheDocument();
  });
});
