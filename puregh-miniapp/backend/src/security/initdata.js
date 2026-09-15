import crypto from 'node:crypto';
import config from '../config.js';

// Telegram Mini App initData validation
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// Empirically verified against real Telegram initData (2026-09-16).
// The official doc says secret_key = HMAC(bot_token, "WebAppData"), but real
// Telegram signs with the REVERSED orientation, and the data_check_string uses
// URL-DECODED values (and includes every field except "hash", even signature):
//
//   secret_key        = HMAC_SHA256("WebAppData", bot_token)   <- binary
//   computed_hash     = HMAC_SHA256(secret_key, data_check_string)  <- hex
//
//   data_check_string = all key=value pairs EXCEPT "hash", decoded values,
//                       sorted by key, joined with "\n".
export function validateInitData(initData, maxAgeMs = 86400_000) {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const pairs = [...params.entries()]
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
  const hash = params.get('hash');
  if (!hash) return null;

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (process.env.DEBUG_AUTH) console.log('[auth] dcs:', JSON.stringify(dataCheckString));
  if (process.env.DEBUG_AUTH) console.log('[auth] computed:', computedHash, 'hash:', hash);
  const valid = computedHash === hash;
  if (!valid) return null;

  // Replay protection: reject stale initData.
  const authDate = Number(params.get('auth_date') || 0);
  const fresh = authDate && Date.now() / 1000 - authDate < maxAgeMs;
  if (!fresh) return null;

  let user = null;
  try {
    const raw = params.get('user');
    if (raw) user = JSON.parse(raw);
  } catch {
    user = null;
  }

  return {
    auth_date: authDate,
    user,
    query_id: params.get('query_id') || null,
    is_owner: user && String(user.id) === config.ownerChat,
  };
}
