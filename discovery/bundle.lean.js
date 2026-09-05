const R = (function () {
const HARD_REJECT = {
  archived: true,   // author has declared it over
  template: true,   // scaffolding, not a project
  fork: true,       // spec §8 "obvious forks"
  disabled: true,   // GitHub itself disabled the repo
  minReadmeBytes: 300,
  maxSizeKb: 1_000_000,
  configDumps: false,
  piracy: true,
};
const CONFIG_DUMP_SIGNALS = {
  noLanguagePoints: 1,
  namePatternPoints: 2,
  topicPatternPoints: 1,
  descPatternPoints: 2,
  rejectAtScore: 2,
  namePatterns: [
    'free[-_ ]?nodes?', 'free[-_ ]?(vpn|proxy|servers?)', 'nodes?[-_ ]?free',
    'v2ray[-_ ]?config', 'clash[-_ ]?(free|rules)', 'ssr[-_ ]?(free|share)',
    'sub[-_ ]?(link|list)s?',
    '[-_]rules?[-_]?(dat|list)?$',
    '(domain|ip|geosite|geoip|hosted[-_ ]?domain)s?[-_ ]?list',
    'hosted[-_ ]?domains', 'proxy[-_ ]?list',
    'share[-_ ]?(ssr|v2ray|node)',
    '(node|sub|config|proxy|v2ray|vless|vmess)[-_ ]?collect(or|ion)?',
    'collect(or|ion)?[-_ ](node|sub|config|proxy)',
    'bulk[-_ ]?(xray|v2ray|vless|vmess)',
  ],
  topicPatterns: [
    'free[-_]?nodes?', 'free[-_]?proxy', 'free[-_]?vpn', 'node[-_]?list',
    'proxy[-_]?list', 'subscription', 'v2ray[-_]?config', 'geosite', 'geoip',
    'proxy[-_]?collector', 'config[-_]?collector', 'free[-_]?internet',
    'clash[-_]?config', 'v2ray[-_]?subscription',
    'domains?[-_]?list', 'domain[-_]?lists?',
  ],
  descPatterns: [
    '(config|node|proxy|subscription|domain|ip)s?\\s+(collector|aggregator|list)',
    '(collector|aggregator)\\s+(of|for)\\s+',
    'auto[- ]?update(d|s)?\\s+every',
    'updated?\\s+every\\s+\\d+\\s*(min|hour|h\\b)',
    'free\\s+(v2ray|vless|vmess|trojan|shadowsocks|clash|ssr|node|proxy|vpn|internet)',
    'configs?\\s+(splitted|split|sorted|grouped)\\s+by',
    '(comprehensive|curated)\\s+list\\s+of\\s+\\w+\\s+domains',
    'routing\\s+rules',
    '免费|翻墙|机场|节点',   // Chinese: free / wall-crossing / airport / nodes
  ],
};
const PIRACY_PATTERNS = [
  'crack(ed|er)?', 'keygen', 'nulled', 'warez', 'activator', 'kms[-_]?pico',
  'mod[-_]?apk', 'premium[-_]?unlock', 'license[-_]?bypass', 'patcher',
  'cheat[-_]?(engine|table|menu)', 'aimbot', 'wallhack',
];
const LANE_PRIORITY = [
  'iran_relevant',
  'ai_agents',
  'trending',
  'hidden_gem',
  'established',
  'curated_list',
];
const LANES = {
  iran_relevant: {
    starsMin: 20,
    starsMax: null,          // no ceiling — popularity is not a defect here
    minAgeDays: 14,
    maxDaysSincePush: 400,
    idleForgiveness: { minStars: 1000, maxDaysSincePush: 1500 },
    requiresIranRelevance: true,
    attentionCurve: 'flat',
  },
  ai_agents: {
    starsMin: 80,
    starsMax: null,
    minAgeDays: 14,
    maxDaysSincePush: 120,   // strict: an AI tool untouched for four months is
    requiresAiRelevance: true,
    attentionCurve: 'rising',
  },
  trending: {
    starsMin: 200,
    starsMax: null,
    minAgeDays: 7,
    maxAgeDays: 90,
    maxDaysSincePush: 30,
    minVelocityPerDay: 12,   // the entry condition for this lane
    attentionCurve: 'rising',
  },
  hidden_gem: {
    starsMin: 50,
    starsMax: 4000,
    minAgeDays: 21,
    maxDaysSincePush: 365,
    maxVelocityPerDay: 30,
    attentionCurve: 'bell',
  },
  established: {
    starsMin: 1500,          // real adoption, to justify waiving obscurity
    minAgeDays: 180,
    maxDaysSincePush: 240,
    attentionCurve: 'flat',
  },
  curated_list: {
    starsMin: 300,
    iranStarsMin: 100,       // lower floor when the list is Iran-relevant
    starsMax: null,
    minAgeDays: 90,
    maxDaysSincePush: 300,   // an unmaintained list is a list of dead links
    idleForgiveness: { minStars: 800, maxDaysSincePush: 1100 },
    attentionCurve: 'flat',
  },
};
const IDLE_FORGIVENESS_NOTE = 'see comment above';
const LANE_COVERAGE_NOTE = 'see comment above';
const LANE_QUOTA = {
  iran_relevant: 3,
  ai_agents: 3,
  trending: 2,
  hidden_gem: 3,
  established: 2,
  curated_list: 1,   // stays at 1: lists are the cheapest thing to find and
};
const MULTI_LANE_BONUS = { perExtraLane: 4, max: 8 };
const CURATED_LIST_PATTERNS = [
  '^awesome[-_]', '[-_]awesome$', '^awesome$',
  '^best[-_]of[-_]', '^list[-_]of[-_]', '^curated[-_]',
  '[-_]resources$', '^resources[-_]', 'cheat[-_]?sheet',
  '[-_]roadmap$', '^roadmap[-_]', '[-_]handbook$',
];
const CURATED_LIST_TOPICS = [
  'awesome', 'awesome-list', 'awesome-lists', 'curated-list', 'curated',
  'list', 'lists', 'resources', 'collection', 'directory',
  'cheatsheet', 'cheat-sheet', 'roadmap', 'learning-resources',
];
const QUALITY = {
  craft: 45,      // evidence of deliberate effort  <-- largest on purpose
  attention: 20,  // lane-specific, see ATTENTION_CURVES
  aliveness: 20,
  adoption: 15,   // proof that real people use it
};
const CRAFT = {
  readmeLength: 10,
  demoMedia: 9,           // gif / video / asciinema / screenshot. Strongest
  structure: 8,           // headings + fenced code blocks = written for a reader
  installInstructions: 6, // an install/usage section means it is meant to be
  description: 5,
  topics: 4,
  homepage: 2,
  license: 1,
};
const README_BAND = {
  minBytes: 800,        // above the hard-reject floor but still thin
  goodBytes: 2500,      // full marks from here up
  plateauBytes: 20_000, // past here, extra length stops meaning extra care
};
const ATTENTION_CURVES = {
  bell: { peakStars: 400, sigmaLog10: 0.5 },
  rising: { saturationStars: 5000 },
  flat: { baselinePoints: 14, floorClearedBonus: 6 },
};
const ALIVENESS = {
  freshnessPoints: 13,
  maturityPoints: 7,
  freshnessHalfLifeDays: 180,
  maturitySaturationDays: 365,
};
const MOMENTUM_NOTE = 'lifetime average; see comment';
const ADOPTION = {
  forksPoints: 6,
  issueActivityPoints: 5,
  contributorsPoints: 4,
  forksSaturation: 60,
  issuesSaturation: 25,
  contributorsSaturation: 8,  // costs one extra API call; fetched only for
};
const RELEVANCE = {
  iranMax: 25,
  aiMax: 15,
  iranianCreatorMax: 10,
};
const IRAN_RELEVANCE = {
  tier1Points: 25,
  tier1Topics: [
    'iran', 'iranian', 'persian', 'farsi', 'jalali', 'shamsi', 'tehran',
    'anti-censorship', 'censorship-circumvention', 'censorship',
    'v2ray', 'vless', 'vmess', 'xray', 'sing-box', 'singbox', 'clash',
    'hysteria', 'hysteria2', 'trojan-go', 'shadowsocks', 'reality',
    'warp', 'wireguard-config', 'psiphon', 'tor-bridge', 'gfw',
    'firewall-bypass', 'domain-fronting', 'proxy-client',
  ],
  tier2Points: 15,
  tier2Topics: [
    'jalali-calendar', 'persian-calendar', 'rtl', 'rtl-support',
    'persian-nlp', 'farsi-nlp', 'persian-font', 'arabic-nlp',
    'registry-mirror', 'npm-mirror', 'pypi-mirror', 'docker-registry-proxy',
    'package-mirror', 'sanctions', 'offline-install', 'air-gapped',
  ],
  tier2Keywords: [   // matched in description + README
    'jalali', 'shamsi', 'persian calendar', 'rial', 'toman',
    'sanction', 'geo-?block', 'region[- ]?lock',
    'not available in your country', 'mirror for', 'offline installer',
  ],
  tier3Points: 8,
  tier3Topics: [
    'self-hosted', 'selfhosted', 'offline-first', 'local-first', 'privacy',
    'no-cloud', 'e2e-encryption', 'p2p', 'decentralized', 'foss-alternative',
  ],
  persianTextMinChars: 40,
  persianTextPoints: 20,
};
const AI_BOOST = {
  points: 15,
  reviewAfter: '2027-03-01',
  topics: [
    'llm', 'llms', 'ai-agent', 'ai-agents', 'agents', 'agentic',
    'mcp', 'model-context-protocol', 'rag', 'retrieval-augmented-generation',
    'langchain', 'llamaindex', 'vector-database', 'embeddings',
    'openai', 'anthropic', 'claude', 'gpt', 'ollama', 'local-llm',
    'fine-tuning', 'prompt-engineering', 'ai-tools', 'copilot',
    'speech-to-text', 'text-to-speech', 'computer-vision', 'diffusion',
  ],
  slopPatterns: [
    'chatgpt clone', 'gpt wrapper', 'ai wrapper', 'just a wrapper',
    'awesome[- ]chatgpt[- ]prompts', 'prompt collection', 'prompts? list',
    '\\d+ prompts', 'chatbot tutorial', 'openai api example',
  ],
};
const PROMPT_DUMP_SIGNALS = {
  namePoints: 2,
  descPoints: 2,
  noLanguagePoints: 1,   // corroborating only, same lesson as CONFIG_DUMP_SIGNALS
  rejectAtScore: 3,      // needs name OR desc plus something else — never no-language alone
  namePatterns: [
    'prompts?[-_ ]?(list|collection|library|pack|vault|dump|leaks?)',
    '(system|leaked|jailbreak)[-_ ]?prompts?',
    'prompts?[-_ ]?(zh|cn|ja|jp|kr)$',
    'awesome[-_ ]?(chatgpt|gpt\\d?o?|ai)?[-_ ]?prompts?',
    'jailbreak', '\\bdan\\b',
    'prompt[-_ ]?engineering',
    'instruction[-_ ]?datasets?',
    '[-_]prompts?$', '^prompts?[-_.]', 'prompts?[-_ ]?(chat|hub|store)',
  ],
  descPatterns: [
    '(collection|curated|list|set|library|archive)\\s+(of\\s+)?[\\w\\s-]{0,24}prompts?',
    'prompts?\\s+(collection|library|list|repository|vault|archive)',
    '(leaked|extracted|system)\\s+prompts?',
    'prompts?\\s+(for|from)\\s+(chatgpt|gpt|claude|gemini|midjourney|top-rated)',
    'jailbreaks?\\s+prompt', 'prompt\\s+injection/?leaking',
    'prompts?\\s+leaking', 'collect\\s+prompts?',
    'prompt\\s+(manager|generation model)',
    'awesome\\s+curated\\s+collection',
    'resources\\s+for\\s+[\\w\\s-]{0,30}prompt',
    '\\d+\\s+prompts?', 'prompts?\\s+(cover|covers)\\s+a\\s+range',
    '调教指南', '提示词', 'プロンプト', 'prompt\\s+精选',
  ],
};
const IRANIAN_CREATOR = {
  points: 10,
  locationPatterns: [
    'iran', 'ایران', 'ايران', 'tehran', 'tehrān', 'تهران', 'طهران',
    'mashhad', 'isfahan', 'esfahan', 'shiraz', 'tabriz', 'karaj', 'qom',
    'ahvaz', 'kerman', 'yazd', 'rasht', 'urmia', 'zahedan', 'kish',
  ],
  checkLocationAtStage: 3,
  knownOwners: [
    'rastikerdar', 'roshan-research', 'hezarai', 'mohebifar', 'sajaddp',
    'majidh1', '1995parham', 'shahabyazdi', 'talkhabi', 'ashkanRmk',
    'bootmortis', 'Chocolate4U', 'barnamenevisi', 'matnbaz', 'hiddify',
    'alireza0', 'Ptechgithub', 'persian-tools', 'omid', 'Kiarash-Z',
    'pnarimani', '4xmen', 'ghost1372', 'sartoopjj', 'mahdiMGF2',
  ],
};
const PENALTIES = {
  configDumpPerPoint: 35,
  promptDumpPerPoint: 30,
  learningProject: 20,
  aiSlop: 18,
  forkRatioAnomaly: 8,
  neglectedIssues: 6,
  noDescription: 8,
  noLanguage: 5,
  bloated: 4,
};
const PENALTY_THRESHOLDS = {
  forkRatio: 0.5,
  issueToStarRatio: 0.3,
  minDescriptionChars: 15,
  bloatedSizeKb: 100_000,
};
const LEARNING_PROJECT_PATTERNS = [
  'tutorials?', 'boilerplates?', 'starter kits?', 'starter templates?', 'scaffold',
  'my first', 'learning projects?', 'practice projects?', 'course projects?',
  'exercises?', 'exercise solutions?', 'homework', 'bootcamps?',
  'clone of', 'a clone', 'todo apps?', 'todo list apps?', 'crud apps?',
  'sample apps?', 'sample projects?', 'demo projects?', 'example projects?',
  'test projects?', 'playground for learning', 'follow along',
  'coding challenges?', 'leetcode', 'advent of code', 'hacktoberfest',
  'interview questions?',
];
const DEMO_MEDIA_PATTERNS = [
  '\\.gif[)"\'\\s]', '\\.mp4', '\\.webm', '\\.webp',
  'asciinema\\.org', 'youtube\\.com/watch', 'youtu\\.be/',
  'demo\\.(gif|mp4|png|webp)', 'screenshot', 'screencast',
  'user-images\\.githubusercontent\\.com',
  'github\\.com/user-attachments/assets',
];
const INSTALL_PATTERNS = [
  '## *install', '## *getting started', '## *quick ?start', '## *usage',
  '## *setup', 'npm i(nstall)? ', 'pip install ', 'cargo install ',
  'go install ', 'brew install ', 'docker run ', 'docker compose up',
  'apt install ', 'pacman -S ', 'yay -S ',
];
const FUNNEL = {
  readmeFetchLimit: 120,   // stage 1 -> 2, one raw.githubusercontent fetch each
  readmeBudgetPerLane: true,
  llmCandidateLimit: 16,
  minTotalForLlm: 70,
  minQualityForLlm: 55,
  finalSelectionSize: 8,
  purposeSimilarityThreshold: 0.45,   // description trigram; rarely fires alone
  purposeTopicJaccardThreshold: 0.35, // between 0.30 (216 pairs) and 0.40 (76)
  purposeMinSharedTopics: 3,          // guard: 1/2 topics reaches 0.5 trivially
  purposeCompareLimit: 5,             // most similar published repos shown to the LLM
};
const DIVERSITY = {
  maxPerLanguage: 2,
  maxPerCategory: 2,
  maxPerOwner: 1,
};
const QUERY = {
  queriesPerRun: 14,
  resultsPerQuery: 100,   // GitHub's per-page maximum
  allocation: {
    iran: 4,
    ai: 3,
    trending: 2,
    hidden: 3,
    established: 1,
    lists: 1,
  },
  topicSeparator: ',',
  maxQueryChars: 256,
  maxOperators: 4,
  maxTopicsPerQuery: 6,
  excludeArchived: true,
  searchSpacingMs: 2500,
  minExpectedYield: 30,
};
const QUERY_CLASSES = {
  iran: {
    topicPools: [
      ['iran', 'iranian', 'persian', 'farsi'],
      ['v2ray', 'xray', 'sing-box', 'hysteria2', 'vless', 'reality'],
      ['anti-censorship', 'censorship-circumvention', 'firewall-bypass', 'gfw'],
      ['jalali', 'persian-calendar', 'persian-nlp', 'persian-language', 'shamsi', 'right-to-left'],
    ],
    starRange: '20..*',       // no ceiling
    pushedWithinDays: 400,
    sorts: [
      { sort: 'updated', order: 'desc' },
      { sort: 'stars', order: 'desc' },
    ],
  },
  ai: {
    topicPools: [
      ['mcp', 'model-context-protocol', 'ai-agent', 'agentic'],
      ['llm', 'rag', 'embeddings', 'local-llm', 'ollama'],
      ['ai-tools', 'prompt-engineering', 'fine-tuning', 'llmops'],
    ],
    starRange: '80..*',
    pushedWithinDays: 120,
    sorts: [
      { sort: 'updated', order: 'desc' },
      { sort: 'stars', order: 'desc' },
    ],
  },
  trending: {
    createdWithinDays: 60,
    starRange: '200..*',
    sorts: [{ sort: 'stars', order: 'desc' }],
  },
  hidden: {
    starShards: ['50..120', '120..300', '300..700', '700..1500', '1500..4000'],
    createdWithinDays: 1460,
    pushedWithinDays: 400,
    sorts: [
      { sort: 'updated', order: 'desc' },
      { sort: 'stars', order: 'asc' },
      { sort: 'forks', order: 'desc' },
      { sort: 'help-wanted-issues', order: 'desc' },
    ],
  },
  established: {
    starRange: '1500..*',
    createdBeforeDays: 365,
    pushedWithinDays: 240,
    sorts: [{ sort: 'updated', order: 'desc' }],
  },
  lists: {
    namePools: ['awesome', 'curated', 'best-of', 'resources'],
    iranScopedRatio: 0.5,
    starRange: '100..*',
    pushedWithinDays: 300,
    sorts: [{ sort: 'updated', order: 'desc' }],
  },
};
const LANGUAGE_SHARDS = [
  'rust', 'go', 'python', 'typescript', 'javascript', 'c', 'cpp', 'zig',
  'lua', 'shell', 'elixir', 'ruby', 'java', 'kotlin', 'swift', 'nim',
  'ocaml', 'haskell', 'crystal', 'julia', 'clojure', 'dart', 'odin',
];
const TOPIC_SHARDS = [
  'cli', 'terminal', 'tui', 'self-hosted', 'developer-tools', 'automation',
  'privacy', 'security', 'monitoring', 'observability', 'database',
  'compiler', 'interpreter', 'parser', 'editor', 'neovim', 'git', 'docker',
  'kubernetes', 'api', 'graphql', 'visualization', 'machine-learning',
  'audio', 'music', 'video', 'graphics', 'game-engine', 'emulator',
  'networking', 'dns', 'proxy', 'vpn', 'webassembly', 'embedded',
  'raspberry-pi', 'home-automation', 'productivity', 'note-taking',
  'markdown', 'pdf', 'image-processing', 'ocr', 'testing', 'debugging',
  'profiling', 'static-site-generator', 'scraping', 'rss', 'backup',
  'encryption', 'reverse-engineering', 'p2p', 'decentralized',
];
const ROTATION = {
  epochUtc: '2026-01-01',
  shardsPerHiddenQuery: 1,
  hiddenShardKinds: ['language', 'topic'],
  languageStride: 7,
  topicStride: 11,
  starShardStride: 2,
};
const COOLDOWN = {
  humanRejected: null,          // null = never
  published: null,
  llmRejected: 365,
  nearMiss: 30,
  notSelected: 3,
  softReject: 45,
  permanentReject: null,
};
const REJECT_PERMANENCE = {
  archived: 'permanent',      // author declared it over
  fork: 'permanent',
  template: 'permanent',
  disabled: 'permanent',
  piracy: 'permanent',
  'config-dump': 'permanent',
  oversized: 'permanent',     // repos do not shrink below 1GB
  'no-readme': 'soft',        // a README can be added
  'no-lane': 'soft',          // stars grow, pushes happen
};
const CATEGORIES = [
  'AI', 'developer-tools', 'security', 'linux', 'web', 'mobile', 'creative',
  'fun', 'experimental', 'productivity', 'backend', 'gaming', 'data',
];
const LLM_MUST_JUDGE = [
  'differentiation_vs_competitors',
  'real_usefulness',
  'novelty',
  'wow_factor',
];
  return { HARD_REJECT, CONFIG_DUMP_SIGNALS, PIRACY_PATTERNS, LANE_PRIORITY, LANES, IDLE_FORGIVENESS_NOTE, LANE_COVERAGE_NOTE, LANE_QUOTA, MULTI_LANE_BONUS, CURATED_LIST_PATTERNS, CURATED_LIST_TOPICS, QUALITY, CRAFT, README_BAND, ATTENTION_CURVES, ALIVENESS, MOMENTUM_NOTE, ADOPTION, RELEVANCE, IRAN_RELEVANCE, AI_BOOST, PROMPT_DUMP_SIGNALS, IRANIAN_CREATOR, PENALTIES, PENALTY_THRESHOLDS, LEARNING_PROJECT_PATTERNS, DEMO_MEDIA_PATTERNS, INSTALL_PATTERNS, FUNNEL, DIVERSITY, QUERY, QUERY_CLASSES, LANGUAGE_SHARDS, TOPIC_SHARDS, ROTATION, COOLDOWN, REJECT_PERMANENCE, CATEGORIES, LLM_MUST_JUDGE };
})();
const A = (function (R) {
const DAY = 86_400_000;
function compile(patterns) {
  const body = patterns
    .map((p) => (/[\\^$()[\]*+?{}|]/.test(p) ? p : escapeLiteral(p)))
    .join('|');
  return new RegExp(`(?<![a-z0-9])(?:${body})(?![a-z0-9])`, 'i');
}
function compileRaw(patterns) {
  return new RegExp(patterns.join('|'), 'i');
}
function compileWords(patterns) {
  return new RegExp(`\\b(?:${patterns.join('|')})\\b`, 'i');
}
function escapeLiteral(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const RX = {
  configDumpName: compileRaw(R.CONFIG_DUMP_SIGNALS.namePatterns),
  configDumpTopic: compileRaw(R.CONFIG_DUMP_SIGNALS.topicPatterns),
  configDumpDesc: compileRaw(R.CONFIG_DUMP_SIGNALS.descPatterns),
  promptDumpName: compileRaw(R.PROMPT_DUMP_SIGNALS.namePatterns),
  promptDumpDesc: compileRaw(R.PROMPT_DUMP_SIGNALS.descPatterns),
  piracy: compile(R.PIRACY_PATTERNS),
  curatedList: compileRaw(R.CURATED_LIST_PATTERNS),
  learning: compile(R.LEARNING_PROJECT_PATTERNS),
  aiSlop: compileRaw(R.AI_BOOST.slopPatterns),
  demo: compileRaw(R.DEMO_MEDIA_PATTERNS),
  install: compileRaw(R.INSTALL_PATTERNS),
  iranLocation: compile(R.IRANIAN_CREATOR.locationPatterns),
  iranKeywords: compileWords(R.IRAN_RELEVANCE.tier2Keywords),
  persianOnly: /[\u067E\u0686\u0698\u06AF\u06A9\u06CC]/g,
};
const KNOWN_IRANIAN = new Set(
  R.IRANIAN_CREATOR.knownOwners.map((o) => o.toLowerCase()),
);
const LIST_TOPICS = new Set(R.CURATED_LIST_TOPICS);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const saturate = (v, sat) => (sat <= 0 ? 0 : 1 - Math.exp(-3 * clamp(v, 0, Infinity) / sat));
function normalize(raw, now = Date.now()) {
  const stars = num(raw.stars ?? raw.stargazers_count);
  const created = Date.parse(raw.created_at ?? raw.gh_created_at ?? '') || now;
  const pushed = Date.parse(raw.pushed_at ?? raw.gh_pushed_at ?? '') || now;
  const ageDays = Math.max(1, (now - created) / DAY);
  return {
    id: raw.id ?? raw.github_id ?? null,
    fullName: String(raw.full_name ?? ''),
    name: String(raw.name ?? String(raw.full_name ?? '').split('/')[1] ?? ''),
    owner: String(raw.owner?.login ?? raw.owner ?? ''),
    description: String(raw.description ?? ''),
    homepage: String(raw.homepage ?? ''),
    stars,
    forks: num(raw.forks ?? raw.forks_count),
    openIssues: num(raw.open_issues ?? raw.open_issues_count),
    language: raw.language ?? null,
    topics: Array.isArray(raw.topics) ? raw.topics.map((t) => String(t).toLowerCase()) : [],
    license: raw.license?.spdx_id ?? raw.license ?? raw.license_spdx ?? null,
    sizeKb: num(raw.size_kb ?? raw.size),
    archived: !!(raw.archived ?? raw.is_archived),
    fork: !!(raw.fork ?? raw.is_fork),
    isTemplate: !!(raw.is_template ?? raw.isTemplate),
    disabled: !!raw.disabled,
    contributors: raw.contributors ?? null,   // only known at stage 3
    ownerLocation: raw.owner_location ?? null, // only known at stage 3
    ageDays,
    daysSincePush: Math.max(0, (now - pushed) / DAY),
    velocity: stars / ageDays,
  };
}
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const nameSurface = (r) => `${splitCamel(r.name)} ${r.topics.join(' ')}`;
const fullSurface = (r, readme = '') =>
  `${splitCamel(r.name)} ${r.description} ${r.topics.join(' ')} ${readme.slice(0, 1500)}`;
function splitCamel(s) {
  return String(s ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}
function configDumpScore(r) {
  const S = R.CONFIG_DUMP_SIGNALS;
  let score = 0;
  const hits = [];
  if (!r.language) { score += S.noLanguagePoints; hits.push('no-language'); }
  if (RX.configDumpName.test(splitCamel(r.name))) { score += S.namePatternPoints; hits.push('name'); }
  if (RX.configDumpTopic.test(r.topics.join(' '))) { score += S.topicPatternPoints; hits.push('topic'); }
  if (RX.configDumpDesc.test(r.description)) { score += S.descPatternPoints; hits.push('desc'); }
  return { score, hits, isDump: score >= S.rejectAtScore };
}
function promptDumpScore(r) {
  const S = R.PROMPT_DUMP_SIGNALS;
  let score = 0;
  const hits = [];
  if (RX.promptDumpName.test(splitCamel(r.name))) { score += S.namePoints; hits.push('name'); }
  if (RX.promptDumpDesc.test(r.description)) { score += S.descPoints; hits.push('desc'); }
  if (!r.language) { score += S.noLanguagePoints; hits.push('no-language'); }
  return { score, hits, isDump: score >= S.rejectAtScore };
}
function isCuratedList(r) {
  if (RX.curatedList.test(r.name)) return true;
  return r.topics.some((t) => LIST_TOPICS.has(t));
}
function isPiracy(r, readme = '') {
  return RX.piracy.test(fullSurface(r, readme));
}
function iranRelevance(r, readme = '') {
  const I = R.IRAN_RELEVANCE;
  const topics = new Set(r.topics);
  const t1 = I.tier1Topics.filter((t) => topics.has(t));
  if (t1.length) return { tier: 1, points: I.tier1Points, why: `topic:${t1[0]}` };
  const persianChars = (readme.match(RX.persianOnly) || []).length;
  if (persianChars >= I.persianTextMinChars) {
    return { tier: 1, points: I.persianTextPoints, why: `persian-readme:${persianChars}` };
  }
  const t2 = I.tier2Topics.filter((t) => topics.has(t));
  if (t2.length) return { tier: 2, points: I.tier2Points, why: `topic:${t2[0]}` };
  if (RX.iranKeywords.test(`${r.description} ${readme.slice(0, 3000)}`)) {
    return { tier: 2, points: I.tier2Points, why: 'keyword' };
  }
  const t3 = I.tier3Topics.filter((t) => topics.has(t));
  if (t3.length) return { tier: 3, points: I.tier3Points, why: `topic:${t3[0]}` };
  return { tier: 0, points: 0, why: null };
}
function aiRelevance(r) {
  const hit = R.AI_BOOST.topics.filter((t) => r.topics.includes(t));
  return { isAi: hit.length > 0, points: hit.length ? R.AI_BOOST.points : 0, why: hit[0] ?? null };
}
function iranianCreator(r) {
  if (KNOWN_IRANIAN.has(r.owner.toLowerCase())) {
    return { yes: true, points: R.IRANIAN_CREATOR.points, why: 'known-owner' };
  }
  if (r.ownerLocation && RX.iranLocation.test(r.ownerLocation)) {
    return { yes: true, points: R.IRANIAN_CREATOR.points, why: 'location' };
  }
  return { yes: false, points: 0, why: null };
}
function hardRejects(r, readme = null) {
  const H = R.HARD_REJECT;
  const out = [];
  if (H.archived && r.archived) out.push('archived');
  if (H.template && r.isTemplate) out.push('template');
  if (H.fork && r.fork) out.push('fork');
  if (H.disabled && r.disabled) out.push('disabled');
  if (H.maxSizeKb && r.sizeKb > H.maxSizeKb) out.push('oversized');
  if (H.piracy && isPiracy(r, readme ?? '')) out.push('piracy');
  if (H.configDumps && configDumpScore(r).isDump) out.push('config-dump');
  if (readme !== null && readme.length < H.minReadmeBytes) out.push('no-readme');
  return out;
}
function lanesFor(r, ctx) {
  const out = [];
  for (const lane of R.LANE_PRIORITY) {
    if (laneAccepts(lane, r, ctx)) out.push(lane);
  }
  return out;
}
function laneAccepts(lane, r, ctx) {
  const L = R.LANES[lane];
  if (!L) return false;
  if (L.requiresIranRelevance && ctx.iran.tier === 0) return false;
  if (L.requiresAiRelevance && !ctx.ai.isAi) return false;
  if (lane === 'curated_list' && !ctx.isList) return false;
  if (lane !== 'curated_list' && ctx.isList) return false;
  let min = L.starsMin;
  if (lane === 'curated_list' && ctx.iran.tier > 0 && L.iranStarsMin != null) {
    min = L.iranStarsMin;
  }
  if (r.stars < min) return false;
  if (L.starsMax != null && r.stars > L.starsMax) return false;
  if (L.minAgeDays != null && r.ageDays < L.minAgeDays) return false;
  if (L.maxAgeDays != null && r.ageDays > L.maxAgeDays) return false;
  let maxIdle = L.maxDaysSincePush;
  const f = L.idleForgiveness;
  if (f && r.stars >= f.minStars && f.maxDaysSincePush > (maxIdle ?? 0)) {
    maxIdle = f.maxDaysSincePush;
  }
  if (maxIdle != null && r.daysSincePush > maxIdle) return false;
  if (L.minVelocityPerDay != null && r.velocity < L.minVelocityPerDay) return false;
  if (L.maxVelocityPerDay != null && r.velocity > L.maxVelocityPerDay) return false;
  return true;
}
function attentionPoints(r, lane) {
  const curveName = R.LANES[lane]?.attentionCurve ?? 'flat';
  const max = R.QUALITY.attention;
  const C = R.ATTENTION_CURVES[curveName];
  if (curveName === 'bell') {
    const d = (Math.log10(Math.max(1, r.stars)) - Math.log10(C.peakStars)) / C.sigmaLog10;
    return max * Math.exp(-0.5 * d * d);
  }
  if (curveName === 'rising') {
    return max * saturate(r.stars, C.saturationStars);
  }
  const floor = R.LANES[lane]?.starsMin ?? 0;
  return clamp(C.baselinePoints + (r.stars >= floor ? C.floorClearedBonus : 0), 0, max);
}
function alivenessPoints(r) {
  const A = R.ALIVENESS;
  const fresh = A.freshnessPoints * Math.pow(0.5, r.daysSincePush / A.freshnessHalfLifeDays);
  const mature = A.maturityPoints * Math.min(1, r.ageDays / A.maturitySaturationDays);
  return fresh + mature;
}
function adoptionPoints(r) {
  const A = R.ADOPTION;
  let pts = A.forksPoints * saturate(r.forks, A.forksSaturation)
          + A.issueActivityPoints * saturate(r.openIssues, A.issuesSaturation);
  pts += r.contributors == null
    ? A.contributorsPoints * 0.5
    : A.contributorsPoints * saturate(r.contributors, A.contributorsSaturation);
  return pts;
}
function craftPoints(r, readme) {
  const C = R.CRAFT;
  const B = R.README_BAND;
  let pts = 0;
  const hits = [];
  if (r.description && r.description.length >= R.PENALTY_THRESHOLDS.minDescriptionChars) {
    pts += C.description; hits.push('description');
  }
  if (r.topics.length >= 3) { pts += C.topics; hits.push('topics'); }
  else if (r.topics.length >= 1) { pts += C.topics * 0.5; hits.push('topics-few'); }
  if (r.homepage && r.homepage.trim()) { pts += C.homepage; hits.push('homepage'); }
  if (r.license) { pts += C.license; hits.push('license'); }
  if (readme != null) {
    const len = readme.length;
    if (len >= B.goodBytes) pts += C.readmeLength;
    else if (len > B.minBytes) {
      pts += C.readmeLength * ((len - B.minBytes) / (B.goodBytes - B.minBytes));
    }
    if (len >= B.minBytes) hits.push('readme');
    if (RX.demo.test(readme)) { pts += C.demoMedia; hits.push('demo'); }
    const headings = (readme.match(/^#{2,3} /gm) || []).length;
    const fences = (readme.match(/```/g) || []).length / 2;
    const structureRatio = Math.min(1, headings / 4) * 0.6 + Math.min(1, fences / 2) * 0.4;
    pts += C.structure * structureRatio;
    if (structureRatio > 0.5) hits.push('structure');
    if (RX.install.test(readme)) { pts += C.installInstructions; hits.push('install'); }
  }
  return { points: pts, hits };
}
function penaltyPoints(r, readme, ctx) {
  const P = R.PENALTIES;
  const T = R.PENALTY_THRESHOLDS;
  const surface = fullSurface(r, readme ?? '');
  let total = 0;
  const hits = [];
  const add = (pts, label) => { total += pts; hits.push(label); };
  if (ctx.dump.isDump) {
    const over = ctx.dump.score - R.CONFIG_DUMP_SIGNALS.rejectAtScore + 1;
    add(P.configDumpPerPoint * over, `config-dump:${ctx.dump.score}(${ctx.dump.hits.join('+')})`);
  }
  if (ctx.promptDump.isDump) {
    const over = ctx.promptDump.score - R.PROMPT_DUMP_SIGNALS.rejectAtScore + 1;
    add(P.promptDumpPerPoint * over, `prompt-dump:${ctx.promptDump.score}(${ctx.promptDump.hits.join('+')})`);
  }
  if (RX.learning.test(surface)) add(P.learningProject, 'learning-project');
  if (RX.aiSlop.test(surface)) add(P.aiSlop, 'ai-slop');
  if (r.stars > 0 && r.forks / r.stars > T.forkRatio) add(P.forkRatioAnomaly, 'fork-ratio');
  if (r.stars > 0 && r.openIssues / r.stars > T.issueToStarRatio) add(P.neglectedIssues, 'neglected-issues');
  if (!r.description || r.description.length < T.minDescriptionChars) add(P.noDescription, 'no-description');
  if (!r.language && !ctx.isList) add(P.noLanguage, 'no-language');
  if (r.sizeKb > T.bloatedSizeKb) add(P.bloated, 'bloated');
  return { points: total, hits };
}
function buildContext(r, readme) {
  const isList = isCuratedList(r);
  return {
    isList,
    dump: configDumpScore(r),
    promptDump: promptDumpScore(r),
    iran: iranRelevance(r, readme ?? ''),
    ai: aiRelevance(r),
    creator: iranianCreator(r),
  };
}
function scoreWith(rawRepo, readme, now) {
  const r = normalize(rawRepo, now);
  const rejects = hardRejects(r, readme);
  const ctx = buildContext(r, readme);
  if (rejects.length) {
    return {
      repo: r, eligible: false, rejects, lanes: [], lane: null,
      quality: 0, relevance: 0, penalty: 0, total: 0, ctx, breakdown: null,
    };
  }
  const lanes = lanesFor(r, ctx);
  if (!lanes.length) {
    return {
      repo: r, eligible: false, rejects: ['no-lane'], lanes: [], lane: null,
      quality: 0, relevance: 0, penalty: 0, total: 0, ctx, breakdown: null,
    };
  }
  const lane = lanes[0]; // LANE_PRIORITY order
  const craft = craftPoints(r, readme);
  const attention = attentionPoints(r, lane);
  const aliveness = alivenessPoints(r);
  const adoption = adoptionPoints(r);
  const quality = craft.points + attention + aliveness + adoption;
  const relevance = clamp(ctx.iran.points, 0, R.RELEVANCE.iranMax)
    + clamp(ctx.ai.points, 0, R.RELEVANCE.aiMax)
    + clamp(ctx.creator.points, 0, R.RELEVANCE.iranianCreatorMax);
  const extraLanes = Math.max(0, lanes.length - 1);
  const multiLane = Math.min(
    R.MULTI_LANE_BONUS.max,
    extraLanes * R.MULTI_LANE_BONUS.perExtraLane,
  );
  const pen = penaltyPoints(r, readme, ctx);
  const total = quality + relevance + multiLane - pen.points;
  return {
    repo: r,
    eligible: true,
    rejects: [],
    lanes,
    lane,
    quality,
    relevance,
    multiLane,
    penalty: pen.points,
    total,
    ctx,
    breakdown: {
      craft: craft.points, craftHits: craft.hits,
      attention, aliveness, adoption,
      iran: ctx.iran.points, iranWhy: ctx.iran.why,
      ai: ctx.ai.points, creator: ctx.creator.points,
      penaltyHits: pen.hits,
    },
  };
}
const scoreStageA = (repo, now = Date.now()) => scoreWith(repo, null, now);
const scoreStageB = (repo, readme, now = Date.now()) =>
  scoreWith(repo, String(readme ?? ''), now);
function allocateByLane(scoredList, limit) {
  const byLane = new Map();
  for (const s of scoredList) {
    if (!byLane.has(s.lane)) byLane.set(s.lane, []);
    byLane.get(s.lane).push(s);
  }
  for (const list of byLane.values()) list.sort((a, b) => b.total - a.total);
  const active = [...byLane.keys()].filter((l) => byLane.get(l).length);
  const quotaSum = active.reduce((a, l) => a + (R.LANE_QUOTA[l] ?? 1), 0) || 1;
  const chosen = [];
  const leftovers = [];
  for (const lane of active) {
    const list = byLane.get(lane);
    const share = Math.min(list.length, Math.floor(limit * (R.LANE_QUOTA[lane] ?? 1) / quotaSum));
    chosen.push(...list.slice(0, share));
    leftovers.push(...list.slice(share));
  }
  leftovers.sort((a, b) => b.total - a.total);
  chosen.push(...leftovers.slice(0, Math.max(0, limit - chosen.length)));
  return chosen.sort((a, b) => b.total - a.total);
}
function allocateReadmeBudget(stageA, limit = R.FUNNEL.readmeFetchLimit) {
  if (!R.FUNNEL.readmeBudgetPerLane) {
    return [...stageA].sort((a, b) => b.total - a.total).slice(0, limit);
  }
  return allocateByLane(stageA, limit);
}
function passesLlmGate(scored) {
  return scored.eligible
    && scored.quality >= R.FUNNEL.minQualityForLlm
    && scored.total >= R.FUNNEL.minTotalForLlm;
}
function outcomeOf(row) {
  if (!row) return 'new';
  if (row.published) return 'published';
  if (row.human_rejected) return 'humanRejected';
  if (row.verdict === 'reject') return 'llmRejected';
  const reason = row.last_reject_reason ?? null;
  if (reason) {
    return R.REJECT_PERMANENCE[reason] === 'permanent' ? 'permanentReject' : 'softReject';
  }
  if (row.last_total != null && row.last_total < R.FUNNEL.minTotalForLlm) return 'nearMiss';
  if (row.evaluated_at) return 'notSelected';
  return 'notSelected';
}
function shouldReconsider(row, now = Date.now()) {
  const outcome = outcomeOf(row);
  if (outcome === 'new') return { ok: true, outcome, cooldownDays: 0, daysSince: null };
  const cooldownDays = R.COOLDOWN[outcome];
  const stamp = Date.parse(row.last_checked ?? row.first_seen ?? '') || now;
  const daysSince = (now - stamp) / DAY;
  if (cooldownDays == null) return { ok: false, outcome, cooldownDays: null, daysSince };
  return { ok: daysSince >= cooldownDays, outcome, cooldownDays, daysSince };
}
function select(scoredList, limit = R.FUNNEL.llmCandidateLimit) {
  const gated = scoredList.filter(passesLlmGate);
  const byLane = new Map();
  for (const s of gated) {
    if (!byLane.has(s.lane)) byLane.set(s.lane, []);
    byLane.get(s.lane).push(s);
  }
  for (const list of byLane.values()) list.sort((a, b) => b.total - a.total);
  const active = [...byLane.keys()].filter((l) => byLane.get(l).length);
  const quotaSum = active.reduce((a, l) => a + (R.LANE_QUOTA[l] ?? 1), 0) || 1;
  const slack = Math.max(1, Math.ceil(limit / R.FUNNEL.finalSelectionSize));
  const langCount = {};
  const ownerCount = {};
  const laneCount = {};
  const chosen = [];
  const skipped = [];
  const taken = new Set();
  const capBlocking = (s) => {
    const lang = s.repo.language ?? 'none';
    const owner = s.repo.owner.toLowerCase();
    if ((langCount[lang] ?? 0) >= R.DIVERSITY.maxPerLanguage * slack) return `lang-cap:${lang}`;
    if ((ownerCount[owner] ?? 0) >= R.DIVERSITY.maxPerOwner * slack) return `owner-cap:${owner}`;
    return null;
  };
  const accept = (s) => {
    const lang = s.repo.language ?? 'none';
    const owner = s.repo.owner.toLowerCase();
    langCount[lang] = (langCount[lang] ?? 0) + 1;
    ownerCount[owner] = (ownerCount[owner] ?? 0) + 1;
    laneCount[s.lane] = (laneCount[s.lane] ?? 0) + 1;
    taken.add(s);
    chosen.push(s);
  };
  for (const lane of active) {
    const share = Math.min(
      byLane.get(lane).length,
      Math.floor(limit * (R.LANE_QUOTA[lane] ?? 1) / quotaSum),
    );
    let got = 0;
    for (const s of byLane.get(lane)) {
      if (got >= share) break;
      const why = capBlocking(s);
      if (why) { skipped.push({ s, why }); continue; }
      accept(s);
      got++;
    }
  }
  if (chosen.length < limit) {
    for (const s of [...gated].sort((a, b) => b.total - a.total)) {
      if (chosen.length >= limit) break;
      if (taken.has(s)) continue;
      const why = capBlocking(s);
      if (why) { skipped.push({ s, why }); continue; }
      accept(s);
    }
  }
  if (chosen.length < limit) {
    for (const s of [...gated].sort((a, b) => b.total - a.total)) {
      if (chosen.length >= limit) break;
      if (taken.has(s)) continue;
      accept(s);
    }
  }
  return { chosen: chosen.sort((a, b) => b.total - a.total), skipped, laneCount };
}
function selectFinal(judged, limit = R.FUNNEL.finalSelectionSize) {
  const rank = { strong: 0, maybe: 1 };
  const usable = judged
    .filter((j) => j.verdict === 'strong' || j.verdict === 'maybe')
    .filter((j) => !j.isDuplicatePurpose)
    .sort((a, b) => (rank[a.verdict] - rank[b.verdict]) || (b.scored.total - a.scored.total));
  const laneCount = {};
  const langCount = {};
  const catCount = {};
  const ownerCount = {};
  const chosen = [];
  const skipped = [];
  for (const j of usable) {
    if (chosen.length >= limit) break;
    const s = j.scored;
    const lane = s.lane;
    const lang = s.repo.language ?? 'none';
    const owner = s.repo.owner.toLowerCase();
    const cat = j.category ?? 'unknown';
    if ((laneCount[lane] ?? 0) >= (R.LANE_QUOTA[lane] ?? Infinity)) {
      skipped.push({ j, why: `lane-quota:${lane}` }); continue;
    }
    if ((langCount[lang] ?? 0) >= R.DIVERSITY.maxPerLanguage) {
      skipped.push({ j, why: `lang-cap:${lang}` }); continue;
    }
    if ((catCount[cat] ?? 0) >= R.DIVERSITY.maxPerCategory) {
      skipped.push({ j, why: `category-cap:${cat}` }); continue;
    }
    if ((ownerCount[owner] ?? 0) >= R.DIVERSITY.maxPerOwner) {
      skipped.push({ j, why: `owner-cap:${owner}` }); continue;
    }
    laneCount[lane] = (laneCount[lane] ?? 0) + 1;
    langCount[lang] = (langCount[lang] ?? 0) + 1;
    catCount[cat] = (catCount[cat] ?? 0) + 1;
    ownerCount[owner] = (ownerCount[owner] ?? 0) + 1;
    chosen.push(j);
  }
  const dropped = judged.filter((j) => j.verdict === 'reject' || j.isDuplicatePurpose);
  return { chosen, skipped, dropped, laneCount, catCount };
}
function validateRules() {
  const errs = [];
  const sum = (o) => Object.values(o).filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0);
  if (sum(R.QUALITY) !== 100) errs.push(`QUALITY must sum to 100, got ${sum(R.QUALITY)}`);
  if (sum(R.CRAFT) !== R.QUALITY.craft) errs.push(`CRAFT must sum to QUALITY.craft (${R.QUALITY.craft}), got ${sum(R.CRAFT)}`);
  const alive = R.ALIVENESS.freshnessPoints + R.ALIVENESS.maturityPoints;
  if (alive !== R.QUALITY.aliveness) errs.push(`ALIVENESS points must sum to ${R.QUALITY.aliveness}, got ${alive}`);
  const adopt = R.ADOPTION.forksPoints + R.ADOPTION.issueActivityPoints + R.ADOPTION.contributorsPoints;
  if (adopt !== R.QUALITY.adoption) errs.push(`ADOPTION points must sum to ${R.QUALITY.adoption}, got ${adopt}`);
  const alloc = Object.values(R.QUERY.allocation).reduce((a, b) => a + b, 0);
  if (alloc !== R.QUERY.queriesPerRun) errs.push(`QUERY.allocation must sum to queriesPerRun (${R.QUERY.queriesPerRun}), got ${alloc}`);
  for (const lane of Object.keys(R.LANES)) {
    if (!R.LANE_PRIORITY.includes(lane)) errs.push(`lane ${lane} missing from LANE_PRIORITY`);
    if (R.LANE_QUOTA[lane] == null) errs.push(`lane ${lane} missing from LANE_QUOTA`);
    const curve = R.LANES[lane].attentionCurve;
    if (!R.ATTENTION_CURVES[curve]) errs.push(`lane ${lane} uses unknown curve ${curve}`);
  }
  if (R.PENALTIES.configDumpPerPoint == null) errs.push('PENALTIES.configDumpPerPoint is required');
  if (R.PENALTIES.promptDumpPerPoint == null) errs.push('PENALTIES.promptDumpPerPoint is required');
  const maxPromptScore = R.PROMPT_DUMP_SIGNALS.namePoints
    + R.PROMPT_DUMP_SIGNALS.descPoints
    + R.PROMPT_DUMP_SIGNALS.noLanguagePoints;
  const maxPromptPenalty = R.PENALTIES.promptDumpPerPoint
    * (maxPromptScore - R.PROMPT_DUMP_SIGNALS.rejectAtScore + 1);
  if (maxPromptPenalty < R.FUNNEL.minTotalForLlm) {
    errs.push(`max prompt-dump penalty (${maxPromptPenalty}) must exceed minTotalForLlm (${R.FUNNEL.minTotalForLlm})`);
  }
  if (R.PROMPT_DUMP_SIGNALS.noLanguagePoints >= R.PROMPT_DUMP_SIGNALS.rejectAtScore) {
    errs.push('PROMPT_DUMP_SIGNALS.noLanguagePoints alone reaches rejectAtScore');
  }
  if (R.CONFIG_DUMP_SIGNALS.noLanguagePoints >= R.CONFIG_DUMP_SIGNALS.rejectAtScore) {
    errs.push('CONFIG_DUMP_SIGNALS.noLanguagePoints alone reaches rejectAtScore');
  }
  for (const outcome of ['humanRejected', 'published', 'llmRejected', 'nearMiss',
    'notSelected', 'softReject', 'permanentReject']) {
    if (!(outcome in R.COOLDOWN)) errs.push(`COOLDOWN is missing "${outcome}"`);
  }
  for (const [reason, kind] of Object.entries(R.REJECT_PERMANENCE)) {
    if (kind !== 'permanent' && kind !== 'soft') {
      errs.push(`REJECT_PERMANENCE.${reason} must be "permanent" or "soft", got "${kind}"`);
    }
  }
  if (R.FUNNEL.llmCandidateLimit < R.FUNNEL.finalSelectionSize) {
    errs.push(`FUNNEL.llmCandidateLimit (${R.FUNNEL.llmCandidateLimit}) must be >= finalSelectionSize (${R.FUNNEL.finalSelectionSize})`);
  }
  if (R.FUNNEL.readmeFetchLimit < R.FUNNEL.llmCandidateLimit) {
    errs.push(`FUNNEL.readmeFetchLimit (${R.FUNNEL.readmeFetchLimit}) must be >= llmCandidateLimit (${R.FUNNEL.llmCandidateLimit})`);
  }
  if (R.DIVERSITY.maxPerCategory * R.CATEGORIES.length < R.FUNNEL.finalSelectionSize) {
    errs.push('DIVERSITY.maxPerCategory * CATEGORIES.length is below finalSelectionSize — the run can never fill');
  }
  const quotaSum = Object.values(R.LANE_QUOTA).reduce((a, b) => a + b, 0);
  if (quotaSum < R.FUNNEL.finalSelectionSize) {
    errs.push(`LANE_QUOTA sums to ${quotaSum}, below finalSelectionSize (${R.FUNNEL.finalSelectionSize})`);
  }
  for (const [cls, def] of Object.entries(R.QUERY_CLASSES)) {
    if (!(cls in R.QUERY.allocation)) errs.push(`QUERY_CLASSES.${cls} has no allocation`);
    if (def.topicPools) {
      def.topicPools.forEach((p, i) => {
        if (!p.length) errs.push(`QUERY_CLASSES.${cls}.topicPools[${i}] is empty`);
      });
    }
    if (def.sorts && !def.sorts.length) errs.push(`QUERY_CLASSES.${cls}.sorts is empty`);
  }
  for (const cls of Object.keys(R.QUERY.allocation)) {
    if (!(cls in R.QUERY_CLASSES)) errs.push(`QUERY.allocation names "${cls}" with no QUERY_CLASSES entry`);
  }
  if (!R.LANGUAGE_SHARDS.length || !R.TOPIC_SHARDS.length) errs.push('shard pools must not be empty');
  const maxDumpScore = R.CONFIG_DUMP_SIGNALS.noLanguagePoints
    + R.CONFIG_DUMP_SIGNALS.namePatternPoints
    + R.CONFIG_DUMP_SIGNALS.topicPatternPoints
    + R.CONFIG_DUMP_SIGNALS.descPatternPoints;
  const maxDumpPenalty = R.PENALTIES.configDumpPerPoint
    * (maxDumpScore - R.CONFIG_DUMP_SIGNALS.rejectAtScore + 1);
  const maxUpside = 100 + Object.values(R.RELEVANCE).reduce((a, b) => a + b, 0)
    + R.MULTI_LANE_BONUS.max;
  if (maxDumpPenalty < maxUpside) {
    errs.push(`max config-dump penalty (${maxDumpPenalty}) must exceed max achievable score (${maxUpside})`);
  }
  if (errs.length) throw new Error(`rules.js inconsistent:\n  - ${errs.join('\n  - ')}`);
  return true;
}
  return { normalize, configDumpScore, promptDumpScore, isCuratedList, isPiracy, iranRelevance, aiRelevance, iranianCreator, hardRejects, lanesFor, scoreStageA, scoreStageB, allocateByLane, allocateReadmeBudget, passesLlmGate, outcomeOf, shouldReconsider, select, selectFinal, validateRules };
})(R);
const Q = (function (R) {
const DAY = 86_400_000;
function ymd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function dayIndex(now = Date.now()) {
  const epoch = Date.parse(`${R.ROTATION.epochUtc}T00:00:00Z`);
  return Math.max(0, Math.floor((now - epoch) / DAY));
}
function countOperators(q) {
  return (q.match(/\b(?:AND|OR|NOT)\b/g) || []).length;
}
function rotate(pool, seed, take, stride = 1) {
  if (!pool.length || take <= 0) return [];
  const n = Math.min(take, pool.length);
  const start = ((seed * stride) % pool.length + pool.length) % pool.length;
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[(start + i) % pool.length]);
  return out;
}
function topicClause(topics) {
  const capped = topics.slice(0, R.QUERY.maxTopicsPerQuery);
  return `topic:${capped.join(R.QUERY.topicSeparator)}`;
}
function tail({ starRange, pushedWithinDays, createdWithinDays, createdBeforeDays, createdRange, extra }, now) {
  const parts = [];
  if (starRange) parts.push(`stars:${starRange}`);
  if (pushedWithinDays != null) parts.push(`pushed:>${ymd(now - pushedWithinDays * DAY)}`);
  if (createdRange) {
    const [fromDays, toDays] = createdRange;
    parts.push(`created:${ymd(now - fromDays * DAY)}..${ymd(now - toDays * DAY)}`);
  }
  if (createdWithinDays != null) parts.push(`created:>${ymd(now - createdWithinDays * DAY)}`);
  if (createdBeforeDays != null) parts.push(`created:<${ymd(now - createdBeforeDays * DAY)}`);
  if (R.QUERY.excludeArchived) parts.push('archived:false');
  if (extra) parts.push(extra);
  return parts.join(' ');
}
function pickSort(sorts, seed) {
  if (!sorts || !sorts.length) return { sort: 'updated', order: 'desc' };
  return sorts[seed % sorts.length];
}
function buildIran(count, seed, now) {
  const C = R.QUERY_CLASSES.iran;
  const out = [];
  const pools = C.topicPools;
  for (let i = 0; i < count; i++) {
    const pool = pools[(seed + i) % pools.length];
    const topics = rotate(pool, seed + i, R.QUERY.maxTopicsPerQuery);
    out.push({
      label: `iran_${i}`,
      lane: 'iran_relevant',
      q: `${topicClause(topics)} ${tail({ starRange: C.starRange, pushedWithinDays: C.pushedWithinDays }, now)}`,
      ...pickSort(C.sorts, seed + i),
    });
  }
  return out;
}
function buildAi(count, seed, now) {
  const C = R.QUERY_CLASSES.ai;
  const out = [];
  for (let i = 0; i < count; i++) {
    const pool = C.topicPools[(seed + i) % C.topicPools.length];
    const topics = rotate(pool, seed + i, R.QUERY.maxTopicsPerQuery);
    out.push({
      label: `ai_${i}`,
      lane: 'ai_agents',
      q: `${topicClause(topics)} ${tail({ starRange: C.starRange, pushedWithinDays: C.pushedWithinDays }, now)}`,
      ...pickSort(C.sorts, seed + i),
    });
  }
  return out;
}
function buildTrending(count, seed, now) {
  const C = R.QUERY_CLASSES.trending;
  const out = [];
  const bounds = splitWindow(C.createdWithinDays, count);
  for (let i = 0; i < count; i++) {
    out.push({
      label: `trending_${i}_d${bounds[i][0]}-${bounds[i][1]}`,
      lane: 'trending',
      q: tail({ starRange: C.starRange, createdRange: bounds[i] }, now),
      ...pickSort(C.sorts, seed + i),
    });
  }
  return out;
}
function splitWindow(totalDays, count) {
  if (count <= 1) return [[totalDays, 0]];
  const out = [];
  let from = totalDays;
  for (let i = 0; i < count; i++) {
    const to = i === count - 1 ? 0 : Math.round(from / 3);
    out.push([from, to]);
    from = to;
  }
  return out;
}
function buildHidden(count, seed, now) {
  const C = R.QUERY_CLASSES.hidden;
  const R_ = R.ROTATION;
  const kinds = R_.hiddenShardKinds;
  const out = [];
  for (let i = 0; i < count; i++) {
    const step = seed * count + i;
    const starRange = rotate(C.starShards, step, 1, R_.starShardStride)[0];
    const kind = kinds[step % kinds.length];
    const kindIndex = Math.floor(step / kinds.length);
    const shard = kind === 'language'
      ? rotate(R.LANGUAGE_SHARDS, kindIndex, 1, R_.languageStride)[0]
      : rotate(R.TOPIC_SHARDS, kindIndex, 1, R_.topicStride)[0];
    const extra = kind === 'language' ? `language:${shard}` : `topic:${shard}`;
    out.push({
      label: `hidden_${i}_${kind}:${shard}`,
      lane: 'hidden_gem',
      q: tail({
        starRange,
        pushedWithinDays: C.pushedWithinDays,
        createdWithinDays: C.createdWithinDays,
        extra,
      }, now),
      ...pickSort(C.sorts, step),
    });
  }
  return out;
}
function buildEstablished(count, seed, now) {
  const C = R.QUERY_CLASSES.established;
  const out = [];
  for (let i = 0; i < count; i++) {
    const lang = rotate(R.LANGUAGE_SHARDS, seed + i, 1, R.ROTATION.languageStride)[0];
    out.push({
      label: `established_${i}_${lang}`,
      lane: 'established',
      q: tail({
        starRange: C.starRange,
        createdBeforeDays: C.createdBeforeDays,
        pushedWithinDays: C.pushedWithinDays,
        extra: `language:${lang}`,
      }, now),
      ...pickSort(C.sorts, seed + i),
    });
  }
  return out;
}
function buildLists(count, seed, now) {
  const C = R.QUERY_CLASSES.lists;
  const out = [];
  for (let i = 0; i < count; i++) {
    const iranScoped = ((seed + i) % Math.round(1 / C.iranScopedRatio)) === 0;
    const word = rotate(C.namePools, seed + i, 1)[0];
    const scope = iranScoped ? ' topic:iran' : '';
    const starRange = iranScoped
      ? `${R.LANES.curated_list.iranStarsMin}..*`
      : C.starRange;
    out.push({
      label: `lists_${i}${iranScoped ? '_iran' : ''}:${word}`,
      lane: 'curated_list',
      q: `${word} in:name${scope} ${tail({ starRange, pushedWithinDays: C.pushedWithinDays }, now)}`,
      ...pickSort(C.sorts, seed + i),
    });
  }
  return out;
}
const BUILDERS = {
  iran: buildIran,
  ai: buildAi,
  trending: buildTrending,
  hidden: buildHidden,
  established: buildEstablished,
  lists: buildLists,
};
function buildQueries(now = Date.now()) {
  const seed = dayIndex(now);
  const out = [];
  for (const [cls, count] of Object.entries(R.QUERY.allocation)) {
    const fn = BUILDERS[cls];
    if (!fn) throw new Error(`QUERY.allocation names unknown class "${cls}"`);
    out.push(...fn(count, seed, now));
  }
  for (const item of out) {
    item.q = item.q.replace(/\s+/g, ' ').trim();
    item.url = searchUrl(item);
    const ops = countOperators(item.q);
    if (ops > R.QUERY.maxOperators) {
      throw new Error(`query "${item.label}" uses ${ops} operators (max ${R.QUERY.maxOperators}): ${item.q}`);
    }
    if (item.q.length > R.QUERY.maxQueryChars) {
      throw new Error(`query "${item.label}" is ${item.q.length} chars (max ${R.QUERY.maxQueryChars}): ${item.q}`);
    }
  }
  if (out.length !== R.QUERY.queriesPerRun) {
    throw new Error(`built ${out.length} queries but QUERY.queriesPerRun is ${R.QUERY.queriesPerRun}`);
  }
  return out;
}
function searchUrl(item, perPage = R.QUERY.resultsPerQuery) {
  return 'https://api.github.com/search/repositories'
    + `?q=${encodeURIComponent(item.q)}`
    + `&sort=${item.sort}&order=${item.order}&per_page=${perPage}`;
}
function rotationCoverage(days, now = Date.now()) {
  const langs = new Set();
  const topics = new Set();
  const queries = new Set();
  for (let d = 0; d < days; d++) {
    const plan = buildQueries(now + d * DAY);
    for (const item of plan) {
      queries.add(item.q);
      const m = item.label.match(/(language|topic):(.+)$/);
      if (m) (m[1] === 'language' ? langs : topics).add(m[2]);
    }
  }
  return {
    days,
    uniqueQueries: queries.size,
    languagesSeen: langs.size,
    languagePoolSize: R.LANGUAGE_SHARDS.length,
    topicsSeen: topics.size,
    topicPoolSize: R.TOPIC_SHARDS.length,
  };
}
  return { ymd, dayIndex, countOperators, rotate, buildQueries, searchUrl, rotationCoverage };
})(R);
const PUREGH = {
  rules: R,
  buildQueries: Q.buildQueries,
  searchUrl: Q.searchUrl,
  dayIndex: Q.dayIndex,
  rotationCoverage: Q.rotationCoverage,
  normalize: A.normalize,
  scoreStageA: A.scoreStageA,
  scoreStageB: A.scoreStageB,
  passesLlmGate: A.passesLlmGate,
  allocateByLane: A.allocateByLane,
  allocateReadmeBudget: A.allocateReadmeBudget,
  configDumpScore: A.configDumpScore,
  promptDumpScore: A.promptDumpScore,
  isCuratedList: A.isCuratedList,
  iranRelevance: A.iranRelevance,
  aiRelevance: A.aiRelevance,
  iranianCreator: A.iranianCreator,
  hardRejects: A.hardRejects,
  lanesFor: A.lanesFor,
  outcomeOf: A.outcomeOf,
  shouldReconsider: A.shouldReconsider,
  select: A.select,
  selectFinal: A.selectFinal,
  validateRules: A.validateRules,
};
PUREGH.validateRules();