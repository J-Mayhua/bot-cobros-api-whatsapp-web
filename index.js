// index.js
// Entry point: carga estado, inicializa WhatsApp, schedulers y servidor HTTP.

const fs = require('fs');
const CONFIG = require('./src/config');
const state = require('./src/storage/state');
const app = require('./src/app')();
const { inicializarWhatsApp } = require('./src/whatsapp/client');
const { monitorearPagosNuevos } = require('./src/jobs/monitorPagos');
const { programarRecordatoriosPrevios } = require('./src/jobs/recordatoriosPrevios');
const { programarRecordatoriosDeuda } = require('./src/jobs/recordatoriosDeuda');
const { enviarResumenDiario } = require('./src/jobs/resumenDiario');

CONFIG.validarConfig();
if (!fs.existsSync(CONFIG.VOUCHERS_DIR)) fs.mkdirSync(CONFIG.VOUCHERS_DIR);
state.cargarEstado();

console.log('\n╔═══════════════════════════════════════════╗');
console.log('║   SISTEMA UCRM v4.1 - CICLOS INTELIGENTES ║');
console.log('╚═══════════════════════════════════════════╝\n');

inicializarWhatsApp();

const waitForWhatsApp = setInterval(() => {
  const whatsappService = require('./src/services/whatsappService');
  if (!whatsappService.isReady()) return;
  clearInterval(waitForWhatsApp);
  setTimeout(() => {
    monitorearPagosNuevos();
    setInterval(monitorearPagosNuevos, CONFIG.INTERVALO_MONITOR_PAGOS);
  }, 30000);
  programarRecordatoriosPrevios();
  programarRecordatoriosDeuda();
  const ahora = new Date();
  const proximoResumen = new Date();
  proximoResumen.setHours(18, 0, 0, 0);
  if (ahora >= proximoResumen) proximoResumen.setDate(proximoResumen.getDate() + 1);
  setTimeout(() => {
    enviarResumenDiario();
    setInterval(enviarResumenDiario, 24 * 60 * 60 * 1000);
  }, proximoResumen - ahora);
}, 2000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🌐 Servidor: http://localhost:${PORT}`);
  console.log('   Health: /health');
  console.log('   Vouchers: /vouchers');
  console.log('   Shutdown: /shutdown\n');
});

process.on('SIGINT', async () => {
  state.guardarMensajesEnviados();
  state.guardarPagosProcesados();
  state.guardarCicloActual();
  state.guardarColaRecordatorios();
  const client = require('./src/services/whatsappService').getClient();
  if (client) await client.destroy();
  process.exit(0);
});

process.on('uncaughtException', error => console.error('❌ Error no capturado:', error));
process.on('unhandledRejection', reason => console.error('❌ Promesa rechazada:', reason));
