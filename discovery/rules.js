// Pure GitHub — Discovery rules
//
// EVERY tunable number lives in this file. The algorithm reads them from here
// and contains no magic numbers of its own.
//
// ---------------------------------------------------------------------------
// DESIGN HISTORY — why this file looks the way it does
// ---------------------------------------------------------------------------
// The first draft had a single mission (find hidden gems) enforced by a global
// star ceiling of 4000. Measured against a live sample of 60
// censorship-circumvention tools, that ceiling rejected 60 out of 60 —
// including sing-box, hiddify-app, v2rayA, and every other tool an Iranian
// developer actually uses. A rule that deletes the most useful category for
// the audience is the wrong rule.
//
// Current mission: USEFUL TO IRANIAN DEVELOPERS. Obscurity is now one value
// axis among several, not the gate.
//
// Structural consequence: "obscure" and "trending" are opposites, so no single
// scoring curve can reward both. Hence LANES. A repo is eligible if it
// qualifies in ANY lane; each lane carries its own star rules and its own
// attention curve. Quality scoring and penalties stay universal so that no
// lane becomes a bypass for junk.

// ---------------------------------------------------------------------------
// 1. UNIVERSAL DISQUALIFIERS
// ---------------------------------------------------------------------------
// Applies to every lane, no exceptions. Deliberately short: only things that
// are wrong for this channel regardless of how popular, useful or well-made
// they are.

export const HARD_REJECT = {
  archived: true,   // author has declared it over
  template: true,   // scaffolding, not a project
  fork: true,       // spec §8 "obvious forks"
  disabled: true,   // GitHub itself disabled the repo

  // Minimum README to write a caption from. ~300 bytes is roughly two
  // sentences; below this the repo cannot produce a post even if excellent.
  minReadmeBytes: 300,

  // ~1GB. At this size it is a dataset or a binary dump, not a readable
  // project. Not a quality judgement — just outside what we can describe.
  maxSizeKb: 1_000_000,

  // Auto-generated config / free-node / subscription dumps.
  //
  // NOT a hard reject, by explicit decision: these are heavily PENALISED
  // instead (see PENALTIES.configDumpPerPoint). The reason for penalising
  // rather than banning is that the detector is a confidence score, not a
  // fact, so a hard ban would occasionally delete a real tool — and it did
  // exactly that during calibration, to hiddify-app and Sub-Store. A penalty
  // scaled by confidence achieves the same practical outcome (dumps do not
  // get published) without that failure mode.
  //
  // Why they must not be published, any one reason sufficient:
  //   1. Not software. Nothing to introduce; contents change hourly.
  //   2. Rots immediately. A node list posted today is dead within a week.
  //   3. Safety. "Free VPN config" repos are a known malware and
  //      credential-harvesting vector; posting one is endorsing it.
  // Distinct from a curated awesome-list, which IS allowed — see
  // LANES.curated_list and CONFIG_DUMP_SIGNALS.
  configDumps: false,

  // Piracy, cracks, cheats, keygens. Legally hostile, and the channel would
  // be laundering them to a large audience.
  piracy: true,
};

// Detector for the config-dump class above.
//
// Calibrated against 1075 live repos. The first version scored only name,
// topics and language, and four dumps still reached the LLM gate:
// iiboxz/free-v2ray-collector, MahanKenway/Freedom-V2Ray,
// Epodonios/bulk-xray-...-configs and pornnewbee/free-vless-VPN. All four
// evaded it the same way — they DO have a detected language (the collector
// script that generates the dump is real code), so the language signal was
// unavailable, and their names alone did not reach the threshold.
//
// The description is what gives them away: a collector always advertises what
// it collects ("V2Ray config collector", "Auto-Update every 2 hours", "free
// vmess vless trojan ... configs"). Hence descPatterns, weighted 2 so a
// description match plus any one other signal is enough.
export const CONFIG_DUMP_SIGNALS = {
  // 1, not 2. This was measured and corrected.
  //
  // At 2 points, "GitHub detected no programming language" ALONE reached
  // rejectAtScore, so any repo with no code was treated as a config dump: 131
  // of the 187 flagged repos in the corpus were flagged by this signal and
  // nothing else. That group is mostly the opposite of a dump —
  // barnamenevisi/free-resources (1266 stars, a Persian learning-resource
  // archive), Hameds/APIs-made-in-Iran (2138), ai-boost/awesome-prompts (8824),
  // VahidN/nuget-net-melli-mirrors (a NuGet mirror list for Iranian
  // developers). Four of them still reached the LLM gate carrying a −35
  // penalty they had not earned.
  //
  // "No language" is real evidence, but it is WEAK evidence: a curated list,
  // documentation, a dataset and a config dump all have no language. At 1 point
  // it corroborates instead of deciding — a dump must now also look like one by
  // name, topic or description.
  //
  // Verified against the regression fixtures: all nine known dumps still score
  // >= rejectAtScore (3 to 6, penalties −70 to −175), because every one of them
  // matches at least two other signals. Corpus flagging drops from 187 to 56,
  // and the only-no-language group goes to zero.
  noLanguagePoints: 1,
  namePatternPoints: 2,
  topicPatternPoints: 1,
  descPatternPoints: 2,
  rejectAtScore: 2,

  // Matched against the repo NAME only (camelCase-split before matching).
  // Matching the description with THESE patterns produces false positives on
  // real clients, which naturally describe themselves as handling
  // subscriptions and rules — descPatterns below is the narrower set that is
  // safe to run against a description.
  namePatterns: [
    'free[-_ ]?nodes?', 'free[-_ ]?(vpn|proxy|servers?)', 'nodes?[-_ ]?free',
    'v2ray[-_ ]?config', 'clash[-_ ]?(free|rules)', 'ssr[-_ ]?(free|share)',
    // 'store' was removed from this group: sub-store-org/Sub-Store is a real
    // subscription MANAGER application, and matching it cost a legitimate
    // 10k-star tool.
    'sub[-_ ]?(link|list)s?',
    '[-_]rules?[-_]?(dat|list)?$',
    '(domain|ip|geosite|geoip|hosted[-_ ]?domain)s?[-_ ]?list',
    'hosted[-_ ]?domains', 'proxy[-_ ]?list',
    'share[-_ ]?(ssr|v2ray|node)',
    // Requires an object. Bare 'collect' matched any repo whose name
    // contained the word.
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
  // Phrases that ONLY a config aggregator uses about itself.
  //
  // Calibration removed a pattern that matched consecutive protocol names
  // ("VLESS, Trojan and Warp"). It looked diagnostic but was not: a real
  // client advertises the protocols it SUPPORTS in exactly the same words a
  // dump uses for the protocols it CONTAINS. That single pattern
  // misclassified hiddify/hiddify-app, v2rayA/v2rayA and
  // bia-pain-bache/BPB-Worker-Panel — three of the most useful repos for this
  // audience. Textual similarity cannot separate those cases; only the
  // language / topic / name signals can.
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

export const PIRACY_PATTERNS = [
  'crack(ed|er)?', 'keygen', 'nulled', 'warez', 'activator', 'kms[-_]?pico',
  'mod[-_]?apk', 'premium[-_]?unlock', 'license[-_]?bypass', 'patcher',
  'cheat[-_]?(engine|table|menu)', 'aimbot', 'wallhack',
];

// ---------------------------------------------------------------------------
// 2. LANES
// ---------------------------------------------------------------------------
// A repo is eligible if it qualifies for at least one lane.
//
// PRIORITY ORDER decides which lane a multi-lane repo is counted against for
// quota purposes. Ordered by stated audience value: Iranian usefulness first,
// AI second, then trending, then the original hidden-gem track, then
// established classics, then lists.

export const LANE_PRIORITY = [
  'iran_relevant',
  'ai_agents',
  'trending',
  'hidden_gem',
  'established',
  'curated_list',
];

export const LANES = {
  // --- A. Solves a problem Iranian developers actually have ---
  // Highest-value lane, therefore the loosest gates: no star ceiling
  // (sing-box at 37k stars belongs here), no age ceiling, and a low floor
  // because a niche Iranian tool can be genuinely useful at 20 stars.
  iran_relevant: {
    starsMin: 20,
    starsMax: null,          // no ceiling — popularity is not a defect here
    minAgeDays: 14,
    maxDaysSincePush: 400,
    // See IDLE_FORGIVENESS_NOTE. Without this, rastikerdar/vazirmatn — the
    // standard Persian font, 3188 stars, used by this project's own review
    // form — was rejected for being idle 1179 days. A font is finished, not
    // abandoned.
    idleForgiveness: { minStars: 1000, maxDaysSincePush: 1500 },
    requiresIranRelevance: true,
    // Flat curve: in this lane, star count carries almost no information
    // about whether the repo is worth posting.
    attentionCurve: 'flat',
  },

  // --- B. AI / agents ---
  // Time-boxed by design. The justification was "AI tools are shipping daily
  // RIGHT NOW", which is a claim about 2026, not a permanent law. See
  // AI_BOOST.reviewAfter.
  ai_agents: {
    // Higher floor than other lanes: the AI topic space is flooded with
    // low-effort wrappers (spec §8 "low-effort AI wrappers"). Measured on
    // topic:mcp, 34 of 40 active repos had under 50 stars, so a low floor
    // here would drown the funnel.
    starsMin: 80,
    starsMax: null,
    minAgeDays: 14,
    maxDaysSincePush: 120,   // strict: an AI tool untouched for four months is
                             // obsolete; the field moves that fast
    requiresAiRelevance: true,
    attentionCurve: 'rising',
  },

  // --- C. Suddenly trending ---
  // The first draft rejected these outright (velocity cap 30/day). That was
  // wrong: a tool that spikes usually spikes BECAUSE it solves a widespread
  // problem, so introducing it helps more people.
  trending: {
    starsMin: 200,
    starsMax: null,
    // Lower than other lanes — newness is the point. Not 0, because a
    // three-day-old repo has no track record and is often a reupload.
    minAgeDays: 7,

    // AGE CEILING — added after measurement, and it closes a real hole.
    //
    // The original comment claimed lifetime star_velocity is an accurate
    // CURRENT velocity measure "in this lane specifically, because a trending
    // repo is young by definition". That reasoning is circular: nothing made
    // the lane young, so the assumption failed. Measured on the corpus, 10 of
    // 76 lane members were older than 60 days, including:
    //     golang/go      4401 days old, lifetime velocity 31.2/day, 137k stars
    //     Homebrew/brew  3835 days old, 12.9/day, 49k stars
    // Neither is trending. They are enormous long-lived projects whose LIFETIME
    // average happens to exceed 12/day — exactly the flaw MOMENTUM_NOTE warns
    // about, biting in the one lane that was assumed immune.
    //
    // 90 days, not 60: the trending QUERY asks for created:<60d, so a 60-day
    // ceiling would sit exactly on the query boundary and evict repos the query
    // deliberately fetched. Measured, a 60-day cap also pushed 2 repos into no
    // lane at all (7k stars at 60 days old is above hidden_gem's 4000 ceiling
    // and below established's 180-day floor — the known LANE_COVERAGE_NOTE
    // gap). At 90 days, all 8 evicted repos land in `established`, which is
    // where a large old still-active project belongs. No coverage is lost.
    maxAgeDays: 90,

    maxDaysSincePush: 30,
    minVelocityPerDay: 12,   // the entry condition for this lane
    attentionCurve: 'rising',
  },

  // --- D. Hidden gem (the original mission, preserved as one lane) ---
  // The only lane that keeps a star ceiling, because here obscurity IS the
  // point.
  hidden_gem: {
    starsMin: 50,
    starsMax: 4000,
    minAgeDays: 21,
    // Generous on purpose: a small tool can be FINISHED rather than
    // abandoned, and metadata cannot tell the difference. Freshness is
    // rewarded in scoring instead of enforced here.
    maxDaysSincePush: 365,
    // Above this it is trending, not hidden. Such a repo is not discarded —
    // it is routed to the trending lane instead.
    maxVelocityPerDay: 30,
    attentionCurve: 'bell',
  },

  // --- E. Established and still useful ---
  // Old but useful projects deserve introducing. A five-year-old tool with 8k
  // stars that we have never posted is new to OUR audience, and "we never
  // posted it" is the only novelty that matters.
  //
  // This lane exists because the other high-star lanes would both miss it:
  // trending requires velocity it no longer has, and hidden_gem's ceiling
  // excludes it.
  established: {
    starsMin: 1500,          // real adoption, to justify waiving obscurity
    // 180 rather than 365. At 365 there was a coverage hole: a repo with
    // >4000 stars aged 21–365 days that had cooled off matched no lane at
    // all. 180 closes most of it. See LANE_COVERAGE_NOTE.
    minAgeDays: 180,
    // Stricter than hidden_gem: a large project with many users going eight
    // months without a commit is a maintenance risk we would be recommending.
    maxDaysSincePush: 240,
    attentionCurve: 'flat',
  },

  // --- F. Curated list ---
  // The first draft hard-rejected everything matching awesome-*. That
  // over-corrected: barnamenevisi/free-resources (1266 stars) and
  // ashkanRmk/awesome-persian-podcasts (641) are genuinely useful here.
  //
  // Kept as its own lane rather than merged, for two reasons: a list needs a
  // different star floor (a list's value scales with how many people trust
  // it), and lists must be quota-capped or they crowd out actual software,
  // which is harder to find and more valuable to post.
  curated_list: {
    starsMin: 300,
    iranStarsMin: 100,       // lower floor when the list is Iran-relevant
    starsMax: null,
    minAgeDays: 90,
    maxDaysSincePush: 300,   // an unmaintained list is a list of dead links
    // mohebifar/made-in-iran (968 stars, "A list of cool projects made in
    // Iran") sat idle 898 days and matched no lane at all. For a historical
    // list of this kind, being static is not the same as being dead.
    idleForgiveness: { minStars: 800, maxDaysSincePush: 1100 },
    attentionCurve: 'flat',
  },
};

// Some repos are FINISHED, not abandoned, and metadata cannot tell the
// difference. A font, a curated historical list or a stable library can sit
// untouched for years and still be exactly what someone needs.
//
// Rather than loosen maxDaysSincePush globally — which would readmit genuinely
// dead software — the affected lanes carry an `idleForgiveness` escape hatch:
// above a star floor that proves durable usefulness, a longer idle period is
// tolerated. Only the two lanes where "finished" is a normal end state have
// one. Scoring still penalises staleness through ALIVENESS.freshnessPoints, so
// such a repo competes at a disadvantage rather than being excluded outright.
export const IDLE_FORGIVENESS_NOTE = 'see comment above';

// Known remaining gap, recorded rather than hidden: a repo with >4000 stars,
// aged 21–180 days, that has stopped being pushed and is neither AI- nor
// Iran-relevant matches no lane. Such a repo had its moment recently and is
// already cooling, so skipping it is defensible — but it IS a gap, not a
// decision the rules express deliberately.
export const LANE_COVERAGE_NOTE = 'see comment above';

// Per-run lane quotas. Without these, one lane floods the channel: the
// hidden_gem lane is by far the largest supply (329 of 778 eligible repos in
// calibration), so unconstrained it would become most of the feed.
//
// Sized for the production cadence of 3-4 posts/day. Quotas are CAPS, not
// commitments — the sum (14) deliberately exceeds finalSelectionSize (8) so
// that a lane running dry on a given day is absorbed by the others instead of
// short-changing the run.
//
// Measured supply per 14-query run at the calibrated thresholds, so every
// quota below is backed by available candidates rather than hope:
//   iran_relevant ~121   ai_agents ~50   trending ~36
//   hidden_gem     ~72   established ~16  curated_list ~30
export const LANE_QUOTA = {
  iran_relevant: 3,
  ai_agents: 3,
  trending: 2,
  hidden_gem: 3,
  established: 2,
  curated_list: 1,   // stays at 1: lists are the cheapest thing to find and
                     // the least valuable to post, so they must not displace
                     // software
};

// A repo qualifying in several lanes is a stronger candidate than one
// scraping into a single lane. Small and capped, so it cannot substitute for
// quality.
export const MULTI_LANE_BONUS = { perExtraLane: 4, max: 8 };

// Distinguishes a curated list (allowed, lane F) from a config dump
// (heavily penalised). Name patterns and topics are checked separately,
// because anchors like ^ and $ are meaningless against a concatenated
// "name + topics" string — that bug made mohebifar/made-in-iran (968 stars,
// topic `curated-list`) match no lane at all during calibration.
export const CURATED_LIST_PATTERNS = [
  '^awesome[-_]', '[-_]awesome$', '^awesome$',
  '^best[-_]of[-_]', '^list[-_]of[-_]', '^curated[-_]',
  '[-_]resources$', '^resources[-_]', 'cheat[-_]?sheet',
  '[-_]roadmap$', '^roadmap[-_]', '[-_]handbook$',
];

// A repo carrying one of these topics is declaring itself a list.
export const CURATED_LIST_TOPICS = [
  'awesome', 'awesome-list', 'awesome-lists', 'curated-list', 'curated',
  'list', 'lists', 'resources', 'collection', 'directory',
  'cheatsheet', 'cheat-sheet', 'roadmap', 'learning-resources',
];

// ---------------------------------------------------------------------------
// 3. QUALITY SCORE (0..100)
// ---------------------------------------------------------------------------
// Answers only: "is this a real, well-made, alive project?"
//
// Audience fit is scored separately (section 4) and deliberately CANNOT
// rescue a low quality score — see FUNNEL.minQualityForLlm. Otherwise the
// Iran boost would eventually push a badly-made Iranian repo onto the channel.

export const QUALITY = {
  craft: 45,      // evidence of deliberate effort  <-- largest on purpose
  attention: 20,  // lane-specific, see ATTENTION_CURVES
  aliveness: 20,
  adoption: 15,   // proof that real people use it
};

// craft is the biggest slice because it is the strongest deterministic
// separator between something worth posting and the low-effort ocean. Stars
// tell you how many people arrived; a real README with a demo tells you
// whether the author meant it. It also decides whether a good caption is even
// possible.
//
// Measured justification for splitting README work into its own stage: among
// the top 12 candidates of a real 100-repo sample, ALL 12 scored full marks
// on the free signals (description, topics, license). Those signals do not
// discriminate at the top of the funnel. Only README content does.
export const CRAFT = {
  readmeLength: 10,
  demoMedia: 9,           // gif / video / asciinema / screenshot. Strongest
                          // single "the author cared" signal, and it makes
                          // the Telegram post far better.
  structure: 8,           // headings + fenced code blocks = written for a reader
  installInstructions: 6, // an install/usage section means it is meant to be
                          // USED, not just admired — the closest mechanical
                          // proxy for "solves a real problem"
  description: 5,
  topics: 4,
  homepage: 2,
  license: 1,
};
// sums to 45 = QUALITY.craft (asserted at load time by the algorithm)

export const README_BAND = {
  minBytes: 800,        // above the hard-reject floor but still thin
  goodBytes: 2500,      // full marks from here up
  plateauBytes: 20_000, // past here, extra length stops meaning extra care
};

// Attention curves, selected per lane.
export const ATTENTION_CURVES = {
  // hidden_gem: bell curve over log10(stars). 400 = full marks, 1500 ≈ half,
  // 4000 ≈ zero. Spec §14 uses an 850-star repo as its example of a gem;
  // this sits in the same neighbourhood, biased lower on purpose.
  bell: { peakStars: 400, sigmaLog10: 0.5 },

  // trending / ai_agents: more attention is straightforwardly better, with
  // diminishing returns.
  rising: { saturationStars: 5000 },

  // iran_relevant / established / curated_list: star count says almost
  // nothing about whether to post. Flat baseline plus a token bonus for
  // clearing the floor, so these lanes are not silently penalised for being
  // popular.
  flat: { baselinePoints: 14, floorClearedBonus: 6 },
};

export const ALIVENESS = {
  freshnessPoints: 13,
  maturityPoints: 7,
  freshnessHalfLifeDays: 180,
  maturitySaturationDays: 365,
};

// Known limitation of star_velocity, recorded here because it constrains how
// much weight momentum can safely carry anywhere in this file:
// star_velocity is a LIFETIME average, so it structurally penalises age. A
// five-year-old 800-star repo computes to 0.44/day and looks dead even if it
// is a perfect overlooked tool. That is why there are two separate lanes
// (trending vs. established) instead of one velocity term — weighting
// velocity globally would silently discard every mature gem. Fixing it
// properly needs star history, which costs extra paginated API calls per
// repo, and the stargazers endpoint requires authentication.
export const MOMENTUM_NOTE = 'lifetime average; see comment';

// adoption: evidence of real users, as opposed to drive-by stars.
export const ADOPTION = {
  forksPoints: 6,
  issueActivityPoints: 5,
  contributorsPoints: 4,
  forksSaturation: 60,
  // Open issues count as a POSITIVE here: they mean real users hit real
  // problems and bothered to report them. Neglect is penalised separately
  // via PENALTIES.neglectedIssues.
  issuesSaturation: 25,
  contributorsSaturation: 8,  // costs one extra API call; fetched only for
                              // stage-3 finalists
};

// ---------------------------------------------------------------------------
// 4. RELEVANCE BOOST (0..+50)
// ---------------------------------------------------------------------------
// Added on top of QUALITY. Answers: "does this matter to THIS audience?"

export const RELEVANCE = {
  iranMax: 25,
  aiMax: 15,
  iranianCreatorMax: 10,
};

// --- Iran relevance, in tiers ---
export const IRAN_RELEVANCE = {
  // Tier 1 — explicitly about Iran, or about the problem Iranian users hit
  // most often. Detected from topics, which arrive free in the search
  // response, or from Persian text in the README.
  tier1Points: 25,
  tier1Topics: [
    'iran', 'iranian', 'persian', 'farsi', 'jalali', 'shamsi', 'tehran',
    'anti-censorship', 'censorship-circumvention', 'censorship',
    'v2ray', 'vless', 'vmess', 'xray', 'sing-box', 'singbox', 'clash',
    'hysteria', 'hysteria2', 'trojan-go', 'shadowsocks', 'reality',
    'warp', 'wireguard-config', 'psiphon', 'tor-bridge', 'gfw',
    'firewall-bypass', 'domain-fronting', 'proxy-client',
  ],

  // Tier 2 — a known Iranian developer pain point without being labelled
  // "Iran": sanctions workarounds, Persian-language computing, local rules.
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

  // Tier 3 — generally worth more under sanctions and filtering than it would
  // be elsewhere, but not Iran-specific.
  tier3Points: 8,
  tier3Topics: [
    'self-hosted', 'selfhosted', 'offline-first', 'local-first', 'privacy',
    'no-cloud', 'e2e-encryption', 'p2p', 'decentralized', 'foss-alternative',
  ],

  // Persian text detection in README. Uses letters that exist in Persian but
  // not Arabic (پ چ ژ گ ک ی) so Arabic-language repos do not false-positive.
  //
  // MEASURED LIMITATION: most Iranian-authored tools write their README in
  // English. hiddify/hiddify-app contains 5 Persian characters in 11.5KB;
  // alireza0/s-ui and Ptechgithub/warpplus contain zero. So this detector has
  // a high false-negative rate and is used only as a positive signal, never
  // as a requirement.
  persianTextMinChars: 40,
  persianTextPoints: 20,
};

// --- AI relevance ---
export const AI_BOOST = {
  points: 15,

  // The justification for this boost was explicitly about the present moment.
  // Encoding that as a permanent rule would be wrong, so it carries an
  // expiry: on this date, re-decide rather than let it persist silently.
  reviewAfter: '2027-03-01',

  topics: [
    'llm', 'llms', 'ai-agent', 'ai-agents', 'agents', 'agentic',
    'mcp', 'model-context-protocol', 'rag', 'retrieval-augmented-generation',
    'langchain', 'llamaindex', 'vector-database', 'embeddings',
    'openai', 'anthropic', 'claude', 'gpt', 'ollama', 'local-llm',
    'fine-tuning', 'prompt-engineering', 'ai-tools', 'copilot',
    'speech-to-text', 'text-to-speech', 'computer-vision', 'diffusion',
  ],

  // AI is also the category with the most low-effort output. These fire the
  // aiSlop penalty even inside the AI lane, so the boost cannot carry a
  // wrapper through.
  slopPatterns: [
    'chatgpt clone', 'gpt wrapper', 'ai wrapper', 'just a wrapper',
    'awesome[- ]chatgpt[- ]prompts', 'prompt collection', 'prompts? list',
    '\\d+ prompts', 'chatbot tutorial', 'openai api example',
  ],
};

// --- Prompt dumps ---
// The AI-era equivalent of a config dump, and the largest measured leak in the
// funnel. The calibration corpus includes a deliberate `chatgpt prompts` query;
// of its 88 repos, 27 (31%) reached the LLM gate — against 0% for the free-node
// query and 5% for tutorials. AI_BOOST.slopPatterns fired on only 3 of the 27.
//
// Why they must not be posted, and why this is not just taste: a prompt list is
// not software. There is nothing to install or run, the contents rot as models
// change, and several in the corpus are jailbreak collections
// (BlackTechX011/HacxGPT-Jailbreak-prompts, 0xk1h0/ChatGPT_DAN) which the
// channel would be endorsing. They score well precisely because they are easy
// to present: a big README, many stars, real topics.
//
// A SEPARATE detector rather than more slopPatterns, for the same reason
// CONFIG_DUMP_SIGNALS is separate: the distinction that matters is against real
// software in the same space. `kardolus/chatgpt-cli`, `czhou578/llm-god` and
// `win4r/AISuperDomain` are genuine tools whose descriptions are full of the
// words "chatgpt" and "prompt". Single-keyword matching cannot separate them;
// scored signals can.
//
// Measured on hand-labelled ground truth from the corpus (18 dumps, 9 tools):
// detects 16 of 18, with 0 false positives on the tools. Corpus-wide it flags
// 47 of 1075, and inspection of all 47 found no real software among them.
//
// The two misses are deliberate rather than chased: awesome-gpt4o-images and
// GenerativeAI-Prompt-Sample-Japanese are image-prompt galleries whose
// descriptions read like ordinary curated lists. Catching them would need
// patterns broad enough to hit real list repos, and a curated list is an
// allowed lane. They score 2, so they take a partial penalty and compete at a
// disadvantage.
export const PROMPT_DUMP_SIGNALS = {
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
    // CJK: "tuning guide" / "prompt words" / "prompt" / "curated prompts"
    '调教指南', '提示词', 'プロンプト', 'prompt\\s+精选',
  ],
};

// --- Iranian creator ---
// MEASURED LIMITATION, read before tuning. This is the least reliable
// detector in the file. Of ten confirmed Iranian maintainers checked against
// the GitHub users API, exactly one (majidh1, "Tehran") had a usable
// `location`. rastikerdar (Vazirmatn), hezarai, roshan-research (Hazm),
// sajaddp, shahabyazdi and talkhabi were all null; 1995parham reads
// "Barcelona, Spain" and mohebifar "Sunnyvale, CA" — diaspora, still relevant
// to this audience but not matchable by an Iran pattern.
//
// Conclusion: detection cannot be relied on. The boost stays modest, and the
// real lever is query-side — QUERY_CLASSES.iran actively searches Iranian
// topics so these repos are FOUND whether or not we can label their author.
export const IRANIAN_CREATOR = {
  points: 10,
  locationPatterns: [
    'iran', 'ایران', 'ايران', 'tehran', 'tehrān', 'تهران', 'طهران',
    'mashhad', 'isfahan', 'esfahan', 'shiraz', 'tabriz', 'karaj', 'qom',
    'ahvaz', 'kerman', 'yazd', 'rasht', 'urmia', 'zahedan', 'kish',
  ],
  // Costs one API call per owner, so it runs only for stage-3 finalists.
  checkLocationAtStage: 3,

  // Manually curated, and the only reliable signal available. Append to this
  // whenever a missed Iranian maintainer is noticed.
  knownOwners: [
    'rastikerdar', 'roshan-research', 'hezarai', 'mohebifar', 'sajaddp',
    'majidh1', '1995parham', 'shahabyazdi', 'talkhabi', 'ashkanRmk',
    'bootmortis', 'Chocolate4U', 'barnamenevisi', 'matnbaz', 'hiddify',
    'alireza0', 'Ptechgithub', 'persian-tools', 'omid', 'Kiarash-Z',
    'pnarimani', '4xmen', 'ghost1372', 'sartoopjj', 'mahdiMGF2',
  ],
};

// ---------------------------------------------------------------------------
// 5. PENALTIES
// ---------------------------------------------------------------------------
// Encodes the spec §8 "Avoid" list. Penalties rather than hard filters,
// because keyword matching produces false positives: a real tool can
// legitimately contain the word "example".

export const PENALTIES = {
  // Config / node-list dumps, scaled by detector confidence:
  //   penalty = configDumpPerPoint * (dumpScore - rejectAtScore + 1)
  //
  // Sized from measurement, not taste. Calibration showed the strongest
  // surviving dump reached total=62 with a flat 60-point penalty, because the
  // Iran relevance boost (+25), a real README and genuine adoption pushed it
  // back over the gate. Scaling by confidence fixes that: a score-5 dump takes
  // 4 x 35 = 140, which no combination of bonuses can recover from, while a
  // borderline score-2 match only takes 35 and can still compete if everything
  // else about it is excellent.
  configDumpPerPoint: 35,

  // Prompt dumps, scaled the same way:
  //   penalty = promptDumpPerPoint * (dumpScore - rejectAtScore + 1)
  //
  // Sized from the measured leaks. The strongest prompt dump in the corpus
  // reached total=107 (ai-boost/awesome-prompts, 8824 stars) with quality 92 —
  // it presents extremely well. At 30 points per unit a score-5 dump takes
  // 3 x 30 = 90, which drops it from 107 to 17, far below minTotalForLlm. A
  // borderline score-3 match takes 30, enough to end its chances at the
  // typical 70-90 band without pretending to certainty the detector lacks.
  promptDumpPerPoint: 30,

  learningProject: 20,
  // Must roughly cancel the +15 AI boost so a wrapper nets negative.
  aiSlop: 18,
  // More forks than half the stars means people COPY it rather than use it —
  // the fingerprint of a course repo that slipped past the is_template flag.
  forkRatioAnomaly: 8,
  neglectedIssues: 6,
  noDescription: 8,
  // Usually means documents rather than software. Waived for the
  // curated_list lane, where having no language is expected.
  noLanguage: 5,
  bloated: 4,
};

export const PENALTY_THRESHOLDS = {
  forkRatio: 0.5,
  issueToStarRatio: 0.3,
  minDescriptionChars: 15,
  bloatedSizeKb: 100_000,
};

// Note the explicit `s?` on every noun. This is the SIXTH instance of the same
// regex-boundary family of bugs (see the four documented in the calibration
// notes). compile() anchors with (?![a-z0-9]), and a trailing "s" is [a-z], so
// the lookahead fails on any plural: `tutorial` matched but `tutorials` did not.
//
// Measured cost of that one character: of nine junk_learning repos that reached
// the LLM gate, four were named exactly this way — luuquangvu/tutorials,
// deepset-ai/haystack-tutorials, triton-inference-server/tutorials and
// ChristianLempa/boilerplates — and took no penalty at all. Naming a tutorial
// repo in the plural is the norm, not the exception.
export const LEARNING_PROJECT_PATTERNS = [
  'tutorials?', 'boilerplates?', 'starter kits?', 'starter templates?', 'scaffold',
  'my first', 'learning projects?', 'practice projects?', 'course projects?',
  'exercises?', 'exercise solutions?', 'homework', 'bootcamps?',
  'clone of', 'a clone', 'todo apps?', 'todo list apps?', 'crud apps?',
  'sample apps?', 'sample projects?', 'demo projects?', 'example projects?',
  'test projects?', 'playground for learning', 'follow along',
  'coding challenges?', 'leetcode', 'advent of code', 'hacktoberfest',
  'interview questions?',
];
// 'cheat sheet' and 'roadmap' were in the earlier draft and have been
// REMOVED: they are legitimate curated_list candidates.

export const DEMO_MEDIA_PATTERNS = [
  '\\.gif[)"\'\\s]', '\\.mp4', '\\.webm', '\\.webp',
  'asciinema\\.org', 'youtube\\.com/watch', 'youtu\\.be/',
  'demo\\.(gif|mp4|png|webp)', 'screenshot', 'screencast',
  'user-images\\.githubusercontent\\.com',
  'github\\.com/user-attachments/assets',
];

export const INSTALL_PATTERNS = [
  '## *install', '## *getting started', '## *quick ?start', '## *usage',
  '## *setup', 'npm i(nstall)? ', 'pip install ', 'cargo install ',
  'go install ', 'brew install ', 'docker run ', 'docker compose up',
  'apt install ', 'pacman -S ', 'yay -S ',
];

// ---------------------------------------------------------------------------
// 6. FUNNEL
// ---------------------------------------------------------------------------

export const FUNNEL = {
  readmeFetchLimit: 120,   // stage 1 -> 2, one raw.githubusercontent fetch each

  // README budget is split PER LANE, not taken from one global ranking.
  //
  // MEASURED PROBLEM, found by dryrun.mjs. A single global sort by total score
  // starves four of the six lanes, because relevance boosts are part of the
  // total and only two lanes can earn them. Mean values across 801 eligible
  // corpus repos:
  //     iran_relevant   quality 53.6   relevance +25.1
  //     ai_agents       quality 48.8   relevance +15.0
  //     curated_list    quality 59.1   relevance  +7.8
  //     established     quality 63.1   relevance  +0.5
  //     trending        quality 50.5   relevance  +0.2
  //     hidden_gem      quality 43.7   relevance  +0.4
  //
  // So the top 120 came out as iran 99, ai 16, lists 5, and ZERO for trending,
  // hidden_gem and established. The top 16 were all iran_relevant. The best
  // repo in the trending lane ranked 182nd overall; the best established one
  // (gunicorn) ranked 206th. Those lanes would never have had a README fetched,
  // which makes their query budget and their LANE_QUOTA pure decoration.
  //
  // Note this is NOT a scoring bug: `established` genuinely has the highest
  // mean quality of any lane (63.1) and still lost, because it cannot earn a
  // relevance boost by definition. Comparing a boosted total against an
  // unboosted one across lanes is the error. Lanes exist precisely because
  // "obscure" and "trending" are not comparable on one axis — the same
  // reasoning that produced separate attention curves has to apply to the
  // README budget too.
  //
  // Shares are proportional to LANE_QUOTA, so a lane's slice of the expensive
  // stage matches its slice of the output. Leftover capacity from a lane with
  // too little supply is redistributed at runtime, so nothing is wasted.
  readmeBudgetPerLane: true,

  // stage 2 -> 3. The expensive gate: with free-tier models capped near 50
  // requests/day (AGENTS.md §8), this number IS the daily LLM budget.
  // 16 supports 3-4 published posts/day with room for human rejections.
  llmCandidateLimit: 16,

  // --- Both thresholds below are CALIBRATED, not guessed. ---
  // Method: 1075 live repos were collected, including four deliberately
  // adversarial queries (free-vpn configs, cracks, tutorials, prompt dumps) so
  // the corpus contained the things the rules must reject. Junk density was
  // then measured per score band:
  //
  //     <40   33%      70-80    9.8%
  //    40-50  38%      80-90    8.0%
  //    50-60  24%      90-100   3.5%
  //    60-70  27%      100+     3.8%
  //
  // Junk density collapses between 60-70 and 70-80 — 27% to 10%. That knee is
  // where the threshold belongs; below it, one candidate in four is garbage.
  minTotalForLlm: 70,

  // A floor on QUALITY alone. Relevance boosts are deliberately excluded, so a
  // badly-made repo can never reach the LLM on the strength of being
  // Iran-relevant or AI-adjacent.
  //
  // Measured effect: at minTotal=70, eleven repos passed on quality under 60
  // carried by a +25 Iran boost. Inspecting them settled the value — the group
  // contained real Persian tools (Vajehdan, laravel-persian-string, a Persian
  // pixel font) alongside things this channel should not post (lecture notes,
  // a brand colour list). 55 keeps the tools and drops the notes.
  //
  // Raising it further is tempting but wrong: those Persian tools have 20-74
  // stars, and a small niche tool cannot score highly on adoption. Quality
  // scoring structurally under-rates exactly the repos this channel exists to
  // surface, so this floor must stay low enough to let them through.
  minQualityForLlm: 55,

  // Verified against measured supply: 8 is reachable every run.
  finalSelectionSize: 8,

  // --- Purpose-level duplicate detection ---
  // Distinct from repo-level dedup (the unique index). This is what stops the
  // channel posting a fourth v2ray client that does nothing new — the explicit
  // "must differentiate from competitors" requirement.
  //
  // MEASURED, and the first design was wrong. Description trigram similarity
  // was tried alone at 0.45. Tested on the real same-purpose pairs this rule
  // exists for:
  //     v2rayA ~ v2rayN            0.32
  //     hiddify-app ~ v2rayN       0.22
  //     hazm ~ shekar              0.17   (two Persian NLP libraries)
  //     s-ui ~ Hiddify-Manager     0.04   (two sing-box panels)
  // Not one reached 0.45. Two tools can do the identical job and describe it in
  // completely different words, so at 0.45 the rule would never fire, and
  // lowering the threshold does not fix it: across 762 corpus repos, 0.45 flags
  // 56 pairs and 0.25 flags 624, and the pairs it does flag are mostly
  // TEMPLATED text — "Free V2ray Configs, Updating Every 15 minutes" appearing
  // verbatim in two different dump repos, or the same tutorial translated into
  // five languages. It detects copied wording, not shared purpose.
  //
  // Topic overlap (Jaccard) measures the same pairs far better:
  //     Hiddify-Manager ~ hiddify-app   0.65
  //     Hiddify-Manager ~ s-ui          0.43
  //     hiddify-app ~ s-ui              0.40
  //     hazm ~ vazirmatn                0.13   (unrelated, correctly low)
  //     anything ~ JalaliDatePicker     0.00
  // Distribution over 776 corpus repos with >=2 topics: 0.30 flags 216 pairs,
  // 0.40 flags 76, 0.50 flags 35. Inspecting the 0.30+ list, the pairs are
  // genuinely same-purpose (two Persian GNOME calendar extensions at 0.71, two
  // Iran routing-rule sets at 0.62, two awesome-Persian-media lists at 0.50).
  //
  // So BOTH signals are kept, with either one sufficient to trigger a
  // comparison. They fail in opposite directions: topics are missing or sparse
  // on 28% of corpus repos, where the description is all there is; descriptions
  // are unreliable when two authors word the same thing differently, where
  // topics work.
  //
  // Neither DECIDES anything. Crossing a threshold only means the already
  // published repo is shown to the LLM with the question "does this improve on
  // it, or repeat it?" — differentiation is a judgement, and LLM_MUST_JUDGE
  // says so.
  purposeSimilarityThreshold: 0.45,   // description trigram; rarely fires alone
  purposeTopicJaccardThreshold: 0.35, // between 0.30 (216 pairs) and 0.40 (76)
  purposeMinSharedTopics: 3,          // guard: 1/2 topics reaches 0.5 trivially
  purposeCompareLimit: 5,             // most similar published repos shown to the LLM
};

// ---------------------------------------------------------------------------
// 7. DIVERSITY
// ---------------------------------------------------------------------------
// Not in the spec, added deliberately. Spec §25's feedback loop amplifies
// whatever category performs best, which ends in monoculture ("another Rust
// CLI tool"). These caps are the counterweight.

export const DIVERSITY = {
  maxPerLanguage: 2,
  maxPerCategory: 2,
  maxPerOwner: 1,
};

// ---------------------------------------------------------------------------
// 8. QUERIES
// ---------------------------------------------------------------------------
// The constraint that shapes all of this: GitHub search returns AT MOST 1000
// results per query, however many match. A single broad query sorted by stars
// therefore returns the same famous head of the band on every run — the
// opposite of discovery. The fix is sharding plus sort rotation plus DB dedup.
//
// This is also the REAL control surface. Measurement showed the hard filters
// pass 87% of what the queries return, because the query already encodes the
// star band and the date bounds. The queries decide what the system sees; the
// filters are a safety net.

export const QUERY = {
  queriesPerRun: 14,
  resultsPerQuery: 100,   // GitHub's per-page maximum

  // Query budget split across lanes.
  allocation: {
    iran: 4,
    ai: 3,
    trending: 2,
    hidden: 3,
    established: 1,
    lists: 1,
  },

  // --- Multi-topic syntax: MEASURED, and it is not the obvious one ---
  // `topic:a OR topic:b` returns HTTP 422:
  //   "The search contains only logical operators (AND / OR / NOT) without any
  //    search terms. Logical operators only apply to text, not to qualifiers."
  //
  // The working form is the comma list, `topic:a,b`, and it is a true UNION.
  // Verified numerically: topic:jalali = 52, topic:persian-calendar = 47,
  // topic:jalali,persian-calendar = 90, and the intersection (space-separated,
  // which means AND) = 9. 52 + 47 - 9 = 90 exactly.
  //
  // This is not a style preference — it is why five of the eighteen queries in
  // collect.mjs silently returned nothing during the first calibration
  // (iran_circumv, iran_censor, ai_mcp, ai_agents, ai_llm all used OR). Every
  // repo attributed to the ai_agents lane in that corpus arrived incidentally
  // through some other query.
  topicSeparator: ',',

  // --- Hard limits imposed by the GitHub search API itself ---
  // Both are documented API limits, not preferences. Exceeding either returns
  // HTTP 422 and the run silently loses that query, so queries.js asserts
  // against them at build time rather than discovering it at request time.
  maxQueryChars: 256,
  // "Queries containing more than five AND, OR, or NOT operators will be
  // rejected." With comma unions, topic lists spend none of this budget, so it
  // now only guards the text-term queries (the curated-list class).
  maxOperators: 4,

  // A comma union costs no operators, so this cap is not about the API limit —
  // it is about not making one query so broad that its first 100 results are
  // all from the single largest topic. Measured yields per topic show why:
  // topic:llm alone returns 3174 repos against topic:fine-tuning's 90, so
  // unioning them lets llm swamp the page. Six is the largest pool size, and
  // the pools are hand-grouped by theme, so a full pool is a coherent union.
  maxTopicsPerQuery: 6,

  // `archived:false` is a free qualifier (not an operator) and HARD_REJECT
  // discards archived repos anyway, so filtering server-side stops archived
  // repos consuming result slots. Calibration wasted 13 of 1075 this way.
  excludeArchived: true,

  // Spacing between search calls. GitHub's search endpoint allows 30/min
  // authenticated, 10/min unauthenticated; the workflow authenticates with the
  // GitHub credential, so 2.5s keeps a 14-query run inside 30/min with margin
  // and finishes in ~35s.
  searchSpacingMs: 2500,

  // Below this, a query is not pulling its weight and the budget should move
  // elsewhere. Set from measured per-topic yields: the weakest live iran topic
  // (persian-nlp, 6 repos) is genuinely marginal, while the weakest pool UNION
  // is comfortably above 100. Used by verify-queries.mjs as a warning
  // threshold, not enforced at runtime — a thin query is still worth firing.
  minExpectedYield: 30,
};

export const QUERY_CLASSES = {
  // Iranian relevance is hard to DETECT but easy to SEARCH. This is the main
  // lever for the Iran-usefulness and Iranian-creator requirements.
  // Verified live: topic:iran returns 882 repos, topic:persian 1677 —
  // enough population to sustain four queries per run.
  iran: {
    topicPools: [
      ['iran', 'iranian', 'persian', 'farsi'],
      ['v2ray', 'xray', 'sing-box', 'hysteria2', 'vless', 'reality'],
      ['anti-censorship', 'censorship-circumvention', 'firewall-bypass', 'gfw'],
      // `rtl` is deliberately NOT in this pool, even though it IS a tier-2
      // scoring topic. Measured on the live top 100 of `topic:rtl stars:20..*`:
      // 62 were hardware projects (RTL = Register Transfer Level — Chisel,
      // Verilator, rocket-chip, OpenROAD) and only 38 were text-direction
      // work. As a QUERY it would spend 62% of a 100-result page on chip
      // design; as a SCORING topic it is harmless, because a hardware repo
      // picking up +15 relevance still has to clear the quality gate on its
      // own merits.
      //
      // Restricted to unambiguous alternatives, all verified to have live
      // population at stars:20..*: persian-language 48, hijri 35,
      // right-to-left 25, shamsi 19, bidi 12. `rtl-layout` (0),
      // `farsi-language` (1) and `iran-tech` (0) were measured and dropped as
      // empty.
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
    // Pools grouped so each union is roughly comparable in size, because a
    // union is read only 100 deep and the largest member dominates the page.
    // Measured union totals at stars:80..* pushed:<120d — p1 (mcp) 3117,
    // p2 (llm) 3786, p3 (tools) 1007.
    //
    // Measured overlap: p1 and p2 share 34 of their top 100, the largest
    // duplicate pair in the whole plan. That is inherent — an MCP server is
    // usually also tagged `llm` — and is left alone rather than papered over,
    // because splitting these pools further would only produce thinner queries
    // with the same repos in them. The dedup step downstream absorbs it.
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

  // Finds spikes structurally: recently created AND already has real stars.
  // Verified against live data — returns genuinely trending repos rather than
  // relying on GitHub Trending, which spec §12 warns against.
  trending: {
    createdWithinDays: 60,
    starRange: '200..*',
    sorts: [{ sort: 'stars', order: 'desc' }],
  },

  // The sharding scheme, for the hidden_gem lane.
  hidden: {
    starShards: ['50..120', '120..300', '300..700', '700..1500', '1500..4000'],
    createdWithinDays: 1460,
    pushedWithinDays: 400,
    sorts: [
      { sort: 'updated', order: 'desc' },
      // Reaches the bottom of each shard, where the least-discovered repos
      // are. The single most useful sort for this lane.
      { sort: 'stars', order: 'asc' },
      { sort: 'forks', order: 'desc' },
      { sort: 'help-wanted-issues', order: 'desc' },
    ],
  },

  // Maintained classics. Sorted by 'updated' so it surfaces old repos still
  // being worked on, rather than replaying the same all-time top list.
  established: {
    starRange: '1500..*',
    createdBeforeDays: 365,
    pushedWithinDays: 240,
    sorts: [{ sort: 'updated', order: 'desc' }],
  },

  lists: {
    namePools: ['awesome', 'curated', 'best-of', 'resources'],
    // Half of these queries are Iran-scoped: an Iran-relevant list is far
    // more valuable to this channel than a generic one.
    iranScopedRatio: 0.5,
    starRange: '100..*',
    pushedWithinDays: 300,
    sorts: [{ sort: 'updated', order: 'desc' }],
  },
};

export const LANGUAGE_SHARDS = [
  'rust', 'go', 'python', 'typescript', 'javascript', 'c', 'cpp', 'zig',
  'lua', 'shell', 'elixir', 'ruby', 'java', 'kotlin', 'swift', 'nim',
  'ocaml', 'haskell', 'crystal', 'julia', 'clojure', 'dart', 'odin',
];

export const TOPIC_SHARDS = [
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

// ---------------------------------------------------------------------------
// 8b. ROTATION
// ---------------------------------------------------------------------------
// Why rotation exists at all: GitHub returns at most 1000 results per query,
// and the run only reads the first 100. A fixed query set therefore reads the
// same 100 repos every single day — after run one, every later run is pure
// waste. Rotation is what makes run 30 see different repos than run 1.
//
// The seed is the DAY NUMBER, not a random value or a stored counter:
//   - reproducible, so a failed run can be replayed and debugged identically;
//   - stateless, so nothing has to be persisted between runs;
//   - monotonic, so consecutive days never repeat the same combination.
//
// Offsets are co-prime with their pool sizes wherever possible so the walk
// visits the whole pool before repeating, instead of cycling a subset.

export const ROTATION = {
  // Day 0 of the schedule. Only affects which shard a given date lands on.
  epochUtc: '2026-01-01',

  // How many shard qualifiers a single hidden-gem query carries. One: two
  // would over-narrow (`language:zig topic:ocr` matches almost nothing) and
  // measurement is not needed to see that the intersection of a 23-item and a
  // 54-item pool is mostly empty.
  shardsPerHiddenQuery: 1,

  // Hidden-gem queries alternate between a language qualifier and a topic
  // qualifier. Both dimensions are needed: language sharding reaches
  // ecosystems (a good Zig tool is invisible in a global star band), topic
  // sharding reaches purposes (a good OCR tool likewise).
  hiddenShardKinds: ['language', 'topic'],

  // Prime-ish strides so the sequence does not settle into a short cycle
  // against the pool lengths (23 languages, 54 topics, 5 star shards).
  languageStride: 7,
  topicStride: 11,
  starShardStride: 2,
};

// ---------------------------------------------------------------------------
// 8c. RECONSIDERATION / COOLDOWN
// ---------------------------------------------------------------------------
// The single most important rule for a REPEATING run, and the one thing the
// step-1 workflow never needed.
//
// The problem, stated plainly: scores are almost stationary from one day to the
// next. A repo that scored 118 today scores ~118 tomorrow. So an unconstrained
// daily run selects the SAME top eight forever — it would send the same eight
// repos to the LLM every day and, once those are published or rejected, sit
// permanently on the ninth through sixteenth. Storing rejects (schema.sql) only
// prevents re-INSERTING them; nothing yet prevents re-SPENDING quota on them.
//
// Cooldowns are therefore per outcome, because the outcomes carry very
// different amounts of information:
export const COOLDOWN = {
  // Human said no. The strongest signal in the system — a person looked at the
  // rendered caption and declined. Never reconsider automatically; if the repo
  // deserves a second chance, it can be resubmitted through the manual form.
  humanRejected: null,          // null = never

  // Published. The unique index already makes a second published post
  // impossible; this keeps such repos out of the candidate query so they do
  // not occupy scoring slots.
  published: null,

  // LLM said reject. A model's verdict on a repo's novelty and usefulness is
  // not going to flip because a week passed. Long, but not never: the repo
  // itself can genuinely change (a rewrite, a v2), and a year is long enough
  // that re-asking costs one LLM call per repo per year.
  llmRejected: 365,

  // Scored, cleared the hard filters, but finished below minTotalForLlm. This
  // is the group that MUST come back: it holds every repo currently growing
  // toward the threshold. 30 days is roughly the shortest interval over which
  // a small repo's star count and README meaningfully change.
  nearMiss: 30,

  // Scored, above the gate, but lost its slot to lane quota or a diversity cap
  // on the day. Nothing is wrong with it — it was simply eighth in a field of
  // eight. Short cooldown so it competes again almost immediately.
  notSelected: 3,

  // Failed a hard reject that could stop being true: idle-too-long, no README
  // yet, too few stars for its lane. These are states, not verdicts.
  softReject: 45,

  // Failed a hard reject that will effectively never stop being true:
  // archived, fork, template, piracy, config dump. Kept in the table purely as
  // a dedup memory so no run ever fetches their README again.
  permanentReject: null,
};

// Which hard-reject reasons are permanent vs. recoverable. Used to pick the
// cooldown above. Listed explicitly rather than inferred, so adding a new
// reject reason forces a deliberate decision about its cooldown.
export const REJECT_PERMANENCE = {
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

// Which pipeline stages produce a score that may be compared against
// FUNNEL.minTotalForLlm — and therefore which stages may label a repo
// `nearMiss` (a 30-day lockout).
//
// MEASURED, and the first version of outcomeOf() got this wrong. Stage A scores
// metadata only; craft points that need a README are structurally unavailable,
// so a stage-A total is not on the same scale as the threshold it was compared
// against. Across 778 corpus repos scored both ways:
//     mean(stage B - stage A) = +21.7 points
//     percentiles p10/p50/p90 = +12.3 / +24.0 / +33.0
//     only 4 of 778 scored LOWER with the README
// Of the repos below 70 at stage A, 249 crossed 70 once the README was read and
// 343 did not — so 42% of them were not near-misses at all.
//
// Why that matters per run: stage A clears ~801 repos but only
// FUNNEL.readmeFetchLimit (120) receive a README, leaving ~681 scored on
// metadata alone. Labelling those `nearMiss` locked 551 of them out for 30 days,
// including the ~42% that would have passed. The algorithm was burying its own
// best candidates for a month.
//
// So the score is still stored (it is the only record of how a repo trended),
// but it may not trigger the long cooldown unless a README-bearing stage
// produced it. Everything else falls through to COOLDOWN.notSelected (3 days),
// which is the correct meaning: "nothing was wrong with it, it just did not get
// a slot today".
export const COMPARABLE_SCORE_STAGES = ['b', 'llm', 'selected'];

// ---------------------------------------------------------------------------
// 9. CATEGORIES — spec §18, verbatim
// ---------------------------------------------------------------------------
export const CATEGORIES = [
  'AI', 'developer-tools', 'security', 'linux', 'web', 'mobile', 'creative',
  'fun', 'experimental', 'productivity', 'backend', 'gaming', 'data',
];

// ---------------------------------------------------------------------------
// 10. WHAT THE LLM MUST STILL DECIDE
// ---------------------------------------------------------------------------
// Nothing above can judge these. Listed here so the prompt and the algorithm
// stay in sync: the algorithm's only job is to choose which repos are worth
// asking about.
//
//  - Differentiation. The requirement that an Iran-relevant tool must IMPROVE
//    on its competitors is a judgement, not a metric. A v2ray client with a
//    good README and 2k stars looks identical to metadata whether it is a
//    genuine advance or the fortieth GUI wrapper around the same core.
//    FUNNEL.purposeSimilarityThreshold surfaces the comparison; the model
//    makes the call.
//  - Real usefulness vs. impressive-looking. craft measures presentation
//    effort, which correlates with usefulness but is not the same thing.
//  - Whether a "solves a problem" claim is real or marketing.
//  - Novelty and wow factor (spec §16, §17).
export const LLM_MUST_JUDGE = [
  'differentiation_vs_competitors',
  'real_usefulness',
  'novelty',
  'wow_factor',
];
