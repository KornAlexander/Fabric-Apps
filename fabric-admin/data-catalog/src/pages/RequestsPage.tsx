import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/hooks/AuthContext';
import {
  type AccessRequest,
  type Workspace,
  type WorkspaceRole,
  WORKSPACE_ROLES,
  createWorkspaceRequest,
  listMyRequests,
  listWorkspaces,
} from '@/services/accessRequests';
import {
  approverEmails,
  enableNotifications,
  notificationsConfigured,
  notifyApprovers,
} from '@/services/notify';

const statusBadge: Record<string, string> = {
  Submitted: 'bg-amber-50 text-amber-700',
  Approved: 'bg-blue-50 text-blue-700',
  Fulfilled: 'bg-emerald-50 text-emerald-700',
  Denied: 'bg-red-50 text-red-700',
  Failed: 'bg-red-50 text-red-700',
};

export function RequestsPage() {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [mine, setMine] = useState<AccessRequest[] | null>(null);
  const [wsId, setWsId] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('Viewer');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);

  const refreshMine = useMemo(
    () => async () => {
      if (!user) return;
      try {
        setMine(await listMyRequests(user.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [user]
  );

  useEffect(() => {
    listWorkspaces().then(setWorkspaces).catch((e) => setError(String(e)));
    void refreshMine();
  }, [refreshMine]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !wsId) return;
    const ws = workspaces.find((w) => w.id === wsId);
    if (!ws) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const created = await createWorkspaceRequest({
        workspace: ws,
        role,
        justification,
        requesterEmail: user.email,
        requesterId: user.id,
      });
      setJustification('');
      await refreshMine();

      // Best-effort: notify the approver(s) that a request awaits review.
      if (notificationsConfigured) {
        const mail = await notifyApprovers(created, window.location.origin);
        if (mail.needsConsent) setNeedsConsent(true);
        setOk(
          mail.sent
            ? `Requested ${role} on “${ws.name}” — approver notified (${approverEmails().join(', ')}).`
            : `Requested ${role} on “${ws.name}”. (Email notification not sent${mail.needsConsent ? ' — enable below' : ''}.)`
        );
      } else {
        setOk(`Requested ${role} on “${ws.name}”.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Request access</h2>
        <p className="text-xs text-gray-500">
          Ask for a workspace role. An approver reviews and grants it.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {ok && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {ok}
          {needsConsent && (
            <button
              type="button"
              onClick={() =>
                void enableNotifications()
                  .then(() => setNeedsConsent(false))
                  .catch(() => {})
              }
              className="ml-3 rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              Enable email notifications
            </button>
          )}
        </div>
      )}

      <form onSubmit={submit} className="mb-8 grid grid-cols-1 gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm md:grid-cols-[1fr_auto_auto]">
        <select
          value={wsId}
          onChange={(e) => setWsId(e.target.value)}
          required
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">Select a workspace…</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as WorkspaceRole)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
        >
          {WORKSPACE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !wsId}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Submitting…' : 'Submit request'}
        </button>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder="Why do you need this access? (optional)"
          rows={2}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm md:col-span-3"
        />
      </form>

      <h3 className="mb-2 text-sm font-semibold text-gray-900">My requests</h3>
      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Workspace</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(mine ?? []).map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 font-medium text-gray-900">{r.target_name}</td>
                <td className="px-4 py-2.5 text-gray-600">{r.requested_role}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadge[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{r.fulfilment_detail ?? '—'}</td>
              </tr>
            ))}
            {mine && mine.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">
                  No requests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
