// @vitest-environment jsdom
//
// Regression test for the bodyless-DELETE 500 bug:
// apiFetch must NOT send `Content-Type: application/json` when there is no
// body — Fastify rejects an empty body with that header
// (FST_ERR_CTP_EMPTY_JSON_BODY) and the API surfaces it as a 500
// INTERNAL_ERROR. This broke org delete, member removal, and role delete
// from the browser.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../index';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('omits Content-Type on a bodyless DELETE (Fastify rejects empty JSON bodies with 500)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { deletionScheduledAt: '2026-08-31T00:00:00.000Z' } }));

    await apiFetch('/v1/organizations/org-1', { method: 'DELETE' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // `mock.calls[0]` is possibly undefined under noUncheckedIndexedAccess,
    // so fall back to an empty tuple before destructuring.
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('sends Content-Type: application/json when a JSON body is present', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { data: { id: 'org-1' } }));

    await apiFetch('/v1/organizations', {
      method: 'POST',
      body: JSON.stringify({ name: 'Acme' }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
  });
});
