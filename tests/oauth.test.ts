import { describe, expect, it, vi } from 'vitest';
import { exchangeDiscordCode } from '../src/server/oauth.js';
const config = {
  applicationId: '111111111111111111',
  clientSecret: 'fake-local-test-client-secret',
};
describe('normal Discord authorization-code exchange', () => {
  it('uses the exact callback, then returns identity without tokens or credentials', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'fake-access-token',
            refresh_token: 'discard-this-token',
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: '333333333333333333', username: 'alice', global_name: 'Alice' }),
        ),
      );
    const result = await exchangeDiscordCode(
      config,
      'http://127.0.0.1:4347',
      'fresh-test-code',
      request,
    );
    expect(result).toEqual({ id: '333333333333333333', name: 'Alice', operator: false });
    const body = request.mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:4347/auth/callback');
    expect(body.get('code')).toBe('fresh-test-code');
    expect(request.mock.calls[1]![0]).toBe('https://discord.com/api/v10/users/@me');
    expect(JSON.stringify(result)).not.toContain('token');
  });
  it.each([
    [401, 'invalid_client', 'DISCORD_OAUTH_CLIENT_REJECTED'],
    [400, 'invalid_grant', 'DISCORD_OAUTH_CODE_REJECTED'],
    [429, 'rate_limited', 'DISCORD_OAUTH_RATE_LIMIT'],
    [500, 'server_error', 'DISCORD_OAUTH_EXCHANGE_FAILED'],
  ] as const)(
    'classifies HTTP %i without exposing provider details or retrying',
    async (status, error, expected) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error, error_description: 'private-provider-diagnostic' }),
            { status },
          ),
        );
      await expect(
        exchangeDiscordCode(config, 'http://127.0.0.1:4347', 'test', request),
      ).rejects.toThrow(expected);
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it('separates identity-lookup failures from client authentication failures', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fake-access' })))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }));
    await expect(
      exchangeDiscordCode(config, 'http://127.0.0.1:4347', 'test', request),
    ).rejects.toThrow('DISCORD_OAUTH_IDENTITY_FAILED');
  });
  it('does not disclose network or malformed provider response details', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('private transport detail'));
    await expect(
      exchangeDiscordCode(config, 'http://127.0.0.1:4347', 'test', request),
    ).rejects.toThrow('DISCORD_OAUTH_UNAVAILABLE');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
