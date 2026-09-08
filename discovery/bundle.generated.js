// Pure GitHub — discovery engine, bundled for an n8n Code node.
//
// GENERATED FILE — DO NOT EDIT.
// Source: discovery/rules.js, discovery/algorithm.js, discovery/queries.js
// Rebuild: node discovery/bundle.mjs
//
// Paste the whole file into a Code node (mode: Run Once for All Items) above
// your own logic, then call into PUREGH. Everything is synchronous and pure —
// no fetch, no database, no Date.now() unless you pass one in.
//
// Typical use in the Discovery workflow:
//
//   // node "Build Queries"
//   const plan = PUREGH.buildQueries(Date.now());
//   return plan.map((p) => ({ json: p }));      // one item per query
//
//   // node "Score Stage A"  (metadata only, ~1200 repos)
//   const scored = items.map((i) => PUREGH.scoreStageA(i.json));
//
//   // node "Score Stage B"  (with README, ~120 repos)
//   const s = PUREGH.scoreStageB(repo, readme);
//   if (PUREGH.passesLlmGate(s)) { /* ... */ }
//
//   // node "Select Candidates"
//   const { chosen } = PUREGH.select(scoredList, PUREGH.rules.FUNNEL.llmCandidateLimit);
//
//   // node "Final Selection"  (after the LLM has judged)
//   const { chosen } = PUREGH.selectFinal(judged);

// ===== rules.js ====================================================
const R = (function () {
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

const HARD_REJECT = {
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
const CONFIG_DUMP_SIGNALS = {
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

const PIRACY_PATTERNS = [
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

const LANE_PRIORITY = [
  'iran_relevant',
  'ai_agents',
  'trending',
  'hidden_gem',
  'established',
  'curated_list',
];

const LANES = {
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
const IDLE_FORGIVENESS_NOTE = 'see comment above';

// Known remaining gap, recorded rather than hidden: a repo with >4000 stars,
// aged 21–180 days, that has stopped being pushed and is neither AI- nor
// Iran-relevant matches no lane. Such a repo had its moment recently and is
// already cooling, so skipping it is defensible — but it IS a gap, not a
// decision the rules express deliberately.
const LANE_COVERAGE_NOTE = 'see comment above';

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
const LANE_QUOTA = {
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
const MULTI_LANE_BONUS = { perExtraLane: 4, max: 8 };

// Distinguishes a curated list (allowed, lane F) from a config dump
// (heavily penalised). Name patterns and topics are checked separately,
// because anchors like ^ and $ are meaningless against a concatenated
// "name + topics" string — that bug made mohebifar/made-in-iran (968 stars,
// topic `curated-list`) match no lane at all during calibration.
const CURATED_LIST_PATTERNS = [
  '^awesome[-_]', '[-_]awesome$', '^awesome$',
  '^best[-_]of[-_]', '^list[-_]of[-_]', '^curated[-_]',
  '[-_]resources$', '^resources[-_]', 'cheat[-_]?sheet',
  '[-_]roadmap$', '^roadmap[-_]', '[-_]handbook$',
];

// A repo carrying one of these topics is declaring itself a list.
const CURATED_LIST_TOPICS = [
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

const QUALITY = {
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
const CRAFT = {
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

const README_BAND = {
  minBytes: 800,        // above the hard-reject floor but still thin
  goodBytes: 2500,      // full marks from here up
  plateauBytes: 20_000, // past here, extra length stops meaning extra care
};

// Attention curves, selected per lane.
const ATTENTION_CURVES = {
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

const ALIVENESS = {
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
const MOMENTUM_NOTE = 'lifetime average; see comment';

// adoption: evidence of real users, as opposed to drive-by stars.
const ADOPTION = {
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

const RELEVANCE = {
  iranMax: 25,
  aiMax: 15,
  iranianCreatorMax: 10,
};

// --- Iran relevance, in tiers ---
const IRAN_RELEVANCE = {
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
const AI_BOOST = {
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
const IRANIAN_CREATOR = {
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

const PENALTIES = {
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

const PENALTY_THRESHOLDS = {
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
// 'cheat sheet' and 'roadmap' were in the earlier draft and have been
// REMOVED: they are legitimate curated_list candidates.

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

// ---------------------------------------------------------------------------
// 6. FUNNEL
// ---------------------------------------------------------------------------

const FUNNEL = {
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

const DIVERSITY = {
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

const QUERY = {
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

const QUERY_CLASSES = {
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

const ROTATION = {
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
const COOLDOWN = {
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
const COMPARABLE_SCORE_STAGES = ['b', 'llm', 'selected'];

// ---------------------------------------------------------------------------
// 9. CATEGORIES — spec §18, verbatim
// ---------------------------------------------------------------------------
const CATEGORIES = [
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
const LLM_MUST_JUDGE = [
  'differentiation_vs_competitors',
  'real_usefulness',
  'novelty',
  'wow_factor',
];
  return { HARD_REJECT, CONFIG_DUMP_SIGNALS, PIRACY_PATTERNS, LANE_PRIORITY, LANES, IDLE_FORGIVENESS_NOTE, LANE_COVERAGE_NOTE, LANE_QUOTA, MULTI_LANE_BONUS, CURATED_LIST_PATTERNS, CURATED_LIST_TOPICS, QUALITY, CRAFT, README_BAND, ATTENTION_CURVES, ALIVENESS, MOMENTUM_NOTE, ADOPTION, RELEVANCE, IRAN_RELEVANCE, AI_BOOST, PROMPT_DUMP_SIGNALS, IRANIAN_CREATOR, PENALTIES, PENALTY_THRESHOLDS, LEARNING_PROJECT_PATTERNS, DEMO_MEDIA_PATTERNS, INSTALL_PATTERNS, FUNNEL, DIVERSITY, QUERY, QUERY_CLASSES, LANGUAGE_SHARDS, TOPIC_SHARDS, ROTATION, COOLDOWN, REJECT_PERMANENCE, COMPARABLE_SCORE_STAGES, CATEGORIES, LLM_MUST_JUDGE };
})();

// ===== algorithm.js ================================================
const A = (function (R) {
// Pure GitHub — Discovery algorithm
//
// Pure functions only, no I/O. Every number comes from rules.js; nothing is
// hardcoded here. Written so the whole file can be pasted into an n8n Code
// node once calibration is settled.
//
// Two-stage by design:
//   scoreStageA(repo)            — metadata only, free, runs on ~1000 repos
//   scoreStageB(repo, readme)    — adds README signals, runs on ~120
// Both return the same shape so the caller can sort with either.


// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

/** Compile a pattern list once into a single word-boundary anchored regex. */
function compile(patterns) {
  const body = patterns
    .map((p) => (/[\\^$()[\]*+?{}|]/.test(p) ? p : escapeLiteral(p)))
    .join('|');
  // Boundaries must NOT include letters, or a camelCase repo name defeats
  // them: /(?:^|[^a-z0-9])crack/i never matched "PyInstaCrack" or "hashCrack",
  // which is how four piracy repos leaked through in the first calibration
  // run. Lookaround on non-letters only, so "Crack" inside "PyInstaCrack" is
  // caught while "crack" inside a genuine word is still bounded.
  return new RegExp(`(?<![a-z0-9])(?:${body})(?![a-z0-9])`, 'i');
}

/** Same, but the patterns already encode their own anchors. */
function compileRaw(patterns) {
  return new RegExp(patterns.join('|'), 'i');
}

/**
 * Word-boundary anchored on BOTH sides, for short keywords that appear inside
 * longer words. Measured need: unanchored "rial" matched tutorial, material,
 * serial, editorial and industrial, awarding fake Iran relevance to 163 of
 * 1075 corpus repos against 26 genuine matches — a 6:1 false-positive rate.
 */
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
  // Letters present in Persian but not Arabic, so Arabic repos do not
  // false-positive as Persian.
  persianOnly: /[\u067E\u0686\u0698\u06AF\u06A9\u06CC]/g,
};

const KNOWN_IRANIAN = new Set(
  R.IRANIAN_CREATOR.knownOwners.map((o) => o.toLowerCase()),
);

const LIST_TOPICS = new Set(R.CURATED_LIST_TOPICS);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const saturate = (v, sat) => (sat <= 0 ? 0 : 1 - Math.exp(-3 * clamp(v, 0, Infinity) / sat));

/** Normalise the two shapes we receive: GitHub API JSON, or a DB row. */
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
    defaultBranch: raw.default_branch ?? null,
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

/** name + topics, the cheap text surface used for structural classification. */
const nameSurface = (r) => `${splitCamel(r.name)} ${r.topics.join(' ')}`;
/** Everything textual, used for penalty matching. */
const fullSurface = (r, readme = '') =>
  `${splitCamel(r.name)} ${r.description} ${r.topics.join(' ')} ${readme.slice(0, 1500)}`;

/**
 * Insert spaces at camelCase boundaries so word-anchored patterns can see
 * words fused into an identifier.
 *
 * Measured need: four piracy repos leaked through the first calibration run
 * purely because their names were camelCase — PyInstaCrack, hashCrack,
 * GeetestCrack, NetCracker. Splitting first catches all four while still
 * leaving crackle-parser, nutcracker and Cracklib alone.
 */
function splitCamel(s) {
  return String(s ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

// ---------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------

/** Is this an auto-generated config / node-list dump rather than software? */
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

/**
 * Is this a prompt / jailbreak collection rather than software?
 *
 * Kept separate from configDumpScore because the hard case is different: here
 * the risk is confusing a prompt LIST with a real ChatGPT TOOL, whose
 * description contains all the same vocabulary. See PROMPT_DUMP_SIGNALS.
 */
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
  // Name and topics are tested separately: the name patterns are anchored
  // (^awesome-, -resources$), and those anchors never match inside a
  // concatenated "name + topics" string.
  if (RX.curatedList.test(r.name)) return true;
  return r.topics.some((t) => LIST_TOPICS.has(t));
}

function isPiracy(r, readme = '') {
  return RX.piracy.test(fullSurface(r, readme));
}

/** Iran relevance tier (0 = none). Returns points and why. */
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

// ---------------------------------------------------------------------------
// hard rejects
// ---------------------------------------------------------------------------

/** Returns [] when eligible, otherwise the reasons it is not. */
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
  // README is only checked once it has actually been fetched.
  if (readme !== null && readme.length < H.minReadmeBytes) out.push('no-readme');
  return out;
}

// ---------------------------------------------------------------------------
// lanes
// ---------------------------------------------------------------------------

/**
 * Which lanes this repo qualifies for, in LANE_PRIORITY order.
 * `ctx` carries the relevance results so they are computed once.
 */
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
  // A curated list must not also occupy a software lane; its scoring profile
  // is different and it would otherwise take a software slot.
  if (lane !== 'curated_list' && ctx.isList) return false;

  let min = L.starsMin;
  if (lane === 'curated_list' && ctx.iran.tier > 0 && L.iranStarsMin != null) {
    min = L.iranStarsMin;
  }
  if (r.stars < min) return false;
  if (L.starsMax != null && r.stars > L.starsMax) return false;
  if (L.minAgeDays != null && r.ageDays < L.minAgeDays) return false;
  if (L.maxAgeDays != null && r.ageDays > L.maxAgeDays) return false;

  // Idle limit, with the finished-not-abandoned escape hatch where the lane
  // defines one. See IDLE_FORGIVENESS_NOTE in rules.js.
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

// ---------------------------------------------------------------------------
// scoring components
// ---------------------------------------------------------------------------

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
  // flat
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
  // contributors is only available at stage 3; award the average until then so
  // stage-2 ranking is not distorted by a field nobody has.
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
    // Scaled by detector confidence — see PENALTIES.configDumpPerPoint.
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
  // Expected for a curated list, so waived there.
  if (!r.language && !ctx.isList) add(P.noLanguage, 'no-language');
  if (r.sizeKb > T.bloatedSizeKb) add(P.bloated, 'bloated');

  return { points: total, hits };
}

// ---------------------------------------------------------------------------
// public scoring entry points
// ---------------------------------------------------------------------------

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

/** Stage A — metadata only. README signals unavailable. */
const scoreStageA = (repo, now = Date.now()) => scoreWith(repo, null, now);

/** Stage B — with README. */
const scoreStageB = (repo, readme, now = Date.now()) =>
  scoreWith(repo, String(readme ?? ''), now);

// ---------------------------------------------------------------------------
// per-lane budget allocation
// ---------------------------------------------------------------------------

/**
 * Split `limit` slots across lanes in proportion to LANE_QUOTA, then fill any
 * remainder with the best leftover candidates regardless of lane.
 *
 * WHY, measured twice: a global sort by total score starves four of the six
 * lanes, because relevance boosts are part of the total and only two lanes can
 * earn one. Mean values across 801 eligible corpus repos:
 *     iran_relevant   quality 53.6   relevance +25.1
 *     ai_agents       quality 48.8   relevance +15.0
 *     curated_list    quality 59.1   relevance  +7.8
 *     established     quality 63.1   relevance  +0.5
 *     trending        quality 50.5   relevance  +0.2
 *     hidden_gem      quality 43.7   relevance  +0.4
 *
 * Note `established` has the HIGHEST mean quality of any lane and still loses —
 * it simply cannot earn a boost. Comparing a boosted total against an unboosted
 * one across lanes is the error. Lanes exist because "obscure" and "trending"
 * are not commensurable; that reasoning has to extend to budget, not just to
 * attention curves.
 *
 * Observed effect of not doing this:
 *   - README budget: global top 120 was iran 99 / ai 16 / lists 5, and ZERO for
 *     trending, hidden_gem and established. Best trending repo ranked 182nd,
 *     best established (gunicorn) 206th.
 *   - LLM candidates: even after fixing the README budget, a global top 16 was
 *     iran 6 / ai 6 / lists 2 / trending 1 / established 1 and again ZERO
 *     hidden_gem, despite 25 hidden_gem candidates clearing the gate. That lane
 *     is the project's original mission; it would never have appeared.
 *
 * Redistribution matters as much as the split: a lane with thin supply hands its
 * slice back rather than shrinking the run.
 */
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

/**
 * Which stage-A candidates get a README fetched.
 * The README fetch is free of API quota but not free of time, so the budget is
 * still finite; per-lane allocation is what stops one lane consuming it all.
 */
function allocateReadmeBudget(stageA, limit = R.FUNNEL.readmeFetchLimit) {
  if (!R.FUNNEL.readmeBudgetPerLane) {
    return [...stageA].sort((a, b) => b.total - a.total).slice(0, limit);
  }
  return allocateByLane(stageA, limit);
}

/** Does this scored candidate clear the gates for an LLM call? */
function passesLlmGate(scored) {
  return scored.eligible
    && scored.quality >= R.FUNNEL.minQualityForLlm
    && scored.total >= R.FUNNEL.minTotalForLlm;
}

// ---------------------------------------------------------------------------
// reconsideration / cooldown
// ---------------------------------------------------------------------------
// The rule the manual workflow never needed, and the one a REPEATING run
// cannot work without.
//
// Scores are near-stationary day to day: a repo scoring 118 today scores ~118
// tomorrow. So an unconstrained daily run picks the SAME top eight forever. It
// would spend the entire LLM budget re-judging yesterday's candidates and, once
// those are published or rejected, sit permanently on the next eight.
// schema.sql's dedup prevents re-INSERTING a repo; nothing yet prevented
// re-SPENDING quota on it.

/**
 * Classify a previously-seen repo so it can be given the right cooldown.
 * `row` is a repositories row (may be undefined for a first sighting).
 */
function outcomeOf(row) {
  if (!row) return 'new';
  if (row.published) return 'published';
  // A human decision outranks a model decision.
  if (row.human_rejected) return 'humanRejected';
  if (row.verdict === 'reject') return 'llmRejected';
  const reason = row.last_reject_reason ?? null;
  if (reason) {
    return R.REJECT_PERMANENCE[reason] === 'permanent' ? 'permanentReject' : 'softReject';
  }
  // nearMiss requires a score that is COMPARABLE to the threshold, which only a
  // README-bearing stage is. See COMPARABLE_SCORE_STAGES for the measurement:
  // stage-A scores run ~22 points low, so treating them as near-misses locks
  // out hundreds of repos for 30 days, 42% of which would have cleared the gate.
  if (row.last_total != null
      && R.COMPARABLE_SCORE_STAGES.includes(row.last_stage)
      && row.last_total < R.FUNNEL.minTotalForLlm) {
    return 'nearMiss';
  }
  if (row.evaluated_at) return 'notSelected';
  return 'notSelected';
}

/**
 * Should this repo be scored again in this run?
 * Returns { ok, outcome, cooldownDays, daysSince }.
 *
 * A null cooldown means never — used for outcomes that carry a permanent
 * decision (a human said no, the repo is a fork) rather than a temporary state.
 */
function shouldReconsider(row, now = Date.now()) {
  const outcome = outcomeOf(row);
  if (outcome === 'new') return { ok: true, outcome, cooldownDays: 0, daysSince: null };

  const cooldownDays = R.COOLDOWN[outcome];
  const stamp = Date.parse(row.last_checked ?? row.first_seen ?? '') || now;
  const daysSince = (now - stamp) / DAY;

  if (cooldownDays == null) return { ok: false, outcome, cooldownDays: null, daysSince };
  return { ok: daysSince >= cooldownDays, outcome, cooldownDays, daysSince };
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

/**
 * Pick the LLM candidate set: per-lane shares, with diversity caps applied
 * inside each share.
 *
 * The obvious implementation — allocate a per-lane pool, then walk it greedily
 * by total score — does NOT work, and this was measured. With a pool of 32 the
 * per-lane counts were correct (iran 10, ai 6, hidden 6, established 4,
 * trending 4, lists 2), but walking that pool by score filled all 16 slots from
 * the top: rows 1-10 iran, 11-18 lists and ai, 19-20 established. The first
 * trending row sat at rank 27, so trending received ZERO — the same starvation
 * the per-lane README budget was introduced to fix, merely moved one stage
 * later.
 *
 * Cross-lane totals are not comparable (see allocateByLane), so the WALK has to
 * be per-lane too, not just the allocation. Each lane fills its slots from its
 * own ranking; only genuinely unused slots are contested globally.
 *
 * Note on category: DIVERSITY.maxPerCategory is NOT applied here and cannot be.
 * A repo's category is assigned by the LLM, which has not run at this point, so
 * that cap is enforced afterwards by selectFinal(). The alternative would be
 * guessing a category from topics, which would then disagree with the one the
 * LLM writes into the post.
 */
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

  // Caps are sized for the FINAL post set. When asked for more than
  // finalSelectionSize (the normal case: 16 candidates for 8 posts) they must
  // scale up, or they bind far too early — with maxPerOwner=1 and a limit of 16,
  // a prolific owner's second repo would be dropped before the LLM ever saw it,
  // even if it were the better of the two.
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

  // --- pass 1: each lane fills its own share from its own ranking ---
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

  // --- pass 2: contest leftover slots globally ---
  // Rounding loss, plus any lane with less supply than its share. Best score
  // first is right here: these slots belong to no lane in particular.
  if (chosen.length < limit) {
    for (const s of [...gated].sort((a, b) => b.total - a.total)) {
      if (chosen.length >= limit) break;
      if (taken.has(s)) continue;
      const why = capBlocking(s);
      if (why) { skipped.push({ s, why }); continue; }
      accept(s);
    }
  }

  // --- pass 3: fill anything still empty, ignoring diversity caps ---
  // A short candidate set costs posts directly, and an eleventh Python tool is
  // worth more than an empty slot.
  if (chosen.length < limit) {
    for (const s of [...gated].sort((a, b) => b.total - a.total)) {
      if (chosen.length >= limit) break;
      if (taken.has(s)) continue;
      accept(s);
    }
  }

  return { chosen: chosen.sort((a, b) => b.total - a.total), skipped, laneCount };
}

/**
 * Post-LLM selection. Takes the judged candidates and returns the set that will
 * actually become posts.
 *
 * Exists because three of the decisions can only be made once the model has
 * spoken:
 *   - verdict: a `reject` never becomes a post, whatever it scored.
 *   - category: DIVERSITY.maxPerCategory needs the LLM's category. Without this
 *     step that rule was dead config — declared in rules.js, enforced nowhere,
 *     which is worse than not having it.
 *   - duplicate purpose: the model is asked whether a repo improves on an
 *     already-published one; if it answers no, the repo is dropped here.
 *
 * `judged` items are { scored, verdict, category, isDuplicatePurpose }.
 */
function selectFinal(judged, limit = R.FUNNEL.finalSelectionSize) {
  const rank = { strong: 0, maybe: 1 };
  const usable = judged
    .filter((j) => j.verdict === 'strong' || j.verdict === 'maybe')
    .filter((j) => !j.isDuplicatePurpose)
    // A `strong` always outranks a `maybe`, regardless of deterministic score:
    // the model saw the README and the deterministic score did not see novelty
    // at all. Score breaks ties within a verdict.
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

// ---------------------------------------------------------------------------
// self-check — throws at import time if rules.js is internally inconsistent
// ---------------------------------------------------------------------------

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

  // A prompt dump must not survive its own penalty. Measured worst case:
  // ai-boost/awesome-prompts scored total=107 before this detector existed.
  const maxPromptScore = R.PROMPT_DUMP_SIGNALS.namePoints
    + R.PROMPT_DUMP_SIGNALS.descPoints
    + R.PROMPT_DUMP_SIGNALS.noLanguagePoints;
  const maxPromptPenalty = R.PENALTIES.promptDumpPerPoint
    * (maxPromptScore - R.PROMPT_DUMP_SIGNALS.rejectAtScore + 1);
  if (maxPromptPenalty < R.FUNNEL.minTotalForLlm) {
    errs.push(`max prompt-dump penalty (${maxPromptPenalty}) must exceed minTotalForLlm (${R.FUNNEL.minTotalForLlm})`);
  }
  // no-language alone must never be enough to classify. This was the exact bug
  // in CONFIG_DUMP_SIGNALS: 131 of 187 flagged repos were flagged by that
  // signal and nothing else, most of them legitimate curated lists.
  if (R.PROMPT_DUMP_SIGNALS.noLanguagePoints >= R.PROMPT_DUMP_SIGNALS.rejectAtScore) {
    errs.push('PROMPT_DUMP_SIGNALS.noLanguagePoints alone reaches rejectAtScore');
  }
  if (R.CONFIG_DUMP_SIGNALS.noLanguagePoints >= R.CONFIG_DUMP_SIGNALS.rejectAtScore) {
    errs.push('CONFIG_DUMP_SIGNALS.noLanguagePoints alone reaches rejectAtScore');
  }

  // Every cooldown outcome must exist. A typo here would otherwise make
  // shouldReconsider() read undefined, which compares false against every
  // number and silently blocks a repo forever.
  for (const outcome of ['humanRejected', 'published', 'llmRejected', 'nearMiss',
    'notSelected', 'softReject', 'permanentReject']) {
    if (!(outcome in R.COOLDOWN)) errs.push(`COOLDOWN is missing "${outcome}"`);
  }
  for (const [reason, kind] of Object.entries(R.REJECT_PERMANENCE)) {
    if (kind !== 'permanent' && kind !== 'soft') {
      errs.push(`REJECT_PERMANENCE.${reason} must be "permanent" or "soft", got "${kind}"`);
    }
  }
  // Stage 'a' must never be treated as comparable to minTotalForLlm. Its scores
  // run ~22 points low by construction (no README), so allowing it here would
  // relabel hundreds of perfectly good candidates as nearMiss and lock them out
  // for COOLDOWN.nearMiss days. See COMPARABLE_SCORE_STAGES for the numbers.
  if (!Array.isArray(R.COMPARABLE_SCORE_STAGES) || !R.COMPARABLE_SCORE_STAGES.length) {
    errs.push('COMPARABLE_SCORE_STAGES must be a non-empty array');
  } else if (R.COMPARABLE_SCORE_STAGES.includes('a')) {
    errs.push('COMPARABLE_SCORE_STAGES must not include stage "a" — metadata-only scores are not comparable to minTotalForLlm');
  }
  // The candidate pool must be at least the size of the final post set, or the
  // run cannot fill the channel even when every candidate is approved.
  if (R.FUNNEL.llmCandidateLimit < R.FUNNEL.finalSelectionSize) {
    errs.push(`FUNNEL.llmCandidateLimit (${R.FUNNEL.llmCandidateLimit}) must be >= finalSelectionSize (${R.FUNNEL.finalSelectionSize})`);
  }
  if (R.FUNNEL.readmeFetchLimit < R.FUNNEL.llmCandidateLimit) {
    errs.push(`FUNNEL.readmeFetchLimit (${R.FUNNEL.readmeFetchLimit}) must be >= llmCandidateLimit (${R.FUNNEL.llmCandidateLimit})`);
  }
  // Diversity caps must be able to fill the post set. maxPerCategory=2 with 8
  // posts needs at least 4 categories to exist; the check is that the caps do
  // not make finalSelectionSize structurally unreachable.
  if (R.DIVERSITY.maxPerCategory * R.CATEGORIES.length < R.FUNNEL.finalSelectionSize) {
    errs.push('DIVERSITY.maxPerCategory * CATEGORIES.length is below finalSelectionSize — the run can never fill');
  }
  const quotaSum = Object.values(R.LANE_QUOTA).reduce((a, b) => a + b, 0);
  if (quotaSum < R.FUNNEL.finalSelectionSize) {
    errs.push(`LANE_QUOTA sums to ${quotaSum}, below finalSelectionSize (${R.FUNNEL.finalSelectionSize})`);
  }

  // Query-side consistency. A pool larger than maxTopicsPerQuery is allowed
  // (rotation covers the remainder), but a pool of zero is a mistake.
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

  // A maximum-confidence dump must be unrecoverable: its penalty has to
  // exceed the best possible quality + relevance + multi-lane total, or a
  // well-presented dump could still rank.
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

// ===== queries.js ==================================================
const Q = (function (R) {
// Pure GitHub — query builder
//
// Turns QUERY_CLASSES (declarative intent) into concrete GitHub search API
// query strings. Pure functions, no I/O, no Date.now() unless passed in —
// same contract as algorithm.js, so this file can also be pasted into an n8n
// Code node.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE IS THE MOST IMPORTANT PART OF THE FUNNEL
// ---------------------------------------------------------------------------
// Measured during calibration: the hard filters pass 87% of what the queries
// return. That is not a weak filter — it means the QUERY already did the
// selecting. Whatever these strings do not ask for, the system will never see,
// no matter how good the scoring is.
//
// Two API limits shape every decision here:
//   1. A query returns AT MOST 1000 results, and a run reads the first 100.
//   2. At most 5 boolean operators, at most 256 characters.
//
// Limit 1 is why rotation exists. A fixed query set reads the same 100 repos
// every day; after run one, every later run is wasted work. Rotation is what
// makes run 30 see different repos than run 1.


const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// date helpers
// ---------------------------------------------------------------------------

/** GitHub date qualifiers take YYYY-MM-DD. */
function ymd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Day index since ROTATION.epochUtc. This is the rotation seed.
 *
 * Deliberately the day number rather than a random value or a stored counter:
 * reproducible (a failed run replays identically), stateless (nothing to
 * persist), and monotonic (consecutive days never collide).
 */
function dayIndex(now = Date.now()) {
  const epoch = Date.parse(`${R.ROTATION.epochUtc}T00:00:00Z`);
  return Math.max(0, Math.floor((now - epoch) / DAY));
}

// ---------------------------------------------------------------------------
// qualifier assembly
// ---------------------------------------------------------------------------

/**
 * Count boolean operators. GitHub rejects a query with more than five, and an
 * N-topic OR chain costs N-1 of them, which is the easiest way to trip it.
 */
function countOperators(q) {
  return (q.match(/\b(?:AND|OR|NOT)\b/g) || []).length;
}

/** Rotate a pool by the seed, returning `take` items, wrapping around. */
function rotate(pool, seed, take, stride = 1) {
  if (!pool.length || take <= 0) return [];
  const n = Math.min(take, pool.length);
  const start = ((seed * stride) % pool.length + pool.length) % pool.length;
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[(start + i) % pool.length]);
  return out;
}

/**
 * `topic:a,b,c` — a UNION, and the only multi-topic form the API accepts.
 *
 * `topic:a OR topic:b` returns HTTP 422; see QUERY.topicSeparator for the
 * measurement. Capped by QUERY.maxTopicsPerQuery so one huge topic cannot
 * swamp the 100-result page.
 */
function topicClause(topics) {
  const capped = topics.slice(0, R.QUERY.maxTopicsPerQuery);
  return `topic:${capped.join(R.QUERY.topicSeparator)}`;
}

/**
 * Assemble the shared tail every class needs: star band, date bounds and the
 * free `archived:false` qualifier.
 *
 * `createdRange` takes a [fromDays, toDays] pair and emits GitHub's
 * `created:A..B` form — verified to work, and the only way to make two queries
 * cover DISJOINT creation windows rather than one being a subset of the other.
 */
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

/** Pick a sort from the class's list, rotating by seed. */
function pickSort(sorts, seed) {
  if (!sorts || !sorts.length) return { sort: 'updated', order: 'desc' };
  return sorts[seed % sorts.length];
}

// ---------------------------------------------------------------------------
// per-class builders
// ---------------------------------------------------------------------------
// Each returns an array of { label, lane, q, sort, order }.
// `lane` records which lane the query is TRYING to feed — used by the dry run
// to check whether a query class actually delivers what it is budgeted for.

function buildIran(count, seed, now) {
  const C = R.QUERY_CLASSES.iran;
  const out = [];
  const pools = C.topicPools;
  for (let i = 0; i < count; i++) {
    // Walk the pools in order so all four are covered when count is 4, and
    // start at a different pool each day so a count < 4 does not always skip
    // the same pool.
    const pool = pools[(seed + i) % pools.length];
    // Rotate WITHIN the pool too, so a pool of six topics with a cap of five
    // does not permanently exclude its last topic.
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
  // The trending budget is split into DISJOINT creation windows.
  //
  // The first attempt used `created:>60d` and `created:>20d`, which is wrong:
  // the second is a strict subset of the first. Measured — wide 1635 matches,
  // narrow 271, and 12 of the narrow query's top 100 were already returned by
  // the wide one. With `created:A..B` the windows cannot overlap at all.
  //
  // The split also serves a purpose: the fresh window (0-20 days) catches a
  // spike while it is still spiking; the older window (20-60 days) catches a
  // tool that kept climbing after the initial burst, which is the stronger
  // signal of the two.
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

/**
 * Split a `0..totalDays` window into `count` disjoint [fromDays, toDays] bands,
 * newest last. Geometric rather than linear: a 60-day window split evenly gives
 * two 30-day halves, but repo creation is not uniform — most of what is worth
 * catching is very recent, so the fresh band is kept narrow.
 */
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
    // Blocked stepping: `seed * count + i`, not `seed + i`.
    //
    // Measured bug: with `seed + i` and count=3, day N used steps N,N+1,N+2 and
    // day N+1 used N+1,N+2,N+3 — so two of the three hidden queries were
    // byte-identical to yesterday's, and this lane (the largest supply, 329 of
    // 778 eligible in calibration) spent two thirds of its budget re-reading the
    // same 200 repos. Blocking gives each run its own disjoint span of steps.
    const step = seed * count + i;
    const starRange = rotate(C.starShards, step, 1, R_.starShardStride)[0];
    const kind = kinds[step % kinds.length];
    // The shard index must be derived from how many times THIS KIND has come
    // up, not from `step` itself.
    //
    // Measured bug, found by rotationCoverage(): using `step` directly, a topic
    // shard is only ever chosen when `step % 2 === 1`, so the index was always
    // odd * topicStride. With an even pool size (54 topics) an odd multiplier
    // can only ever land on odd positions — 27 of 54 topics were unreachable
    // FOREVER, no matter how many runs. Dividing by the number of kinds gives
    // each kind its own dense counter, so a stride co-prime with the pool size
    // walks the entire pool.
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
    // Language-sharded for the same reason as hidden: an unsharded
    // `stars:>=1500 sort:updated` query returns the same globally-famous
    // repos on every run, which is the exact failure this file exists to fix.
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
    // iranScopedRatio: half of these queries are Iran-scoped, because an
    // Iran-relevant list is worth far more to this channel than a generic one.
    // With count=1 this alternates by day rather than rounding to zero.
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

// ---------------------------------------------------------------------------
// public entry point
// ---------------------------------------------------------------------------

/**
 * Build the query plan for one run.
 * Deterministic given (now): same day, same queries.
 */
function buildQueries(now = Date.now()) {
  const seed = dayIndex(now);
  const out = [];

  for (const [cls, count] of Object.entries(R.QUERY.allocation)) {
    const fn = BUILDERS[cls];
    if (!fn) throw new Error(`QUERY.allocation names unknown class "${cls}"`);
    out.push(...fn(count, seed, now));
  }

  // Normalise whitespace, then assert against the two API limits. Failing here
  // is far better than a silent HTTP 422 that drops a query mid-run.
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

/** Full search URL for a plan item. */
function searchUrl(item, perPage = R.QUERY.resultsPerQuery) {
  return 'https://api.github.com/search/repositories'
    + `?q=${encodeURIComponent(item.q)}`
    + `&sort=${item.sort}&order=${item.order}&per_page=${perPage}`;
}

/**
 * How much of each pool a given number of consecutive runs will visit.
 * Used by the verification script to prove rotation actually spreads out
 * instead of cycling a handful of shards.
 */
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


// ---------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------
const PUREGH = {
  rules: R,

  // queries
  buildQueries: Q.buildQueries,
  searchUrl: Q.searchUrl,
  dayIndex: Q.dayIndex,
  rotationCoverage: Q.rotationCoverage,

  // scoring
  normalize: A.normalize,
  scoreStageA: A.scoreStageA,
  scoreStageB: A.scoreStageB,
  passesLlmGate: A.passesLlmGate,

  // budget allocation — per-lane, not a global top-N. See allocateByLane.
  allocateByLane: A.allocateByLane,
  allocateReadmeBudget: A.allocateReadmeBudget,

  // classification, exposed for diagnostics and for the review form
  configDumpScore: A.configDumpScore,
  promptDumpScore: A.promptDumpScore,
  isCuratedList: A.isCuratedList,
  iranRelevance: A.iranRelevance,
  aiRelevance: A.aiRelevance,
  iranianCreator: A.iranianCreator,
  hardRejects: A.hardRejects,
  lanesFor: A.lanesFor,

  // cooldown
  outcomeOf: A.outcomeOf,
  shouldReconsider: A.shouldReconsider,

  // selection
  select: A.select,
  selectFinal: A.selectFinal,

  validateRules: A.validateRules,
};

// Fail loudly at paste time rather than mid-run: if rules.js is internally
// inconsistent, every score below is meaningless.
PUREGH.validateRules();
