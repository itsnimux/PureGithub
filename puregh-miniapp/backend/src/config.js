import 'dotenv/config';

const config = {
  port: Number(process.env.PORT || 3001),
  db: {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5433),
    database: process.env.PGDATABASE || 'puregh',
    user: process.env.PGUSER || 'puregh',
    password: process.env.PGPASSWORD || '',
  },
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  ownerChat: String(process.env.OWNER_CHAT || '5622960785'),
  channelChat: String(process.env.CHANNEL_CHAT_ID || '-1004481247137'),
  miniAppUrl: process.env.MINIAPP_URL || '',
  llm: {
    baseUrl: process.env.LLM_BASE_URL || '',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || '',
    fallbackModel: process.env.LLM_FALLBACK_MODEL || '',
  },
  githubToken: process.env.GITHUB_TOKEN || '',
};

const required = ['botToken'];
for (const k of required) {
  if (!config[k]) console.error(`[config] missing required env: ${k}`);
}

export default config;