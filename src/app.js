// src/app.js
// Crea la aplicacion Express y monta las rutas administrativas.

const express = require('express');

function crearApp() {
  const app = express();
  app.use(require('./routes/health'));
  app.use(require('./routes/ciclo'));
  app.use(require('./routes/cola'));
  return app;
}

module.exports = crearApp;
