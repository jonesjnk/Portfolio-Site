const ALLOWED_ORIGINS = new Set([
  'https://jjank.com',
  'https://www.jjank.com',
  'http://localhost:5173',
  'http://localhost:4321',
]);

const ENDPOINT_PATH = '/api/now-playing';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const PLAYER_URL = 'https://api.spotify.com/v1/me/player/currently-playing';
const TOKEN_MARGIN_SECONDS = 60;
const PAUSE_LIMIT_MS = 10 * 60 * 1000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
    }

    if (url.pathname !== ENDPOINT_PATH) {
      return new Response('Not Found', { status: 404 });
    }

    const cache = await caches.open('now-playing');
    const tokenKey = `${url.origin}/cache/token`;

    const getAccessToken = async () => {
      const cached = await cache.match(tokenKey);

      if (cached) {
        return { accessToken: await cached.text() };
      }

      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: env.SPOTIFY_REFRESH_TOKEN,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return { needsReauth: data.error === 'invalid_grant' };
      }

      ctx.waitUntil(
        cache.put(
          tokenKey,
          new Response(data.access_token, {
            headers: { 'Cache-Control': `max-age=${data.expires_in - TOKEN_MARGIN_SECONDS}` },
          }),
        ),
      );

      return { accessToken: data.access_token };
    };

    const getNowPlaying = async () => {
      const { accessToken, needsReauth } = await getAccessToken();

      if (!accessToken) {
        return needsReauth ? { isPlaying: false, needsReauth: true } : { isPlaying: false };
      }

      const response = await fetch(PLAYER_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (response.status === 401) {
        ctx.waitUntil(cache.delete(tokenKey));
      }

      const data = await response.json().catch(() => ({}));
      const pausedTooLong = !data.is_playing && Date.now() - data.timestamp > PAUSE_LIMIT_MS;

      if (!data.item?.album || pausedTooLong) {
        return { isPlaying: false };
      }

      const { images } = data.item.album;

      return {
        isPlaying: data.is_playing,
        track: data.item.name,
        artist: data.item.artists.map((artist) => artist.name).join(', '),
        art: (images[1] ?? images[0])?.url ?? null,
        url: data.item.external_urls.spotify,
        progressMs: data.progress_ms,
        durationMs: data.item.duration_ms,
      };
    };

    const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });

    if (ALLOWED_ORIGINS.has(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
    }

    return Response.json(await getNowPlaying(), { headers });
  },
};
