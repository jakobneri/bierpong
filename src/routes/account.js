const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/csrf');

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

module.exports = { router, avatarsDir };
