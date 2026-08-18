const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/csrf');
const { deleteRulePresetStmt } = require('../partyState');

const router = express.Router();

const avatarsDir = path.join(db.dataDir, 'avatars');
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: avatarsDir,
  filename: (req, file, cb) => {
    const ext = ALLOWED_TYPES[file.mimetype] || '.jpg';
    cb(null, `${req.session.user.id}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, file.mimetype)) {
      return cb(new Error('INVALID_TYPE'));
    }
    cb(null, true);
  },
});

function handleUpload(req, res, next) {
  upload.single('avatar')(req, res, (err) => {
    if (err) {
      req.session.avatarError = err.code === 'LIMIT_FILE_SIZE'
        ? 'Bild ist zu groß (max. 3 MB).'
        : 'Ungültiges Bild (nur JPG, PNG, WEBP oder GIF erlaubt).';
      return res.redirect(`/stats/${req.session.user.username}`);
    }
    next();
  });
}

const getAvatarStmt = db.prepare('SELECT avatar_filename FROM users WHERE id = ?');
const setAvatarStmt = db.prepare('UPDATE users SET avatar_filename = ? WHERE id = ?');

router.post('/account/avatar', requireAuth, handleUpload, csrfProtect, (req, res) => {
  const username = req.session.user.username;

  if (!req.file) {
    req.session.avatarError = 'Bitte ein Bild auswählen.';
    return res.redirect(`/stats/${username}`);
  }

  const previous = getAvatarStmt.get(req.session.user.id);
  setAvatarStmt.run(req.file.filename, req.session.user.id);

  if (previous && previous.avatar_filename) {
    fs.unlink(path.join(avatarsDir, previous.avatar_filename), () => {});
  }

  res.redirect(`/stats/${username}`);
});

router.post('/account/presets/:id/delete', requireAuth, csrfProtect, (req, res) => {
  const id = parseInt(req.params.id, 10);
  deleteRulePresetStmt.run(id, req.session.user.id);
  res.redirect(`/stats/${req.session.user.username}`);
});

const getUserForDeleteStmt = db.prepare('SELECT avatar_filename FROM users WHERE id = ?');
const deleteRulePresetsForUserStmt = db.prepare('DELETE FROM rule_presets WHERE user_id = ?');
const anonymizeUserStmt = db.prepare(`
  UPDATE users
  SET username = ?, password_hash = ?, avatar_filename = NULL, is_active = 0, is_deleted = 1
  WHERE id = ?
`);
const adminCountStmt = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1');

// Deletes the requesting user's own account. Rather than a hard DELETE
// (which would either violate FK constraints on shared match/party history
// or, if cascaded, erase other players' legitimate game records), this
// anonymizes the account: personal data (name, avatar, password) is wiped,
// but the account row survives under an untraceable label so teammates'/
// opponents' stats stay intact - matches the balancing allowed by GDPR
// Art. 17(3)(c).
router.post('/account/delete', requireAuth, csrfProtect, async (req, res) => {
  if (req.session.user.isManagement) return res.redirect('/admin');

  if (req.session.user.isAdmin && adminCountStmt.get().c <= 1) {
    req.session.deleteAccountError = 'Du bist der einzige Admin. Mach zuerst jemand anderen zum Admin (Admin-Dashboard), bevor du deinen Account löschst.';
    return res.redirect(`/stats/${req.session.user.username}`);
  }

  const userId = req.session.user.id;
  const user = getUserForDeleteStmt.get(userId);
  if (!user) return req.session.destroy(() => res.redirect('/login'));

  const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const anonymizedUsername = `Gelöschter_Nutzer_${userId}`;

  db.transaction(() => {
    deleteRulePresetsForUserStmt.run(userId);
    anonymizeUserStmt.run(anonymizedUsername, randomPasswordHash, userId);
  })();

  if (user.avatar_filename) {
    fs.unlink(path.join(avatarsDir, user.avatar_filename), () => {});
  }

  req.session.destroy(() => res.redirect('/login?deleted=1'));
});

module.exports = { router, avatarsDir };
