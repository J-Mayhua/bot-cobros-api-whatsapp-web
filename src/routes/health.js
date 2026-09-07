// src/routes/health.js
// Rutas de salud, comprobantes y apagado del sistema.

const express = require('express');
const fs = require('fs');
const path = require('path');
const CONFIG = require('../config');
const whatsappService = require('../services/whatsappService');
const state = require('../storage/state');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    whatsapp: whatsappService.isReady(),
    vouchers: fs.readdirSync(CONFIG.VOUCHERS_DIR).length,
    timestamp: new Date().toISOString()
  });
});

router.get('/vouchers', (req, res) => {
  const vouchers = fs.readdirSync(CONFIG.VOUCHERS_DIR)
    .filter(f => f.endsWith('.jpg'))
    .map(f => ({ nombre: f, fecha: fs.statSync(path.join(CONFIG.VOUCHERS_DIR, f)).mtime }))
    .sort((a, b) => b.fecha - a.fecha);
  res.json({ total: vouchers.length, vouchers });
});

router.get('/shutdown', (req, res) => {
  res.json({ message: 'Apagando sistema...', status: 'OK' });
  setTimeout(async () => {
    state.guardarMensajesEnviados();
    state.guardarPagosProcesados();
    state.guardarCicloActual();
    if (whatsappService.getClient()) await whatsappService.getClient().destroy();
    process.exit(0);
  }, 2000);
});

module.exports = router;
