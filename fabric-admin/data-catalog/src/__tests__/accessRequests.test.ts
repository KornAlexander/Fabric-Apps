import { describe, expect, it } from 'vitest';

import { WORKSPACE_ROLES, grantBody } from '@/services/accessRequests';

describe('access requests', () => {
  it('grantBody builds a User role-assignment payload', () => {
    expect(grantBody('oid-123', 'Member')).toEqual({
      principal: { id: 'oid-123', type: 'User' },
      role: 'Member',
    });
  });

  it('grantBody supports non-user principal types', () => {
    expect(grantBody('grp-1', 'Viewer', 'Group')).toEqual({
      principal: { id: 'grp-1', type: 'Group' },
      role: 'Viewer',
    });
  });

  it('exposes the four workspace roles', () => {
    expect(WORKSPACE_ROLES).toEqual(['Viewer', 'Contributor', 'Member', 'Admin']);
  });
});
