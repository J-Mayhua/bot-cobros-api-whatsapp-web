// src/routes/ciclo.js
// Rutas para consultar y reiniciar el ciclo de recordatorios.

const express = require('express');
const CONFIG = require('../config');
const state = require('../storage/state');

const router = express.Router();

router.get('/ciclo', (req, res) => {
  const cicloActual = state.getCicloActual();
  const cola = state.getColaRecordatorios();
  const diasDesdeInicio = cicloActual.inicioCiclo
    ? (new Date() - new Date(cicloActual.inicioCiclo)) / (1000 * 60 * 60 * 24)
    : 0;
  const diasRestantes = CONFIG.DIAS_ENTRE_RECORDATORIOS - diasDesdeInicio;
  res.json({
    cicloActual: {
      inicioCiclo: cicloActual.inicioCiclo,
      diasTranscurridos: diasDesdeInicio.toFixed(2),
      diasRestantes: Math.max(0, diasRestantes).toFixed(2),
      clientesEnviados: cicloActual.clientesEnviados.length,
      totalClientes: cola.clientes.length,
      porcentajeCompletado: cola.clientes.length > 0
        ? ((cicloActual.clientesEnviados.length / cola.clientes.length) * 100).toFixed(1)
        : 0,
      cicloCompletado: cicloActual.cicloCompletado,
      proximoReinicio: cicloActual.inicioCiclo
        ? new Date(new Date(cicloActual.inicioCiclo).getTime() + CONFIG.DIAS_ENTRE_RECORDATORIOS * 86400000).toISOString()
        : null
    }
  });
});

router.get('/reiniciar-ciclo', (req, res) => {
  const ciclo = state.getCicloActual();
  const nuevoCiclo = { inicioCiclo: new Date().toISOString(), clientesEnviados: [], cicloCompletado: false };
  state.setCicloActual(nuevoCiclo);
  state.guardarCicloActual();
  res.json({ message: 'Ciclo reiniciado manualmente', nuevoCiclo });
});

module.exports = router;
