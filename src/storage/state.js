// src/storage/state.js
// Estado encapsulado de tracking, ciclo y cola de recordatorios.

const path = require('path');
const { leer, escribir } = require('./jsonStore');
const CONFIG = require('../config');

let mensajesEnviados = {};
let pagosProcesados = {};
let cicloActual = {
  inicioCiclo: null,
  clientesEnviados: [],
  cicloCompletado: false,
  ultimaActualizacionCola: null
};
let colaRecordatorios = { clientes: [], ultimaActualizacion: null };

function cargarEstado() {
  Object.assign(mensajesEnviados, leer(CONFIG.MENSAJES_ENVIADOS_FILE, {}));
  Object.assign(pagosProcesados, leer(CONFIG.PAGOS_PROCESADOS_FILE, {}));
  Object.assign(cicloActual, leer(CONFIG.CICLO_FILE, cicloActual));
  Object.assign(colaRecordatorios, leer(CONFIG.COLA_RECORDATORIOS_FILE, colaRecordatorios));
  if (cicloActual.inicioCiclo) {
    const dias = (new Date() - new Date(cicloActual.inicioCiclo)) / 86400000;
    if (dias >= CONFIG.DIAS_ENTRE_RECORDATORIOS) {
      setCicloActual({ inicioCiclo: new Date().toISOString(), clientesEnviados: [], cicloCompletado: false });
      guardarCicloActual();
      console.log('🔄 Ciclo expirado - Reiniciando');
    }
  }
  limpiarMensajesAntiguos();
  console.log(`ℹ️  Pagos procesados en memoria: ${Object.keys(pagosProcesados).length}`);
  console.log('✓ Estado persistido cargado');
}

function guardarMensajesEnviados() { escribir(CONFIG.MENSAJES_ENVIADOS_FILE, mensajesEnviados); }
function guardarPagosProcesados() { escribir(CONFIG.PAGOS_PROCESADOS_FILE, pagosProcesados); }
function guardarCicloActual() { escribir(CONFIG.CICLO_FILE, cicloActual); }
function guardarColaRecordatorios() { escribir(CONFIG.COLA_RECORDATORIOS_FILE, colaRecordatorios); }

function getMensajesEnviados() { return mensajesEnviados; }
function getPagosProcesados() { return pagosProcesados; }
function getCicloActual() { return cicloActual; }
function getColaRecordatorios() { return colaRecordatorios; }
function setCicloActual(valor) {
  Object.keys(cicloActual).forEach(key => delete cicloActual[key]);
  Object.assign(cicloActual, valor);
}
function setColaRecordatorios(valor) {
  Object.keys(colaRecordatorios).forEach(key => delete colaRecordatorios[key]);
  Object.assign(colaRecordatorios, valor);
}

function yaSeEnvioHoy(clienteId) {
  const hoy = new Date().toISOString().split('T')[0];
  return mensajesEnviados[`${clienteId}_notificado_${hoy}`] === true;
}

function marcarMensajeEnviado(clienteId) {
  const hoy = new Date().toISOString().split('T')[0];
  mensajesEnviados[`${clienteId}_notificado_${hoy}`] = true;
  guardarMensajesEnviados();
  console.log(`   🔖 Cliente ${clienteId} marcado como notificado`);
}

function yaSeProcesoPago(pagoId) { return pagosProcesados[pagoId] === true; }
function marcarPagoProcesado(pagoId) {
  pagosProcesados[pagoId] = true;
  guardarPagosProcesados();
}

function limpiarMensajesAntiguos() {
  const hace7Dias = new Date();
  hace7Dias.setDate(hace7Dias.getDate() - 7);
  let eliminados = 0;
  Object.keys(mensajesEnviados).forEach(key => {
    const fecha = key.split('_')[2];
    if (fecha && new Date(fecha) < hace7Dias) {
      delete mensajesEnviados[key];
      eliminados++;
    }
  });
  if (eliminados > 0) {
    guardarMensajesEnviados();
    console.log(`🧹 Limpieza: ${eliminados} mensajes antiguos eliminados`);
  }
}

module.exports = {
  cargarEstado,
  guardarMensajesEnviados,
  guardarPagosProcesados,
  guardarCicloActual,
  guardarColaRecordatorios,
  getMensajesEnviados,
  getPagosProcesados,
  getCicloActual,
  getColaRecordatorios,
  setCicloActual,
  setColaRecordatorios,
  yaSeEnvioHoy,
  marcarMensajeEnviado,
  yaSeProcesoPago,
  marcarPagoProcesado
};
