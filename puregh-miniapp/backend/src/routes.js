import { Router } from 'express';
import { query } from './db.js';
import config from './config.js';
import { answerCallback, editReviewMessage, sendToChannel } from './telegram.js';
import { getRepoMetadata, getReadmeRaw } from './github.js';
import { generateCaption } from './llm.js';
import { assembleCaption } from './caption.js';

const router = Router();

// Telegram callback query id: the Mini App sends `query_id`; keep accepting
// the old `queryId` shape too. best-effort ack only.
const qid = (body) => body?.query_id ?? body?.queryId ?? null;

// Helper: load a draft post joined with its repo. Only drafts are reviewable.
async function loadDraft(id) {
  const r = await query(
    `SELECT p.id, p.caption, p.publish_at, p.bot_chat_id, p.bot_message_id,
            p.status, r.id AS repository_id, r.full_name, r.owner, r.name
       FROM posts p JOIN repositories r ON r.id = p.repository_id
      WHERE p.id = $1::bigint AND p.status = 'draft'`,
    [id],
  );
  return r.rows[0] ?? null;
}

// Load a post in any of the given statuses, joined with its repo, including
// the model's verdict so the UI can show it on both lists.
async function loadPost(id, statuses) {
  const r = await query(
    `SELECT p.id, p.caption, p.publish_at, p.bot_chat_id, p.bot_message_id,
            p.status, p.model, p.attempt,
            r.id AS repository_id, r.full_name, r.owner, r.name,
            r.verdict, r.verdict_reason
       FROM posts p JOIN repositories r ON r.id = p.repository_id
      WHERE p.id = $1::bigint AND p.status = ANY($2::text[])`,
    [id, statuses],
  );
  return r.rows[0] ?? null;
}

const faDateTime = (d) => new Date(d).toLocaleString('fa-IR', {
  timeZone: 'Asia/Tehran', weekday: 'long', year: 'numeric',
  month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

// Next free publishing slot (final list): last slot of approved/published + 2h,
// never sooner than now+2h, never before tomorrow 09:00 Tehran.
async function nextPublishSlot() {
  const r = await query(
    `SELECT MAX(publish_at) AS last
       FROM posts
      WHERE status IN ('approved', 'published')
        AND publish_at IS NOT NULL`,
  );
  const lastUtc = r.rows[0].last ? new Date(r.rows[0].last).getTime() : 0;
  const teheran = 3.5 * 3600e3; // UTC+3:30, no DST
  const now = Date.now();
  const wall = new Date(now + teheran);
  const tom9Wall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1, 9, 0, 0);
  const min = Math.max(lastUtc ? lastUtc + 2 * 3600e3 : 0, now + 2 * 3600e3, tom9Wall - teheran);
  return new Date(min).toISOString();
}

function reviewText(caption, publishAt) {
  const fa = (d) => new Date(d).toLocaleString('fa-IR', {
    timeZone: 'Asia/Tehran', weekday: 'long', year: 'numeric',
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const timeLine = publishAt
    ? `🕒 زمان انتشار: ${fa(publishAt)}\n⚠️ اگر هیچی لمس نکنی، همین کپشن در همین زمان منتشر می‌شود.`
    : '🕓 این پست هنوز زمان انتشار ندارد.';
  return caption + String.fromCharCode(10) + String.fromCharCode(10) + timeLine;
}

// ---- waiting list ---------------------------------------------------------
router.get('/posts', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT p.id, r.full_name, p.caption, p.status, p.publish_at, p.model, p.attempt,
              r.verdict, r.verdict_reason
         FROM posts p JOIN repositories r ON r.id = p.repository_id
        WHERE p.status = 'draft'
        ORDER BY p.publish_at ASC NULLS LAST, p.id DESC`,
    );
    res.json({ posts: r.rows });
  } catch (e) { next(e); }
});

// ---- final list (approved posts, waiting for their slot / send-now) ---------
router.get('/posts/final', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT p.id, r.full_name, p.caption, p.status, p.publish_at, p.model, p.attempt,
              r.verdict, r.verdict_reason
         FROM posts p JOIN repositories r ON r.id = p.repository_id
        WHERE p.status = 'approved'
        ORDER BY p.publish_at ASC NULLS LAST, p.id DESC`,
    );
    res.json({ posts: r.rows });
  } catch (e) { next(e); }
});

// ---- single post ----------------------------------------------------------
router.get('/posts/:id', async (req, res, next) => {
  try {
    const post = await loadPost(req.params.id, ['draft', 'approved']);
    if (!post) return res.status(404).json({ error: 'not_found' });
    res.json({ post });
  } catch (e) { next(e); }
});

// ---- approve (moves the post to the final list with a publishing slot) -----
router.post('/posts/:id/approve', async (req, res, next) => {
  try {
    const post = await loadPost(req.params.id, ['draft']);
    if (!post) return res.status(404).json({ error: 'not_found' });
    // Keep a user-chosen time if already set; otherwise assign the next slot.
    const slotAt = post.publish_at || (await nextPublishSlot());
    await query(
      `UPDATE posts SET status = 'approved', publish_at = $1
        WHERE id = $2::bigint AND status = 'draft'`,
      [slotAt, req.params.id],
    );
    await answerCallback(qid(req.body), 'تایید شد ✅ به لیست نهایی اضافه شد.');
    if (post.bot_chat_id && post.bot_message_id) {
      await editReviewMessage(
        post.bot_chat_id, post.bot_message_id,
        `✅ <b>تایید شد</b> — این پست برای انتشار تأیید شد.\n🕒 اسلات انتشار: ${faDateTime(slotAt)}`,
        req.params.id,
      );
    }
    res.json({ ok: true, status: 'approved', publish_at: slotAt });
  } catch (e) { next(e); }
});

// ---- send-now (publish an approved post immediately) ------------------------
// Atomic like the n8n Publisher claim: approved -> publishing in one UPDATE;
// a second tap or a concurrent Publisher tick can never double-send. The
// whole flow runs in one transaction, so a Telegram failure rolls back to
// 'approved' (with its original slot) and stays retryable.
router.post('/posts/:id/send-now', async (req, res, next) => {
  try {
    const post = await loadPost(req.params.id, ['approved']);
    if (!post) return res.status(404).json({ error: 'not_found' });

    await query('BEGIN');
    try {
      const claim = await query(
        `UPDATE posts SET status = 'publishing', publish_at = now()
          WHERE id = $1::bigint AND status = 'approved' RETURNING id`,
        [req.params.id],
      );
      if (claim.rowCount === 0) {
        await query('ROLLBACK');
        return res.status(409).json({ error: 'already_sending' });
      }
      const sent = await sendToChannel(post.caption);
      if (!sent || !sent.message_id) throw new Error('telegram send returned no message_id');
      await query(
        `UPDATE posts SET status = 'published', published_at = now(),
                telegram_chat_id = $1, telegram_message_id = $2
          WHERE id = $3::bigint AND status = 'publishing'`,
        [config.channelChat, String(sent.message_id), req.params.id],
      );
      await query('COMMIT');
      await answerCallback(qid(req.body), 'منتشر شد ✅');
      res.json({ ok: true, message_id: sent.message_id });
    } catch (e) {
      await query('ROLLBACK');
      throw e;
    }
  } catch (e) { next(e); }
});

// ---- reject (post removed from list; DB trigger locks the repo forever) ----
router.post('/posts/:id/reject', async (req, res, next) => {
  try {
    const post = await loadDraft(req.params.id);
    if (!post) return res.status(404).json({ error: 'not_found' });
    await query(
      `UPDATE posts SET status = 'rejected', reject_reason = 'mini-app-reject', decided_at = now()
        WHERE id = $1::bigint AND status = 'draft'`,
      [req.params.id],
    );
    await answerCallback(qid(req.body), 'رد شد ❌ پست از لیست انتظار حذف شد.');
    if (post.bot_chat_id && post.bot_message_id) {
      await editReviewMessage(post.bot_chat_id, post.bot_message_id, '❌ <b>رد شد</b> — این پست از لیست انتظار حذف شد.', req.params.id);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- delete from list (remove draft/approved row; repo untouched) -----------
router.post('/posts/:id/delete', async (req, res, next) => {
  try {
    const post = await loadPost(req.params.id, ['draft', 'approved']);
    if (!post) return res.status(404).json({ error: 'not_found' });
    await query(
      `DELETE FROM posts WHERE id = $1::bigint AND status IN ('draft', 'approved')`,
      [req.params.id],
    );
    const text = '🗑 <b>حذف از لیست</b> — این پست حذف شد (ریپو دستنخورده ماند و در کشفهای بعدی میتواند دوباره بیاید).';
    await answerCallback(qid(req.body), '🗑 از لیست حذف شد.');
    if (post.bot_chat_id && post.bot_message_id) {
      await editReviewMessage(post.bot_chat_id, post.bot_message_id, text, req.params.id);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- regenerate caption (LLM) ----------------------------------------------
router.post('/posts/:id/regen', async (req, res, next) => {
  try {
    const post = await loadPost(req.params.id, ['draft', 'approved']);
    if (!post) return res.status(404).json({ error: 'not_found' });

    // Rebuild facts from the stored repo row (matching Build Regen Facts).
    const repo = await query(
      `SELECT github_id, full_name, owner, description, homepage, stars, forks,
              open_issues, language, topics, license_spdx, default_branch, gh_created_at, gh_pushed_at
         FROM repositories WHERE id = $1::bigint`,
      [post.repository_id],
    );
    const r = repo.rows[0];
    const readmeRaw = await getReadmeRaw(r.full_name, r.default_branch ?? 'main');

    const NL = String.fromCharCode(10);
    const now = Date.now();
    const created = new Date(r.gh_created_at ?? now).getTime();
    const pushed = new Date(r.gh_pushed_at ?? now).getTime();
    const ageDays = Math.max(1, (now - created) / 86400000);
    const stars = Number(r.stars ?? 0);
    const cleaned = readmeRaw
      .replace(/<[^>]*>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();

    const factsText = [
      'repository=' + r.full_name,
      'description=' + (r.description ?? '-'),
      'homepage=' + (r.homepage || '-'),
      'topics=' + (Array.isArray(r.topics) ? r.topics.join(', ') : '-'),
      'language=' + (r.language ?? 'unknown'),
      'stars=' + stars,
      'forks=' + (r.forks ?? 0),
      'open_issues=' + (r.open_issues ?? 0),
      'age_days=' + Math.round(ageDays),
      'days_since_last_push=' + Math.max(0, Math.round((now - pushed) / 86400000)),
      'star_velocity_per_day=' + (stars / ageDays).toFixed(2),
      'has_demo=' + /\\.(gif|mp4|webm)|asciinema|youtube\\.com|youtu\\.be|demo|screenshot|preview/i.test(readmeRaw),
      'license=' + (r.license_spdx ?? 'none'),
      '',
      'README (truncated):',
      cleaned.slice(0, 3000),
    ].join(NL);

    const llm = await generateCaption(factsText);
    const assembled = assembleCaption(llm, {
      full_name: r.full_name,
      owner: r.owner,
    });

    await query(
      `UPDATE posts SET caption = $1, attempt = attempt + 1
        WHERE id = $2::bigint AND status IN ('draft', 'approved')`,
      [assembled.caption, req.params.id],
    );

    // Refresh the bot review message with the new caption + fresh open-app button.
    if (post.bot_chat_id && post.bot_message_id) {
      await editReviewMessage(post.bot_chat_id, post.bot_message_id, reviewText(assembled.caption, post.publish_at), req.params.id);
    }

    res.json({ ok: true, caption: assembled.caption });
  } catch (e) { next(e); }
});

// ---- manual caption ----------------------------------------------------------
router.post('/posts/:id/caption', async (req, res, next) => {
  try {
    const post = await loadPost(req.params.id, ['draft', 'approved']);
    if (!post) return res.status(404).json({ error: 'not_found' });
    const caption = String(req.body.caption ?? '').trim();
    if (!caption) return res.status(400).json({ error: 'empty_caption' });

    await query(
      `UPDATE posts SET caption = $1 WHERE id = $2::bigint AND status IN ('draft', 'approved')`,
      [caption, req.params.id],
    );
    if (post.bot_chat_id && post.bot_message_id) {
      await editReviewMessage(post.bot_chat_id, post.bot_message_id, reviewText(caption, post.publish_at), req.params.id);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- schedule (calendar date+time from the mini app) -------------------------
router.post('/posts/:id/schedule', async (req, res, next) => {
  try {
    const post = await loadPost(req.params.id, ['draft', 'approved']);
    if (!post) return res.status(404).json({ error: 'not_found' });
    const at = new Date(req.body.publish_at);
    if (Number.isNaN(at.getTime())) return res.status(400).json({ error: 'bad_date' });

    await query(
      `UPDATE posts SET publish_at = $1 WHERE id = $2::bigint AND status IN ('draft', 'approved')`,
      [at.toISOString(), req.params.id],
    );
    if (post.bot_chat_id && post.bot_message_id) {
      await editReviewMessage(post.bot_chat_id, post.bot_message_id, reviewText(post.caption, at), req.params.id);
    }
    res.json({ ok: true, publish_at: at.toISOString() });
  } catch (e) { next(e); }
});

// ---- add a repo (gen via LLM, or manual caption) ------------------------------
async function addRepoCommon({ fullName, caption, verdict, reason, category, audience }) {
  const meta = await getRepoMetadata(fullName);
  const repoJson = JSON.stringify({
    github_id: meta.id,
    full_name: meta.full_name,
    owner: meta.owner?.login ?? '',
    name: meta.name ?? '',
    url: meta.html_url ?? '',
    description: meta.description ?? null,
    homepage: meta.homepage ?? null,
    stars: meta.stargazers_count ?? 0,
    forks: meta.forks_count ?? 0,
    open_issues: meta.open_issues_count ?? 0,
    language: meta.language ?? null,
    topics: meta.topics ?? [],
    license_spdx: meta.license?.spdx_id ?? null,
    license_name: meta.license?.name ?? null,
    is_fork: meta.fork ?? false,
    is_archived: meta.archived ?? false,
    is_template: meta.is_template ?? false,
    default_branch: meta.default_branch ?? null,
    created_at: meta.created_at ?? null,
    pushed_at: meta.pushed_at ?? null,
  });

  const txn = await query('BEGIN');
  try {
    const ups = await query(
      `INSERT INTO repositories (
         github_id, full_name, owner, name, url, description, homepage,
         stars, forks, open_issues, language, topics, license_spdx, license_name,
         is_fork, is_archived, is_template, default_branch, gh_created_at, gh_pushed_at, source
       ) SELECT
         (r->>'github_id')::bigint, r->>'full_name', r->>'owner', r->>'name', r->>'url',
         r->>'description', r->>'homepage',
         (r->>'stars')::int, (r->>'forks')::int, (r->>'open_issues')::int,
         r->>'language', to_jsonb(r->'topics'), r->>'license_spdx', r->>'license_name',
         (r->>'is_fork')::boolean, (r->>'is_archived')::boolean, (r->>'is_template')::boolean,
         r->>'default_branch', (r->>'created_at')::timestamptz, (r->>'pushed_at')::timestamptz, 'submission'
       FROM jsonb_array_elements($1::jsonb) AS r
       ON CONFLICT (github_id) DO UPDATE SET
         full_name = EXCLUDED.full_name, description = EXCLUDED.description,
         stars = EXCLUDED.stars, forks = EXCLUDED.forks,
         open_issues = EXCLUDED.open_issues, language = EXCLUDED.language,
         topics = EXCLUDED.topics, license_spdx = EXCLUDED.license_spdx,
         license_name = EXCLUDED.license_name, is_archived = EXCLUDED.is_archived,
         gh_pushed_at = EXCLUDED.gh_pushed_at, last_checked = now()
       RETURNING id`,
      [JSON.stringify([JSON.parse(repoJson)])],
    );
    const repoId = ups.rows[0].id;

    const p = await query(
      `WITH ev AS (
         UPDATE repositories SET verdict = $3, verdict_reason = $4, category = $5, audience = $6::jsonb,
                evaluated_at = now()
          WHERE id = $1::bigint RETURNING id
       )
       INSERT INTO posts (repository_id, caption, status)
       SELECT $1::bigint, $2, 'draft'
       WHERE EXISTS (SELECT 1 FROM ev)
       RETURNING id`,
      [repoId, caption, verdict ?? null, reason ?? null, category ?? null, JSON.stringify(audience ?? [])],
    );
    const postId = p.rows[0].id;
    await query('COMMIT');
    return { postId, repoId };
  } catch (e) {
    await query('ROLLBACK');
    throw e;
  }
}

router.post('/add/gen', async (req, res, next) => {
  try {
    const fullName = String(req.body.full_name ?? '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return res.status(400).json({ error: 'bad_full_name' });

    const meta = await getRepoMetadata(fullName);
    const readmeRaw = await getReadmeRaw(fullName, meta.default_branch ?? 'main');

    // Build facts (same as Build Add Facts) then LLM caption.
    const NL = String.fromCharCode(10);
    const now = Date.now();
    const created = new Date(meta.created_at ?? now).getTime();
    const pushed = new Date(meta.pushed_at ?? now).getTime();
    const ageDays = Math.max(1, (now - created) / 86400000);
    const stars = Number(meta.stargazers_count ?? 0);
    const cleaned = readmeRaw
      .replace(/<[^>]*>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
    const factsText = [
      'repository=' + meta.full_name,
      'description=' + (meta.description ?? '-'),
      'homepage=' + (meta.homepage || '-'),
      'topics=' + (Array.isArray(meta.topics) ? meta.topics.join(', ') : '-'),
      'language=' + (meta.language ?? 'unknown'),
      'stars=' + stars,
      'forks=' + (meta.forks_count ?? 0),
      'open_issues=' + (meta.open_issues_count ?? 0),
      'age_days=' + Math.round(ageDays),
      'days_since_last_push=' + Math.max(0, Math.round((now - pushed) / 86400000)),
      'star_velocity_per_day=' + (stars / ageDays).toFixed(2),
      'has_demo=' + /\\.(gif|mp4|webm)|asciinema|youtube\\.com|youtu\\.be|demo|screenshot|preview/i.test(readmeRaw),
      'license=' + (meta.license?.spdx_id ?? 'none'),
      '', 'README (truncated):', cleaned.slice(0, 3000),
    ].join(NL);

    const llm = await generateCaption(factsText);
    const asm = assembleCaption(llm, { full_name: meta.full_name, owner: meta.owner?.login });

    const { postId } = await addRepoCommon({ fullName, ...asm });
    res.json({ ok: true, post_id: postId, caption: asm.caption });
  } catch (e) { next(e); }
});

router.post('/add/manual', async (req, res, next) => {
  try {
    const fullName = String(req.body.full_name ?? '').trim();
    const caption = String(req.body.caption ?? '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return res.status(400).json({ error: 'bad_full_name' });
    if (!caption) return res.status(400).json({ error: 'empty_caption' });

    const { postId } = await addRepoCommon({ fullName, caption });
    res.json({ ok: true, post_id: postId });
  } catch (e) { next(e); }
});

// central error handler
router.use((err, _req, res, _next) => {
  console.error('[route]', err.message);
  res.status(500).json({ error: err.message });
});

export default router;