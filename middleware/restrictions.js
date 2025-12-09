/**
 * Blocks unwanted media types (voice, video, stickers, GIFs, photos, documents, etc.)
 * Only allows plain text messages and commands to pass through
 */
const BLOCKED_TYPES = [
  "voice",
  "video_note",
  "sticker",
  "animation", // GIFs
  "photo",
  "video",
  "document",
];

/**
 * Middleware that deletes blocked message types and sends a warning
 * @param {Object} ctx - Telegraf context
 * @param {Function} next - Next middleware
 */
async function restrictMedia(ctx, next) {
  const message = ctx.message;

  if (message && BLOCKED_TYPES.some((type) => message[type])) {
    // Delete message
    ctx.deleteMessage().catch((err) => {
      console.warn("Could not delete restricted message:", err.message);
    });

    // User warning
    ctx.reply(
      "This bot only accepts text messages. Please avoid sending voice notes, videos, stickers, GIFs, or files.",
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  // Allow other messages
  return next();
}

module.exports = restrictMedia;
