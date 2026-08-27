/**
 * Entra ID group manager — list, create, and manage membership of Microsoft
 * Entra (Azure AD) security groups via Microsoft Graph.
 *
 * Uses delegated Graph scopes acquired through MSAL. `Group.ReadWrite.All` and
 * `User.Read.All` are admin-consentable; the signed-in admin consents once via
 * {@link enableGroupManagement}. All calls run in the browser against Graph
 * (CORS-enabled) with the signed-in user's token.
 */
import { getGraphToken, GraphSignInRequiredError } from './fabricAuth';

const GROUP_SCOPES = [
  'https://graph.microsoft.com/Group.ReadWrite.All',
  'https://graph.microsoft.com/User.Read.All',
];

export interface EntraGroup {
  id: string;
  displayName: string;
  description?: string | null;
  securityEnabled?: boolean;
  mailEnabled?: boolean;
  mail?: string | null;
  groupTypes?: string[];
}

export interface GroupMember {
  id: string;
  displayName?: string;
  userPrincipalName?: string;
  type: string;
}

export { GraphSignInRequiredError };

/** One-time interactive consent for the group-management scopes. */
export async function enableGroupManagement(): Promise<void> {
  await getGraphToken(GROUP_SCOPES, { interactive: true });
}

async function graph<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getGraphToken(GROUP_SCOPES);
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph ${method} ${path} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** List Entra groups, optionally filtered by a display-name prefix search. */
export async function listGroups(search?: string): Promise<EntraGroup[]> {
  const select = '$select=id,displayName,description,securityEnabled,mailEnabled,mail,groupTypes';
  const q = search?.trim()
    ? `&$filter=${encodeURIComponent(`startswith(displayName,'${search.replace(/'/g, "''")}')`)}`
    : '';
  const data = await graph<{ value: EntraGroup[] }>('GET', `/groups?${select}&$top=100${q}`);
  return (data.value ?? []).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Create a new Entra **security** group. */
export async function createSecurityGroup(input: {
  displayName: string;
  mailNickname: string;
  description?: string;
}): Promise<EntraGroup> {
  return graph<EntraGroup>('POST', '/groups', {
    displayName: input.displayName,
    description: input.description || undefined,
    mailEnabled: false,
    securityEnabled: true,
    mailNickname: input.mailNickname.replace(/[^a-zA-Z0-9._-]/g, ''),
  });
}

/** List a group's members (users). */
export async function listMembers(groupId: string): Promise<GroupMember[]> {
  const data = await graph<{ value: Record<string, unknown>[] }>(
    'GET',
    `/groups/${groupId}/members?$select=id,displayName,userPrincipalName&$top=100`
  );
  return (data.value ?? []).map((m) => ({
    id: String(m.id),
    displayName: m.displayName as string | undefined,
    userPrincipalName: m.userPrincipalName as string | undefined,
    type: String((m['@odata.type'] as string) ?? '').replace('#microsoft.graph.', '') || 'user',
  }));
}

/** Add a member by user principal name (email). Resolves the user then links it. */
export async function addMemberByUpn(groupId: string, upn: string): Promise<void> {
  const user = await graph<{ id: string }>('GET', `/users/${encodeURIComponent(upn.trim())}?$select=id`);
  await graph('POST', `/groups/${groupId}/members/$ref`, {
    '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${user.id}`,
  });
}

/** Remove a member from a group. */
export async function removeMember(groupId: string, memberId: string): Promise<void> {
  await graph('DELETE', `/groups/${groupId}/members/${memberId}/$ref`);
}
