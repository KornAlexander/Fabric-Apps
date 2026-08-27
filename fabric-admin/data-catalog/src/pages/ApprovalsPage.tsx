import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/AuthContext';
import {
  type AccessRequest,
  approveRequest,
  denyRequest,
  listPendingRequests,
} from '@/services/accessRequests';
import { notifyRequester } from '@/services/notify';

export function ApprovalsPage() {
  const { user } = useAuth();
  const [pending, setPending] = useState<AccessRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPending(await listPendingRequests());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const decide = async (req: AccessRequest, approve: boolean) => {
    if (!user) return;
    setBusyId(req.id);
    setError(null);
    setNote(null);
    try {
      if (approve) {
        const updated = await approveRequest(req, user.email);
        setNote(
          updated.status === 'Fulfilled'
            ? `Granted ${req.requested_role} on “${req.target_name}”.`
            : `Approved — ${updated.fulfilment_detail ?? 'manual fulfilment required.'}`
        );
        void notifyRequester(req, 'Approved', updated.status === 'Fulfilled');
      } else {
        await denyRequest(req.id, user.email);
        setNote(`Denied request for “${req.target_name}”.`);
        void notifyRequester(req, 'Denied', false);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Approvals</h2>
        <p className="text-xs text-gray-500">
          Pending access requests. Approving attempts the grant; without a service
          principal it is left for manual fulfilment.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {note && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {note}
        </div>
      )}

      <div className="space-y-3">
        {(pending ?? []).map((r) => (
          <div
            key={r.id}
            className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {r.requester} → <span className="text-blue-700">{r.requested_role}</span> on “{r.target_name}”
              </p>
              <p className="text-xs text-gray-500">{r.justification || 'No justification provided.'}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => void decide(r, true)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busyId === r.id ? 'Working…' : 'Approve'}
              </button>
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => void decide(r, false)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          </div>
        ))}
        {pending && pending.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-200 bg-white/60 p-8 text-center text-sm text-gray-400">
            No pending requests.
          </p>
        )}
      </div>
    </>
  );
}
