import { useCallback, useEffect, useState } from 'react';

import {
  type EntraGroup,
  type GroupMember,
  GraphSignInRequiredError,
  addMemberByUpn,
  createSecurityGroup,
  enableGroupManagement,
  listGroups,
  listMembers,
  removeMember,
} from '@/services/entraGroups';

export function GroupsPage() {
  const [groups, setGroups] = useState<EntraGroup[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  // New-group form
  const [gName, setGName] = useState('');
  const [gNick, setGNick] = useState('');
  const [gDesc, setGDesc] = useState('');

  // Selected group + members
  const [selected, setSelected] = useState<EntraGroup | null>(null);
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [newMember, setNewMember] = useState('');

  const load = useCallback(async (term?: string) => {
    setError(null);
    try {
      setGroups(await listGroups(term));
      setNeedsConsent(false);
    } catch (e) {
      if (e instanceof GraphSignInRequiredError) setNeedsConsent(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const consent = async () => {
    setError(null);
    try {
      await enableGroupManagement();
      await load(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gName.trim() || !gNick.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createSecurityGroup({ displayName: gName, mailNickname: gNick, description: gDesc });
      setGName('');
      setGNick('');
      setGDesc('');
      await load(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openMembers = async (g: EntraGroup) => {
    setSelected(g);
    setMembers(null);
    try {
      setMembers(await listMembers(g.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addMember = async () => {
    if (!selected || !newMember.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addMemberByUpn(selected.id, newMember);
      setNewMember('');
      setMembers(await listMembers(selected.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const drop = async (memberId: string) => {
    if (!selected) return;
    try {
      await removeMember(selected.id, memberId);
      setMembers((m) => (m ? m.filter((x) => x.id !== memberId) : m));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const groupKind = (g: EntraGroup) =>
    g.groupTypes?.includes('Unified') ? 'Microsoft 365' : g.securityEnabled ? 'Security' : 'Group';

  return (
    <>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Entra ID groups</h2>
        <p className="text-xs text-gray-500">
          List, create and manage security groups (Microsoft Graph). Use these groups in
          workspace roles, RLS, and org-app audiences.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {needsConsent && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Managing Entra groups needs a one-time admin consent
          (<code>Group.ReadWrite.All</code>, <code>User.Read.All</code>).
          <button
            type="button"
            onClick={() => void consent()}
            className="ml-3 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
          >
            Enable group management
          </button>
        </div>
      )}

      {/* Create group */}
      <form
        onSubmit={create}
        className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm md:grid-cols-[1fr_1fr_auto]"
      >
        <input
          value={gName}
          onChange={(e) => setGName(e.target.value)}
          placeholder="New group name"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <input
          value={gNick}
          onChange={(e) => setGNick(e.target.value)}
          placeholder="Mail nickname (alias)"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !gName.trim() || !gNick.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create security group
        </button>
        <input
          value={gDesc}
          onChange={(e) => setGDesc(e.target.value)}
          placeholder="Description (optional)"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm md:col-span-3"
        />
      </form>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Groups {groups ? `(${groups.length})` : ''}
        </h3>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load(search)}
            placeholder="Search by name…"
            className="w-56 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => void load(search)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Search
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="max-h-[58vh] overflow-y-auto">
            <ul className="divide-y divide-gray-50">
              {(groups ?? []).map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => void openMembers(g)}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-gray-50 ${
                      selected?.id === g.id ? 'bg-blue-50/60' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {g.displayName}
                      </span>
                      <span className="block truncate text-xs text-gray-400">
                        {g.description || g.mail || '—'}
                      </span>
                    </span>
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                      {groupKind(g)}
                    </span>
                  </button>
                </li>
              ))}
              {groups && groups.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-gray-400">No groups.</li>
              )}
            </ul>
          </div>
        </div>

        {/* Members panel */}
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          {!selected ? (
            <p className="py-8 text-center text-sm text-gray-400">
              Select a group to view and manage members.
            </p>
          ) : (
            <>
              <h4 className="text-sm font-semibold text-gray-900">{selected.displayName}</h4>
              <div className="mt-3 flex gap-2">
                <input
                  value={newMember}
                  onChange={(e) => setNewMember(e.target.value)}
                  placeholder="Add member by email (UPN)…"
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void addMember()}
                  disabled={busy || !newMember.trim()}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              <ul className="mt-3 divide-y divide-gray-50">
                {(members ?? []).map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-gray-800">{m.displayName}</span>
                      <span className="block truncate text-xs text-gray-400">
                        {m.userPrincipalName}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void drop(m.id)}
                      className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
                {members && members.length === 0 && (
                  <li className="py-6 text-center text-sm text-gray-400">No members.</li>
                )}
                {!members && <li className="py-6 text-center text-sm text-gray-400">Loading…</li>}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}
