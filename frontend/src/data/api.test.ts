import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerApi } from './api';
import { computeMetrics } from './domain';

afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown, ok = true, status = 200) => ({ ok, status, json: async () => data });
describe('server transport', () => {
  it('bootstraps one shared session before concurrent GraphQL requests and forwards the CSRF token', async () => {
    const dashboard = { meetings: [], tasks: [], metrics: computeMetrics([], []) };
    const fetch = vi.fn().mockResolvedValueOnce(response({ csrfToken: 'test-csrf-token', workspaceId: 'workspace-1' })).mockResolvedValue(response({ data: { dashboard } }));
    vi.stubGlobal('fetch', fetch);
    const api = createServerApi();
    await Promise.all([api.getDashboard(), api.getDashboard()]);
    expect(fetch.mock.calls.filter(([url]) => url === '/api/session/')).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith('/graphql/', expect.objectContaining({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': 'test-csrf-token' } }));
  });
  it('preserves meaningful server conflict messages and codes', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ csrfToken: 'token' })).mockResolvedValueOnce(response({ errors: [{ message: 'This task changed in another tab.', extensions: { code: 'CONFLICT' } }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(createServerApi().updateTask('task-1', 'DONE', 1)).rejects.toMatchObject({ message: 'This task changed in another tab.', code: 'CONFLICT' });
  });
  it('invalidates an expired CSRF session before the next request', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ csrfToken: 'old' })).mockResolvedValueOnce(response({}, false, 403)).mockResolvedValueOnce(response({ csrfToken: 'new' })).mockResolvedValueOnce(response({ data: { dashboard: { meetings: [], tasks: [], metrics: computeMetrics([], []) } } }));
    vi.stubGlobal('fetch', fetch);
    const api = createServerApi();
    await expect(api.getDashboard()).rejects.toThrow('session expired');
    await api.getDashboard();
    expect(fetch.mock.calls.filter(([url]) => url === '/api/session/')).toHaveLength(2);
    expect(fetch.mock.calls[3][1].headers['X-CSRFToken']).toBe('new');
  });
});
