// Pure GitHub — Publisher (phase 8: scheduled channel publishing)
//
// Every 10 minutes: atomically claim due waiting-list posts (status 'draft',
// publish_at <= now()), send their captions to the channel, then mark them
// published with the channel message id. A post left stuck in 'publishing'
// for more than 30 minutes becomes reclaimable, so a crashed run heals on
// the next tick instead of hanging forever.
//
// Nodes in n8n (id=1tVlx8NwE7Qe4WWa) are the source of truth for execution;
// this file mirrors them for review and rebuilds.

import { workflow, trigger, node, expr } from '@n8n/workflow-sdk';

const CHANNEL_CHAT_ID = '-1004481247137';

const everyTenMinutes = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Every 10 Minutes',
    parameters: {
      rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] },
    },
  },
  output: [{ json: {} }],
});

// Atomic claim: rows move to 'publishing' inside the same statement that
// selects them, with FOR UPDATE SKIP LOCKED so two concurrent runs can never
// claim (and thus send) the same post. The OR branch implements the
// 30-minute stuck-post reclaim (option A, approved by the user).
const claimBatch = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Claim Batch',
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
    parameters: {
      operation: 'executeQuery',
      query: [
        'WITH claimed AS (',
        '  UPDATE posts',
        "     SET status = 'publishing'",
        '   WHERE id IN (',
        '     SELECT id FROM posts',
        "      WHERE (status = 'draft' AND publish_at <= now())",
        "         OR (status = 'publishing' AND publish_at <= now() - interval '30 minutes')",
        '      ORDER BY publish_at ASC',
        '      LIMIT 4',
        '        FOR UPDATE SKIP LOCKED',
        '   )',
        '   RETURNING id, caption, repository_id, publish_at',
        ')',
        'SELECT c.id, c.caption, c.publish_at, r.full_name, r.url',
        '  FROM claimed c',
        '  JOIN repositories r ON r.id = c.repository_id',
      ].join('\n'),
      options: { queryBatching: 'transaction' },
    },
  },
  output: [
    {
      json: {
        id: 3,
        caption: '🧪 caption…',
        publish_at: '2026-09-09T18:50:16.631Z',
        full_name: 'test/publisher-check',
        url: 'https://github.com/test/publisher-check',
      },
    },
  ],
});

const sendToChannel = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send to Channel',
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: CHANNEL_CHAT_ID,
      text: expr('{{ $json.caption }}'),
      additionalFields: { appendAttribution: false, parse_mode: 'HTML' },
    },
  },
  output: [
    {
      json: {
        ok: true,
        result: { message_id: 12, chat: { id: -1004481247137 } },
      },
    },
  ],
});

// queryReplacement must evaluate to an ARRAY here, not a comma-separated
// string: the node splits strings on commas before binding, which mangles
// multi-parameter queries ("there is no parameter $2" — see execution 121).
// The post id is read from the Claim Batch paired item because the Telegram
// response {ok, result} has no id field (same lesson as section 4).
const markPublished = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Mark Published',
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
    parameters: {
      operation: 'executeQuery',
      query: [
        'UPDATE posts',
        "   SET status = 'published',",
        '       published_at = now(),',
        `       telegram_chat_id = '${CHANNEL_CHAT_ID}',`,
        '       telegram_message_id = $1::bigint',
        ' WHERE id = $2::bigint',
        ' RETURNING id, status',
      ].join('\n'),
      options: {
        queryReplacement: expr(
          "{{ [ String($json.result.message_id), String($('Claim Batch').item.json.id) ] }}",
        ),
      },
    },
  },
  output: [{ json: { id: 3, status: 'published' } }],
});

export default workflow('puregh-publisher', 'Pure GitHub — Publisher')
  .add(everyTenMinutes)
  .to(claimBatch)
  .to(sendToChannel)
  .to(markPublished);
