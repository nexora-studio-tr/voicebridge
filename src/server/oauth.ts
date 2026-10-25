import { z } from 'zod';
import { Fault, Snowflake, type DiscordConfig, type Identity } from '../core/contracts.js';

/** Only the user's normal authorization-code sign-in. No diagnostic token grants or retries. */
export async function exchangeDiscordCode(
  config: Pick<DiscordConfig, 'applicationId' | 'clientSecret'>,
  origin: string,
  code: string,
  request: typeof fetch = fetch,
): Promise<Identity> {
  try {
    const response = await request('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.applicationId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: origin + '/auth/callback',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { error?: unknown } | null;
      const knownErrors = [
        'invalid_client',
        'invalid_grant',
        'invalid_request',
        'invalid_scope',
        'access_denied',
        'unsupported_grant_type',
      ];
      const kind =
        typeof detail?.error === 'string' && knownErrors.includes(detail.error)
          ? detail.error
          : 'OTHER';
      console.warn(
        JSON.stringify({
          event: 'discord_oauth_rejected',
          stage: 'token',
          status: response.status,
          kind,
        }),
      );
      if (response.status === 401 || detail?.error === 'invalid_client')
        throw new Fault('DISCORD_OAUTH_CLIENT_REJECTED', 502);
      if (detail?.error === 'invalid_grant') throw new Fault('DISCORD_OAUTH_CODE_REJECTED', 400);
      if (response.status === 429) throw new Fault('DISCORD_OAUTH_RATE_LIMIT', 429);
      throw new Fault('DISCORD_OAUTH_EXCHANGE_FAILED', 502);
    }
    const credentials = z
      .object({ access_token: z.string().min(1).max(300) })
      .parse(await response.json());
    const me = await request('https://discord.com/api/v10/users/@me', {
      headers: { authorization: 'Bearer ' + credentials.access_token },
      signal: AbortSignal.timeout(10000),
    });
    if (!me.ok) throw new Fault('DISCORD_OAUTH_IDENTITY_FAILED', 502);
    const person = z
      .object({
        id: Snowflake,
        username: z.string().min(1).max(100),
        global_name: z.string().max(100).nullable().optional(),
      })
      .parse(await me.json());
    return { id: person.id, name: person.global_name ?? person.username, operator: false };
  } catch (error) {
    if (error instanceof Fault) throw error;
    throw new Fault('DISCORD_OAUTH_UNAVAILABLE', 502);
  }
}
