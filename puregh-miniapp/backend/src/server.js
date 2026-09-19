import express from 'express';
import cors from 'cors';
import config from './config.js';
import { validateInitData } from './security/initdata.js';
import routes from './routes.js';

const app = express();
app.use(cors());
app.use(express.json());

// ---- auth middleware: every route must carry a valid, fresh Telegram initData
// and must belong to the owner. This is the mini-app's only gate.
function requireOwner(req, res, next) {
  const initData = req.header('x-telegram-init-data') || '';
  if (process.env.DEBUG_AUTH) console.log('[auth] raw initData:', JSON.stringify(initData));
  const auth = validateInitData(initData);
  if (process.env.DEBUG_AUTH) console.log('[auth] result:', auth ? `OK owner=${auth.is_owner} user=${auth.user?.id}` : 'INVALID (hash or freshness)');
  if (!auth || !auth.is_owner) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.auth = auth;
  next();
}

app.use('/api', requireOwner, routes);

app.get('/health', (_req, res) => res.json({ ok: true }));

// static frontend build (served at the same origin)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '../../frontend/dist');
app.use(express.static(distDir));

// SPA fallback: the Telegram web_app button deep-links to /post/:id (and /add),
// which the router handles client-side. Serve index.html on any unmatched GET.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/health')) return next();
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`[puregh-miniapp] backend on :${config.port}`);
  console.log(`[puregh-miniapp] owner chat ${config.ownerChat}`);
  if (!config.llm.model) console.warn('[puregh-miniapp] LLM_MODEL not set (regen/addgen disabled)');
  if (!config.miniAppUrl) console.warn('[puregh-miniapp] MINIAPP_URL not set (open-app button points nowhere)');
});