import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { useT } from '@/i18n';
import { canContinueWorkspace, validWorkspaceInput, WORKSPACE_NAME_MAX, type Capacity, type WorkspaceDecision, type WorkspaceRequest } from '@/um/domain/workspaceRequest';
import { useUm } from '@/um/hooks/UmContext';
import { continueWorkspace, decideWorkspace } from '@/um/services/workspaceRequests';

import { Button, Card, Notice, Pill, Section } from './parts';

const REQUIRED_GRANTS = ['directory', 'fabric', 'fabricWrite', 'groupCreate', 'memberChange'] as const;
const inputClass = 'mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm';

export function WorkspaceRequestsPage() {
  const t = useT();
  const { services, identity, isAppAdmin, armed, bindingsArmed, groupsArmed, grants, grant, reload } = useUm();
  const [requests, setRequests] = useState<WorkspaceRequest[]>([]);
  const [decisions, setDecisions] = useState<WorkspaceDecision[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [capacities, setCapacities] = useState<Capacity[]>([]);
  const [capacityId, setCapacityId] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [workingRequestId, setWorkingRequestId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    const state = await services.workspaceRequests.list();
    setRequests(state.requests);
    setDecisions(state.decisions);
  }, [services.workspaceRequests]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    if (!identity) return;
    void services.workspaceRequests.list().then((state) => {
      if (active) {
        setRequests(state.requests);
        setDecisions(state.decisions);
        setLoading(false);
      }
    }).catch((failure: unknown) => {
      if (active) {
        setError(failure instanceof Error ? failure.message : t('um.err.generic'));
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [identity, services.workspaceRequests, t]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : t('um.err.generic');
      setError((previous) => previous ? `${previous}; ${detail}` : detail);
    }
    try {
      await refresh();
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : t('um.err.generic');
      setError((previous) => previous ? `${previous}; ${detail}` : detail);
    }
    setBusy(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!identity || !validWorkspaceInput({ displayName, description, reason })) return;
    void run(async () => {
      await services.workspaceRequests.submit({
        id: crypto.randomUUID(), displayName: displayName.trim(), description: description.trim(), reason: reason.trim(),
        requester: identity, createdAt: new Date().toISOString(),
      });
      setDisplayName('');
      setDescription('');
      setReason('');
      setMessage(t('um.wr.submitted'));
    });
  };

  const loadCapacities = () => run(async () => {
    if (!identity || !(await grant('capacity'))) throw new Error(t('um.wr.permissionDenied'));
    const provisioner = await services.loadWorkspaceProvisioner();
    if (!provisioner) throw new Error(t('um.wr.readOnly'));
    const found = (await provisioner.listCapacities(identity.objectId)).filter((c) => c.state === 'Active');
    setCapacities(found);
    setCapacityId('');
    if (!found.length) setMessage(t('um.wr.noCapacities'));
  });

  const decide = (request: WorkspaceRequest, action: 'approve' | 'deny' | 'continue') => run(async () => {
    if (!identity || !isAppAdmin) throw new Error(t('um.err.generic'));
    const [provisioner, groupCreator, memberWriter, bindingWriter] = await Promise.all([
      services.loadWorkspaceProvisioner(), services.loadGroupCreator(), services.loadWriter(), services.loadBindingWriter(),
    ]);
    if (!provisioner || !groupCreator || !memberWriter || !bindingWriter) throw new Error(t('um.wr.readOnly'));
    const deps = {
      store: services.workspaceRequests, umStore: services.store, actor: identity, isAppAdmin,
      writesInBuild: services.writesInBuild, directory: services.directory, fabric: services.fabric,
      provisioner, groupCreator, memberWriter, bindingWriter,
    };
    if (action !== 'deny') setWorkingRequestId(request.id);
    try {
      const result = action === 'continue'
        ? await continueWorkspace(deps, request.id)
        : await decideWorkspace(deps, request.id, action === 'approve'
          ? { approve: true, capacityId, note: notes[request.id] ?? '' }
          : { approve: false, note: notes[request.id] ?? '' });
      if (result.status === 'Failed') setError(`${t('um.wr.step', { step: result.step })} ${result.error ?? t('um.wr.partial')}`);
      await reload();
      if (result.status !== 'Failed') setMessage(t(action === 'deny' ? 'um.wr.denied' : 'um.wr.created'));
    } finally {
      setWorkingRequestId('');
    }
  });

  const enabled = armed && bindingsArmed && groupsArmed;
  const canApprove = enabled && REQUIRED_GRANTS.every((scope) => grants[scope]);
  const visible = requests.filter((request) => isAppAdmin || request.requester.objectId.toLowerCase() === identity?.objectId.toLowerCase());

  return (
    <div className="space-y-6">
      <Section title={t('um.wr.title')} intro={t('um.wr.intro')}>
        {error && <Notice tone="alert">{t('um.wr.error', { detail: error })}</Notice>}
        {message && <Notice tone="info">{message}</Notice>}
        {!services.writesInBuild && <Notice tone="warn">{t('um.wr.readOnly')}</Notice>}
        {identity && services.writesInBuild && (
          <Card>
            <form onSubmit={submit} className="space-y-3">
              <label className="block text-sm">{t('um.wr.name')}
                <input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} minLength={3} maxLength={WORKSPACE_NAME_MAX} required />
              </label>
              <label className="block text-sm">{t('um.wr.description')}
                <textarea className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
              </label>
              <label className="block text-sm">{t('um.wr.reason')}
                <textarea className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={1000} required />
              </label>
              <Button type="submit" primary disabled={busy || loading || !validWorkspaceInput({ displayName, description, reason })}>{t('um.wr.submit')}</Button>
            </form>
          </Card>
        )}
      </Section>

      {isAppAdmin && services.writesInBuild && (
        <Section title={t('um.wr.approvalSetup')} intro={t('um.wr.provisioningPlan')}>
          {!enabled && <Notice tone="warn">{t('um.wr.switches')}</Notice>}
          <div className="flex flex-wrap gap-2">
            {REQUIRED_GRANTS.map((scope) => <Button key={scope} disabled={busy || grants[scope]} onClick={() => void run(async () => {
              if (!(await grant(scope))) throw new Error(t('um.wr.permissionDenied'));
            })}>{t('um.wr.allow', { permission: t(`um.perm.set.${scope}`) })}</Button>)}
          </div>
          <Button disabled={busy} onClick={() => void loadCapacities()}>{t('um.wr.loadCapacities')}</Button>
          <label className="block text-sm">{t('um.wr.capacity')}
            <select className={inputClass} value={capacityId} onChange={(e) => setCapacityId(e.target.value)} disabled={busy}>
              <option value="">{t('um.wr.chooseCapacity')}</option>
              {capacities.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
            </select>
          </label>
        </Section>
      )}

      <Section title={t(isAppAdmin ? 'um.wr.allRequests' : 'um.wr.myRequests')} actions={<Button disabled={busy || !identity} onClick={() => void run(async () => {})}>{t('um.wr.refresh')}</Button>}>
        {loading && <p>{t('common.loading')}</p>}
        {!loading && !error && !visible.length && <p>{t('um.wr.none')}</p>}
        {visible.map((request) => {
          const decision = decisions.find((d) => d.id === request.id);
          const own = request.requester.objectId.toLowerCase() === identity?.objectId.toLowerCase();
          return (
            <Card key={request.id}>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{request.displayName}</h3>
                  <Pill tone={decision?.status === 'Failed' ? 'alert' : 'info'}>{t(`um.wr.status.${decision?.status ?? 'Pending'}`)}</Pill>
                </div>
                <p className="text-sm">{request.description}</p>
                <p className="text-sm">{request.reason}</p>
                <p className="text-xs text-gray-600">{request.requester.displayName} · {request.requester.userPrincipalName} · {new Date(request.createdAt).toLocaleString()}</p>
                {workingRequestId === request.id && <Notice tone="info">{t('um.wr.working')}</Notice>}
                {decision && (
                  <div className="space-y-2 text-sm">
                    <p>{t('um.wr.decidedBy', { name: decision.actor.displayName })} · {decision.note}</p>
                    {decision.capacityId && <p>{t('um.wr.capacity')}: {decision.capacityId}</p>}
                    {decision.workspaceId && <a className="text-blue-700 underline" href={`https://app.fabric.microsoft.com/groups/${encodeURIComponent(decision.workspaceId)}`} target="_blank" rel="noreferrer">{t('um.wr.openWorkspace')}</a>}
                    {decision.groups.map((g) => <p key={g.id}>{g.role}: {g.name} · {g.id}</p>)}
                    {(decision.status === 'Failed' || decision.status === 'Provisioning') && <Notice tone="warn">
                      {t('um.wr.partial')} {t('um.wr.step', { step: decision.step })} {decision.error}
                    </Notice>}
                    {isAppAdmin && services.writesInBuild && decision.actor.objectId.toLowerCase() === identity?.objectId.toLowerCase() && canContinueWorkspace(decision) && (
                      <>
                        <p>{t('um.wr.continueHint')}</p>
                        <Button primary disabled={busy || !canApprove || !grants.capacity} onClick={() => void decide(request, 'continue')}>{t('um.wr.continue')}</Button>
                      </>
                    )}
                  </div>
                )}
                {!decision && own && isAppAdmin && <p className="text-sm">{t('um.wr.otherAdmin')}</p>}
                {!decision && isAppAdmin && !own && services.writesInBuild && (
                  <>
                    <label className="block text-sm">{t('um.wr.note')}
                      <textarea className={inputClass} value={notes[request.id] ?? ''} maxLength={500} onChange={(e) => setNotes({ ...notes, [request.id]: e.target.value })} />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button primary disabled={busy || !canApprove || !capacityId} onClick={() => void decide(request, 'approve')}>{t('um.wr.approve')}</Button>
                      <Button disabled={busy || !notes[request.id]?.trim()} onClick={() => void decide(request, 'deny')}>{t('um.wr.deny')}</Button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </Section>
    </div>
  );
}
