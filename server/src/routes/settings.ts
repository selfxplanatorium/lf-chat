import { Router, Response } from 'express';
import db from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { checkWebhookUrlSyntax } from '../lib/urlGuard';

const router = Router();

const DEFAULT_WEBHOOK_ICON = 'Webhook';

function normalizeWebhooks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => ({
      ...entry,
      id: typeof entry.id === 'string' ? entry.id : '',
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : 'Webhook',
      url: typeof entry.url === 'string' ? entry.url : '',
      icon: typeof entry.icon === 'string' && entry.icon.trim() ? entry.icon : DEFAULT_WEBHOOK_ICON,
    }));
}

router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId!) as any;
  if (!settings) {
    res.json({
      webhooks: [],
      activeWebhookId: '',
      themeMode: 'dark',
      themePreset: 'default',
      themeAuto: false,
      sendWithCtrlEnter: true,
      confirmDeleteChat: true,
      confirmEditMessage: true,
      profileName: 'User',
      profileImage: '',
      hasSeenTour: false,
    });
    return;
  }

  res.json({
    webhooks: normalizeWebhooks(JSON.parse(settings.webhooks)),
    activeWebhookId: settings.active_webhook_id,
    themeMode: settings.theme_mode,
    themePreset: settings.theme_preset,
    themeAuto: !!settings.theme_auto,
    sendWithCtrlEnter: !!settings.send_with_ctrl_enter,
    confirmDeleteChat: !!settings.confirm_delete_chat,
    confirmEditMessage: !!settings.confirm_edit_message,
    profileName: settings.profile_name,
    profileImage: settings.profile_image,
    hasSeenTour: !!settings.has_seen_tour,
  });
});

router.put('/', authMiddleware, (req: AuthRequest, res: Response) => {
  const body = req.body || {};

  // Merge against the current row so a partial PUT only touches the fields it
  // sends. A full overwrite here would let any partial update silently wipe
  // unrelated settings (e.g. a `{ hasSeenTour: true }` call erasing webhooks).
  // Reject unsafe webhook URLs at write time (fast feedback). The runner does
  // the authoritative DNS-based SSRF check before it actually fetches.
  if (body.webhooks !== undefined) {
    if (!Array.isArray(body.webhooks)) {
      res.status(400).json({ error: 'webhooks must be an array' });
      return;
    }
    for (const w of body.webhooks) {
      // An empty URL is a backend the user has added but not configured yet —
      // a legitimate draft state, and the only state a freshly added webhook
      // can be in. Rejecting it here failed the entire settings write (theme,
      // profile, everything) until a URL was typed.
      if (!w?.url) continue;
      const err = checkWebhookUrlSyntax(w.url);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
    }
  }

  const existing = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId!) as any;
  const base = existing || {
    webhooks: '[]', active_webhook_id: '', theme_mode: 'dark', theme_preset: 'default',
    theme_auto: 0, send_with_ctrl_enter: 1, confirm_delete_chat: 1, confirm_edit_message: 1,
    profile_name: 'User', profile_image: '', has_seen_tour: 0,
  };

  const keep = <T>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value);
  const keepBool = (value: unknown, fallback: number): number => (value === undefined ? fallback : (value ? 1 : 0));

  const webhooksJson = body.webhooks === undefined ? base.webhooks : JSON.stringify(body.webhooks);
  const activeWebhookId = keep(body.activeWebhookId, base.active_webhook_id);
  const themeMode = keep(body.themeMode, base.theme_mode);
  const themePreset = keep(body.themePreset, base.theme_preset);
  const themeAuto = keepBool(body.themeAuto, base.theme_auto);
  const sendWithCtrlEnter = keepBool(body.sendWithCtrlEnter, base.send_with_ctrl_enter);
  const confirmDeleteChat = keepBool(body.confirmDeleteChat, base.confirm_delete_chat);
  const confirmEditMessage = keepBool(body.confirmEditMessage, base.confirm_edit_message);
  const profileName = keep(body.profileName, base.profile_name);
  const profileImage = keep(body.profileImage, base.profile_image);
  const hasSeenTour = keepBool(body.hasSeenTour, base.has_seen_tour);

  if (existing) {
    db.prepare(`
      UPDATE settings SET
        webhooks = ?, active_webhook_id = ?, theme_mode = ?, theme_preset = ?, theme_auto = ?,
        send_with_ctrl_enter = ?, confirm_delete_chat = ?, confirm_edit_message = ?,
        profile_name = ?, profile_image = ?, has_seen_tour = ?
      WHERE user_id = ?
    `).run(
      webhooksJson, activeWebhookId, themeMode, themePreset, themeAuto,
      sendWithCtrlEnter, confirmDeleteChat, confirmEditMessage,
      profileName, profileImage, hasSeenTour,
      req.userId!
    );
  } else {
    db.prepare(`
      INSERT INTO settings (user_id, webhooks, active_webhook_id, theme_mode, theme_preset, theme_auto,
        send_with_ctrl_enter, confirm_delete_chat, confirm_edit_message,
        profile_name, profile_image, has_seen_tour)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.userId!, webhooksJson, activeWebhookId, themeMode, themePreset, themeAuto,
      sendWithCtrlEnter, confirmDeleteChat, confirmEditMessage,
      profileName, profileImage, hasSeenTour
    );
  }

  res.json({ success: true });
});

export default router;
