const express = require('express');

const router = express.Router();

router.get('/impressum', (req, res) => {
  res.render('legal/impressum', { title: 'Impressum' });
});

router.get('/datenschutz', (req, res) => {
  res.render('legal/datenschutz', { title: 'Datenschutzerklärung' });
});

router.get('/agb', (req, res) => {
  res.render('legal/agb', { title: 'Nutzungsbedingungen' });
});

module.exports = router;
