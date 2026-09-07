// src\config\index.js
// Configuracion y validacion de variables de entorno.

require('dotenv').config();

const CONFIG = {
  UCRM_URL: process.env.UCRM_URL,
  
  UCRM_API_KEY: process.env.UCRM_API_KEY,
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASS: process.env.EMAIL_PASS,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  
  PHONE_RECORDATORIOS: process.env.PHONE_RECORDATORIOS,
  PHONE_NOTIFICACIONES: process.env.PHONE_NOTIFICACIONES,
  
 CUENTAS_PAGO: {
  scotiabank: process.env.SCOTIA_CUENTA,
  scotiabank_cci: process.env.SCOTIA_CCI,
  bcp: process.env.BCP_CUENTA,
  yape: process.env.YAPE_NUMERO,
  nombre_titular: process.env.NOMBRE_TITULAR_SCOTIA
},


  DELAY_RECORDATORIOS_DEUDA: 10 * 60 * 1000, // 10 minutos entre mensajes
HORA_INICIO_DEUDA: 8,  // 8 AM
HORA_FIN_DEUDA: 18,    // 6 PM
HORA_INICIO_PREVIOS: 18, // 6 PM
HORA_FIN_PREVIOS: 20,    // 8 PM
  DIAS_RECORDATORIOS: [1],
  DIAS_ENTRE_RECORDATORIOS: 5,
  DIAS_RECORDATORIOS_DEUDA: [0, 2, 5, 9, 16, 23, 30],
  MAX_DIAS_DEUDA_RECORDATORIOS: 99999, // Sin límite de días
  MENSAJES_ENVIADOS_FILE: './mensajes_enviados.json',
  PAGOS_PROCESADOS_FILE: './pagos_procesados.json',
  CICLO_FILE: './ciclo_actual.json',
  COLA_RECORDATORIOS_FILE: './cola_recordatorios.json',
  VOUCHERS_DIR: './vouchers',
  VALIDAR_CLIENTE_ACTIVO: true,
  API_LIMIT: 10000, // Aumentar límite para obtener todas las facturas
  INTERVALO_MONITOR_PAGOS: 5 * 60 * 1000
};

function validarConfig() {
  const requeridas = [
    'UCRM_URL', 'UCRM_API_KEY', 'EMAIL_USER', 'EMAIL_PASS', 'ADMIN_EMAIL',
    'PHONE_RECORDATORIOS', 'PHONE_NOTIFICACIONES', 'SCOTIA_CUENTA',
    'SCOTIA_CCI', 'BCP_CUENTA', 'YAPE_NUMERO', 'NOMBRE_TITULAR_SCOTIA'
  ];
  const faltantes = requeridas.filter(nombre => !process.env[nombre]);
  if (faltantes.length) {
    console.warn(`⚠️ Variables de entorno faltantes: ${faltantes.join(', ')}`);
  }
  return faltantes;
}

module.exports = CONFIG;
module.exports.validarConfig = validarConfig;
