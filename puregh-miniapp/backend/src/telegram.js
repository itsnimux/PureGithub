import config from './config.js';

const API = () => `https://api.telegram.org/bot${config.botToken}`;

async function call(method, params = {}) {
  const res = await fetch(`${API()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description || res.status}`);
  return json.result;
}

// Answer an inline-button callback so Telegram stops the spinner.
// Best-effort: in Model B the review actions live in the Mini App, so the
// query_id may be stale or absent; the DB action must not fail because of it.
export async function answerCallback(queryId, text) {
  if (!queryId) return null;
  try {
    return await call('answerCallbackQuery', { callback_query_id: queryId, text });
  } catch (e) {
    console.warn('[telegram] answerCallback skipped:', e.message);
    return null;
  }
}

// The review message now carries an "open in Mini App" button (a web_app URL),
// replacing the ok/rej/regen/manual inline callbacks. The browser takes over.
export function reviewKeyboard(postId) {
  return {
    inline_keyboard: [[{
      text: '📋 باز کردن پنل بازبینی',
      web_app: { url: `${config.miniAppUrl}/post/${postId}` },
    }]],
  };
}

export async function editReviewMessage(chatId, messageId, text, postId) {
  try {
    return await call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: reviewKeyboard(postId),
    });
  } catch (e) {
    // Best-effort: the DB action already succeeded. A rejected cosmetic edit
    // (e.g. non-HTTPS web_app URL during local dev) must not fail the request.
    console.warn('[telegram] editReviewMessage skipped:', e.message);
    return null;
  }
}

export async function sendOwnerMessage(text, keyboard) {
  const params = {
    chat_id: config.ownerChat,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (keyboard) params.reply_markup = keyboard;
  return call('sendMessage', params);
}

export { call };