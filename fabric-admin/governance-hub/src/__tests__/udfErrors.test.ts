/**
 * The Setup page used to print the raw UDF failure envelope — 400+ characters
 * of nested JSON in which the actionable fact (a missing scope) was invisible.
 * Verified against the real body returned by the demo tenant (D43).
 */

import { describe, expect, it } from 'vitest';

import { describeUdfFailure } from '@/services/udfClient';

// Captured verbatim from the deployed app against the MCAPS tenant.
const REAL_403_BODY = JSON.stringify({
  functionName: 'fabric_proxy',
  invocationId: '00000000-0000-0000-0000-000000000000',
  status: 'Failed',
  output: '',
  errors: [
    {
      errorCode: 'InternalError',
      message: 'An internal execution error occured during function execution',
      properties: {
        error_type: 'RuntimeError',
        error_message:
          'fabric GET /admin/tenantsettings failed (403): {"requestId":"21a0e480",' +
          '"errorCode":"InsufficientScopes","message":"The caller does not have ' +
          'sufficient scopes to perform this operation","isRetriable":false}',
      },
    },
  ],
});

describe('describeUdfFailure', () => {
  it('names the missing scope instead of dumping the envelope', () => {
    const message = describeUdfFailure(500, REAL_403_BODY);
    expect(message).toContain('Tenant.Read.All');
    // The operator must not be shown the raw plumbing.
    expect(message).not.toContain('invocationId');
    expect(message).not.toContain('InternalError');
    expect(message.length).toBeLessThan(300);
  });

  it('reports a generic 403 without inventing a specific cause', () => {
    const body = JSON.stringify({
      errors: [{ properties: { error_message: 'fabric GET /workspaces failed (403): denied' } }],
    });
    const message = describeUdfFailure(500, body);
    expect(message).toContain('403');
    // Must not claim the scope is the problem when the code says otherwise.
    expect(message).not.toContain('Tenant.Read.All');
  });

  it('falls back to the raw body when it is not the expected envelope', () => {
    const message = describeUdfFailure(502, 'upstream timeout');
    expect(message).toContain('502');
    expect(message).toContain('upstream timeout');
  });

  it('truncates a very long body', () => {
    const message = describeUdfFailure(500, 'x'.repeat(5000));
    expect(message.length).toBeLessThan(300);
  });
});
