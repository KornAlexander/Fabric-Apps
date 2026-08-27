/**
 * Email notifications for the access-request approval workflow.
 *
 * On submit, the approver(s) are emailed with a link to review & approve; on a
 * decision, the requester is emailed the outcome. Mail is sent via Microsoft
 * Graph `/me/sendMail` with the signed-in user's delegated `Mail.Send` token
 * (user-consented). Everything is best-effort — a failed email never blocks the
 * request itself.
 *
 * Approvers are configured via `VITE_APPROVER_EMAILS` (comma-separated).
 */
import { getGraphToken, GRAPH_MAIL_SCOPES, GraphSignInRequiredError } from './fabricAuth';

const APPROVERS = ((import.meta.env.VITE_APPROVER_EMAILS as string | undefined) || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** True when at least one approver email is configured. */
export const notificationsConfigured = APPROVERS.length > 0;

export function approverEmails(): string[] {
  return [...APPROVERS];
}

export interface MailResult {
  sent: boolean;
  /** True when interactive Graph consent is required first. */
  needsConsent?: boolean;
  error?: string;
}

function esc(s: string | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

async function graphSendMail(
  token: string,
  to: string[],
  subject: string,
  html: string
): Promise<void> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) throw new Error(`sendMail ${res.status}: ${await res.text()}`);
}

async function send(to: string[], subject: string, html: string): Promise<MailResult> {
  if (to.length === 0) return { sent: false };
  let token: string;
  try {
    token = await getGraphToken(GRAPH_MAIL_SCOPES);
  } catch (e) {
    if (e instanceof GraphSignInRequiredError) return { sent: false, needsConsent: true };
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    await graphSendMail(token, to, subject, html);
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Trigger the one-time interactive Graph consent (from a user gesture). */
export async function enableNotifications(): Promise<void> {
  await getGraphToken(GRAPH_MAIL_SCOPES, { interactive: true });
}

interface RequestLike {
  requester: string;
  requested_role?: string;
  target_name: string;
  justification?: string;
}

/** Email the configured approver(s) that a request awaits review. */
export function notifyApprovers(req: RequestLike, appUrl: string): Promise<MailResult> {
  const role = esc(req.requested_role);
  const ws = esc(req.target_name);
  const subject = `Access request: ${req.requested_role} on ${req.target_name}`;
  const html =
    `<p><b>${esc(req.requester)}</b> requested <b>${role}</b> access on ` +
    `workspace <b>${ws}</b>.</p>` +
    (req.justification ? `<p><i>${esc(req.justification)}</i></p>` : '') +
    `<p><a href="${esc(appUrl)}/approvals">Review &amp; approve in the Data Catalog</a></p>`;
  return send(APPROVERS, subject, html);
}

/** Email the requester the decision outcome. */
export function notifyRequester(
  req: RequestLike,
  decision: 'Approved' | 'Denied',
  fulfilled: boolean
): Promise<MailResult> {
  const role = esc(req.requested_role);
  const ws = esc(req.target_name);
  const subject = `Your access request was ${decision.toLowerCase()}`;
  const html =
    decision === 'Approved'
      ? `<p>Your request for <b>${role}</b> on <b>${ws}</b> was <b>approved</b>` +
        (fulfilled ? ' and access was granted.' : ' — fulfilment is pending.') +
        `</p>`
      : `<p>Your request for <b>${role}</b> on <b>${ws}</b> was <b>denied</b>.</p>`;
  return send([req.requester], subject, html);
}
