const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sessionLifetimeMs = 8 * 60 * 60 * 1000;

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
});

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function hashPassword(password) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(password));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sessionKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function createSession(username, secret) {
  const payload = toBase64Url(encoder.encode(JSON.stringify({
    username,
    expiresAt: Date.now() + sessionLifetimeMs,
  })));
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

async function isValidSession(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) {
    return false;
  }

  try {
    const validSignature = await crypto.subtle.verify(
      'HMAC',
      await sessionKey(env.SESSION_SECRET),
      fromBase64Url(signature),
      encoder.encode(payload),
    );
    if (!validSignature) {
      return false;
    }

    const claims = JSON.parse(decoder.decode(fromBase64Url(payload)));
    return claims.username === env.LOGIN_USERNAME && claims.expiresAt > Date.now();
  } catch {
    return false;
  }
}

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(env.ALLOWED_ORIGIN || 'null');
    const path = new URL(request.url).pathname.replace(/\/+$/g, '');

    if (!origin || origin !== env.ALLOWED_ORIGIN) {
      return new Response('Forbidden', { status: 403 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    }

    const requiredSecrets = [
      env.ALLOWED_ORIGIN,
      env.LOGIN_USERNAME,
      env.LOGIN_PASSWORD_SHA256,
      env.SESSION_SECRET,
      env.TRIGGER_MESSAGE,
      env.AUTO_REPLY,
    ];
    if (requiredSecrets.some((secret) => !secret)) {
      return Response.json({ error: 'Reply service is not configured' }, { status: 503, headers });
    }

    const body = await readBody(request);
    if (!body) {
      return Response.json({ error: 'Invalid request' }, { status: 400, headers });
    }

    if (path.endsWith('/login')) {
      if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length > 256) {
        return Response.json({ error: 'Invalid credentials' }, { status: 400, headers });
      }

      const submittedHash = await hashPassword(body.password);
      if (body.username !== env.LOGIN_USERNAME || submittedHash !== env.LOGIN_PASSWORD_SHA256.toLowerCase()) {
        return Response.json({ error: 'Invalid username or password' }, { status: 401, headers });
      }

      return Response.json({ token: await createSession(body.username, env.SESSION_SECRET) }, { headers });
    }

    if (!path.endsWith('/reply')) {
      return Response.json({ error: 'Not found' }, { status: 404, headers });
    }

    if (!(await isValidSession(request, env))) {
      return Response.json({ error: 'Authentication required' }, { status: 401, headers });
    }

    if (typeof body.message !== 'string' || body.message.length > 280 || typeof body.chatId !== 'string') {
      return Response.json({ error: 'Invalid message' }, { status: 400, headers });
    }

    const matches = body.chatId === 'crew'
      && body.message.trim().toLowerCase() === env.TRIGGER_MESSAGE.trim().toLowerCase();
    return Response.json({ sender: 'Tripple T', reply: matches ? env.AUTO_REPLY : null }, { headers });
  },
};