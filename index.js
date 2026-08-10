// ========================================
// SISTEMA DE AUTOMATIZACION UCRM v4.0
// VERSIÓN FINAL COMPLETA Y OPTIMIZADA
// ========================================

require('dotenv').config();
const axios = require('axios');
const nodemailer = require('nodemailer');
const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
let client = null;
const fs = require('fs');
const path = require('path');
const https = require('https');
const Tesseract = require('tesseract.js');

// ========================================
// CONFIGURACION
// ========================================
const CONFIG = {
  UCRM_URL: process.env.UCRM_URL || 'https://92.118.58.202:8443',
  
  UCRM_API_KEY: process.env.UCRM_API_KEY,
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASS: process.env.EMAIL_PASS,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  
  PHONE_RECORDATORIOS: process.env.PHONE_RECORDATORIOS || '51920779122',
  PHONE_NOTIFICACIONES: process.env.PHONE_NOTIFICACIONES || '51999001245',
  
 CUENTAS_PAGO: {
  scotiabank: process.env.SCOTIA_CUENTA || '770-8074385',
  scotiabank_cci: process.env.SCOTIA_CCI || '00942320770807438555',
  bcp: process.env.BCP_CUENTA || '35591107096005',
  yape: process.env.YAPE_NUMERO || '920779122',
  nombre_titular: process.env.NOMBRE_TITULAR_SCOTIA || 'Elizabeth Tacay Canturin'
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
  VOUCHERS_DIR: './vouchers',
  VALIDAR_CLIENTE_ACTIVO: true,
  API_LIMIT: 10000, // Aumentar límite para obtener todas las facturas
  INTERVALO_MONITOR_PAGOS: 5 * 60 * 1000
};
// ========================================
// 🚫 LISTA NEGRA TEMPORAL - CLIENTES INACTIVOS
// ========================================
const CLIENTES_BLOQUEADOS = [
  'CHACA CRUZ, MANUEL',
  'HILARIO POMA, FREDDY',
  'CRISTOBAL, RAUL',
  'CASTAÑEDA, MIRIAM',
  'ORIHUELA CAMARENA, MERCEDES ALICIA',
  'YUCRA CONTRERAS, JUAN ANGEL',
  'LIZARRAGA MARAVI, WILFREDO',
  'LUCEN MIRANDA, NICOLAS',
  'ESPLANA VARONA, LUIS',
  'SOLANO MIGUEL, MARIBEL',
  'PINTO, JHONATAN',
  'ESPINOZA, JORGE'
];


// Función para verificar si un cliente está bloqueado
function clienteEstaBloqueado(cliente) {
  if (!cliente) return false;
  
  // Construir nombre en formato "APELLIDO, NOMBRE" (como en UCRM)
  const nombreCompleto = `${cliente.lastName}, ${cliente.firstName}`.toUpperCase().trim();
  
  // Verificar coincidencia exacta
  if (CLIENTES_BLOQUEADOS.includes(nombreCompleto)) {
    console.log(`   🚫 Cliente BLOQUEADO: ${nombreCompleto}`);
    return true;
  }
  
  // Verificación adicional: buscar por palabras clave
  for (const nombreBloqueado of CLIENTES_BLOQUEADOS) {
    // Eliminar comas y espacios extras para comparar
    const nombreLimpio = nombreCompleto.replace(/,/g, '').replace(/\s+/g, ' ');
    const bloqueadoLimpio = nombreBloqueado.replace(/,/g, '').replace(/\s+/g, ' ');
    
    if (nombreLimpio === bloqueadoLimpio) {
      console.log(`   🚫 Cliente BLOQUEADO (flexible): ${nombreCompleto}`);
      return true;
    }
  }
  
  return false;
}



if (!fs.existsSync(CONFIG.VOUCHERS_DIR)) {
  fs.mkdirSync(CONFIG.VOUCHERS_DIR);
}

const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

console.log('\n⚙️ CONFIGURACIÓN:');
console.log(`   📅 Recordatorios previos: 1 día antes (6 PM - 8 PM)`);
console.log(`   ⚠️  Recordatorios deuda: 0-${CONFIG.MAX_DIAS_DEUDA_RECORDATORIOS} días (todos)`);
console.log(`   📱 Teléfono recordatorios: ${CONFIG.PHONE_RECORDATORIOS}`);
console.log(`   🔔 Teléfono notificaciones: ${CONFIG.PHONE_NOTIFICACIONES}\n`);

// ========================================
// SISTEMA DE TRACKING
// ========================================
let mensajesEnviados = {};
let pagosProcesados = {};
// ========================================
// SISTEMA DE CICLOS INTELIGENTES V4.1
// ========================================
// DESPUÉS:
let cicloActual = {
  inicioCiclo: null,
  clientesEnviados: [],
  cicloCompletado: false,
  ultimaActualizacionCola: null  // ← AGREGAR ESTA LÍNEA
};


const CICLO_FILE = './ciclo_actual.json';

function cargarMensajesEnviados() {
  try {
    if (fs.existsSync(CONFIG.MENSAJES_ENVIADOS_FILE)) {
      const data = fs.readFileSync(CONFIG.MENSAJES_ENVIADOS_FILE, 'utf8');
      mensajesEnviados = JSON.parse(data);
      console.log('✓ Historial de mensajes cargado');
    }
  } catch (error) {
    console.error('Error cargando historial:', error.message);
    mensajesEnviados = {};
  }
}

function guardarMensajesEnviados() {
  try {
    fs.writeFileSync(CONFIG.MENSAJES_ENVIADOS_FILE, JSON.stringify(mensajesEnviados, null, 2));
  } catch (error) {
    console.error('Error guardando historial:', error.message);
  }
}

function cargarPagosProcesados() {
  try {
    if (fs.existsSync(CONFIG.PAGOS_PROCESADOS_FILE)) {
      const data = fs.readFileSync(CONFIG.PAGOS_PROCESADOS_FILE, 'utf8');
      pagosProcesados = JSON.parse(data);
      console.log('✓ Historial de pagos procesados cargado');
    }
  } catch (error) {
    console.error('Error cargando historial de pagos:', error.message);
    pagosProcesados = {};
  }
}

function guardarPagosProcesados() {
  try {
    fs.writeFileSync(CONFIG.PAGOS_PROCESADOS_FILE, JSON.stringify(pagosProcesados, null, 2));
  } catch (error) {
    console.error('Error guardando historial de pagos:', error.message);
  }
}

function yaSeEnvioHoy(clienteId, facturaId, dias) {
  const hoy = new Date().toISOString().split('T')[0];
  // 🆕 Ahora marca por CLIENTE, no por factura individual
  const key = `${clienteId}_notificado_${hoy}`;
  return mensajesEnviados[key] === true;
}

function marcarMensajeEnviado(clienteId, facturaId, dias) {
  const hoy = new Date().toISOString().split('T')[0];
  // 🆕 Marca que el cliente YA fue notificado HOY
  const key = `${clienteId}_notificado_${hoy}`;
  mensajesEnviados[key] = true;
  guardarMensajesEnviados();
  console.log(`   🔖 Cliente ${clienteId} marcado como notificado`);
}


function yaSeProcesoPago(pagoId) {
  return pagosProcesados[pagoId] === true;
}

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

function limpiarPagosAntiguos() {
  console.log(`ℹ️  Pagos procesados en memoria: ${Object.keys(pagosProcesados).length}`);
  // No borrar nada al inicio - los IDs son la protección anti-duplicado
}
// ========================================
// GESTIÓN DE CICLOS
// ========================================
function cargarCicloActual() {
  try {
    if (fs.existsSync(CICLO_FILE)) {
      const data = fs.readFileSync(CICLO_FILE, 'utf8');
      cicloActual = JSON.parse(data);
      console.log('✓ Estado de ciclo cargado');
      
      if (cicloActual.inicioCiclo) {
        const diasDesdeInicio = (new Date() - new Date(cicloActual.inicioCiclo)) / (1000 * 60 * 60 * 24);
        if (diasDesdeInicio >= CONFIG.DIAS_ENTRE_RECORDATORIOS) {
          console.log('🔄 Ciclo expirado - Reiniciando');
          reiniciarCiclo();
        }
      }
    }
  } catch (error) {
    console.error('Error cargando ciclo:', error.message);
    reiniciarCiclo();
  }
}

function guardarCicloActual() {
  try {
    fs.writeFileSync(CICLO_FILE, JSON.stringify(cicloActual, null, 2));
  } catch (error) {
    console.error('Error guardando ciclo:', error.message);
  }
}

function reiniciarCiclo() {
  cicloActual = {
    inicioCiclo: new Date().toISOString(),
    clientesEnviados: [],
    cicloCompletado: false
  };
  guardarCicloActual();
  console.log('♻️  Ciclo reiniciado');
}
// ========================================
// SISTEMA DE COLA DE RECORDATORIOS V4.1
// ========================================
const COLA_RECORDATORIOS_FILE = './cola_recordatorios.json';

let colaRecordatorios = {
  clientes: [],
  ultimaActualizacion: null
};

function cargarColaRecordatorios() {
  try {
    if (fs.existsSync(COLA_RECORDATORIOS_FILE)) {
      const data = fs.readFileSync(COLA_RECORDATORIOS_FILE, 'utf8');
      colaRecordatorios = JSON.parse(data);
      console.log('✓ Cola de recordatorios cargada');
    }
  } catch (error) {
    console.error('Error cargando cola:', error.message);
    colaRecordatorios = { clientes: [], ultimaActualizacion: null };
  }
}

function guardarColaRecordatorios() {
  try {
    fs.writeFileSync(COLA_RECORDATORIOS_FILE, JSON.stringify(colaRecordatorios, null, 2));
  } catch (error) {
    console.error('Error guardando cola:', error.message);
  }
}

// ========================================
// CLIENTE WHATSAPP
// ========================================
let whatsappClient = null;
let whatsappReady = false;
let mensajesProcesados = new Set();
let ultimaLimpiezaMensajes = Date.now();
// ✅ AGREGAR ESTO DESPUÉS DE LA LÍNEA 383 (después de let ultimaLimpiezaMensajes)
let procesandoRecordatorios = false;
let ultimasRespuestas = {}; // { telefono: { tipo: 'promesa', timestamp: Date.now() } }
const COOLDOWN_RESPUESTAS = 5 * 60 * 1000; // 5 minutos entre respuestas iguales

function puedeResponder(telefono, tipoRespuesta) {
  const ahora = Date.now();
  const clave = `${telefono}_${tipoRespuesta}`;
  
  if (ultimasRespuestas[clave]) {
    const tiempoPasado = ahora - ultimasRespuestas[clave];
    if (tiempoPasado < COOLDOWN_RESPUESTAS) {
      console.log(`   ⏸️  Cooldown activo: ${Math.floor((COOLDOWN_RESPUESTAS - tiempoPasado) / 1000)}s restantes`);
      return false;
    }
  }
  
  ultimasRespuestas[clave] = ahora;
  return true;
}

function limpiarCooldowns() {
  const ahora = Date.now();
  Object.keys(ultimasRespuestas).forEach(clave => {
    if (ahora - ultimasRespuestas[clave] > 60 * 60 * 1000) { // 1 hora
      delete ultimasRespuestas[clave];
    }
  });
}

// Limpiar cooldowns cada 10 minutos
setInterval(limpiarCooldowns, 10 * 60 * 1000);

console.log('Inicializando WhatsApp Web...');
const sessionPath = path.join(__dirname, '.wwebjs_auth');
if (fs.existsSync(sessionPath)) {
    console.log('✓ Sesión anterior encontrada');
}

// Variable para controlar estado del cliente
let clientReady = false;

// ========================================
// INICIALIZAR WHATSAPP CON WPPCONNECT
// ========================================
// ========================================
// INICIALIZAR WHATSAPP CON WPPCONNECT
// ========================================
async function inicializarWhatsApp() {
    try {
        console.log('🔗 Iniciando conexión con WhatsApp...');

        client = new Client({
            authStrategy: new LocalAuth({ clientId: 'ucrm-bot' }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            }
        });

        client.on('qr', (qr) => {
            console.log('🔗 ESCANEA ESTE QR CON TU TELÉFONO:');
            require('qrcode-terminal').generate(qr, { small: true });
        });

        client.on('ready', () => {
            console.log('✅ WhatsApp conectado correctamente');
            whatsappClient = client;
            whatsappReady = true;
            clientReady = true;
            console.log('✅ Cliente completamente listo para operaciones');
        });

        client.on('message', async (message) => {
            if (message.fromMe) return;
            if (message.from.includes('status@broadcast')) return;

            const msgId = message.id._serialized;
            if (mensajesProcesados.has(msgId)) return;
            mensajesProcesados.add(msgId);

            if (Date.now() - ultimaLimpiezaMensajes > 300000) {
                if (mensajesProcesados.size > 1000) {
                    const arr = Array.from(mensajesProcesados);
                    mensajesProcesados.clear();
                    arr.slice(-500).forEach(id => mensajesProcesados.add(id));
                }
                ultimaLimpiezaMensajes = Date.now();
            }

            let telefono = message.from.replace('@c.us', '');

            if (!message.body || typeof message.body !== 'string') {
                if (message.hasMedia) {
                    // continúa abajo
                } else {
                    console.log(`📨 Mensaje sin texto de ${telefono} - IGNORADO`);
                    return;
                }
            }

            const texto = message.body ? message.body.toLowerCase().trim() : '';
            const tieneImagen = message.hasMedia && message.type === 'image';

            console.log(`\n📨 Mensaje de ${telefono}: "${message.body || '[imagen]'}"`);

            const clienteUCRM = await buscarClientePorTelefono(telefono);

            if (clienteUCRM) {
                console.log(`   ✅ Cliente encontrado: ${clienteUCRM.firstName} ${clienteUCRM.lastName}`);

                if (tieneImagen) {
                    console.log('   📸 Comprobante recibido, procesando...');
                    await procesarVoucher(telefono, message, client);
                    return;
                }

                const palabrasPago = ['ya pague', 'ya pagué', 'ya pagó', 'pague', 'pagué'];
                const mencionaPago = palabrasPago.some(p => texto.includes(p));

                if (mencionaPago) {
                    if (!puedeResponder(telefono, 'pago')) return;
                    await verificarPagoCliente(telefono, client, true);
                    return;
                }

                console.log('ℹ️  Mensaje ignorado');
                return;
            }

            console.log(`   ⚠️ Cliente NO encontrado en UCRM`);

            if (tieneImagen) {
                try {
                    const media = await message.downloadMedia();
                    if (media) {
                        const timestamp = Date.now();
                        const filename = `comprobante_${telefono}_${timestamp}.jpg`;
                        const filepath = path.join(CONFIG.VOUCHERS_DIR, filename);
                        fs.writeFileSync(filepath, media.data, 'base64');

                        await enviarWhatsApp(CONFIG.PHONE_NOTIFICACIONES,
                            `🔔 COMPROBANTE - NÚMERO NO REGISTRADO\n\n👤 Número: +${telefono}\n📸 ${filename}\n⚠️ No está en UCRM.`
                        );
                    }
                } catch (e) {
                    console.error('Error procesando comprobante:', e.message);
                }
                return;
            }

            const palabrasPago = ['pago', 'pagué', 'yape', 'transferencia', 'deposito', 'factura'];
            if (palabrasPago.some(p => texto.includes(p))) {
                await enviarWhatsApp(CONFIG.PHONE_NOTIFICACIONES,
                    `💬 MENSAJE DE PAGO - NO REGISTRADO\n\n👤 +${telefono}\n💬 "${message.body}"\n⚠️ No está en UCRM.`
                );
            }
        });

        client.on('disconnected', (reason) => {
            console.log('❌ WhatsApp desconectado:', reason);
            whatsappReady = false;
        });

        await client.initialize();

    } catch (error) {
        console.error('❌ Error al inicializar WhatsApp:', error.message);
        process.exit(1);
    }
}

// Iniciar WhatsApp
inicializarWhatsApp();



// ========================================
// OCR - EXTRACCIÓN DE DATOS
// ========================================
async function procesarImagenVoucher(imagePath) {
  try {
    console.log('   📸 Procesando imagen con OCR...');
    
    const { data: { text } } = await Tesseract.recognize(
      imagePath,
      'spa',
      {
        logger: m => {
          if (m.status === 'recognizing text') {
            process.stdout.write(`\r   OCR: ${Math.round(m.progress * 100)}%`);
          }
        }
      }
    );
    
    console.log('\n   ✓ OCR completado');
    return extraerDatosVoucher(text);
  } catch (error) {
    console.error('   ❌ Error en OCR:', error.message);
    return null;
  }
}

function extraerDatosVoucher(texto) {
  const info = {
    monto: null,
    fecha: null,
    operacion: null,
    banco: null,
    textoCompleto: texto
  };
  
  const bancosPatrones = [
    { nombres: ['BCP', 'BANCO CRÉDITO', 'BANCO CREDITO'], codigo: 'BCP' },
    { nombres: ['INTERBANK', 'INTER BANK'], codigo: 'INTERBANK' },
    { nombres: ['SCOTIABANK', 'SCOTIA'], codigo: 'SCOTIABANK' },
    { nombres: ['BBVA'], codigo: 'BBVA' },
    { nombres: ['YAPE'], codigo: 'YAPE' },
    { nombres: ['PLIN'], codigo: 'PLIN' }
  ];
  
  const textoMayuscula = texto.toUpperCase();
  
  for (const banco of bancosPatrones) {
    for (const nombre of banco.nombres) {
      if (textoMayuscula.includes(nombre)) {
        info.banco = banco.codigo;
        break;
      }
    }
    if (info.banco) break;
  }
  
  const patronesMonto = [
    /(?:ENVIASTE|RECIBISTE|PAGASTE|TRANSFERISTE)\s*S\/?\s*(\d{1,6}[.,]\d{2})/gi,
    /(?:MONTO|IMPORTE|TOTAL)\s*[:=]?\s*S\/?\s*(\d{1,6}[.,]\d{2})/gi,
    /S\/\s*(\d{1,6}[.,]\d{2})/gi,
    /PEN\s*(\d{1,6}[.,]\d{2})/gi
  ];
  
  const montosEncontrados = [];
  
  for (const patron of patronesMonto) {
    const matches = texto.matchAll(patron);
    for (const match of matches) {
      let montoStr = match[1].replace(/,/g, '.');
      let monto = parseFloat(montoStr);
      if (monto >= 1 && monto <= 999999) {
        montosEncontrados.push(monto);
      }
    }
  }
  
  if (montosEncontrados.length > 0) {
    info.monto = Math.max(...montosEncontrados);
  }
  
  const patronesFecha = [
    /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/,
    /(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\.?\s+(\d{4})/i
  ];
  
  for (const patron of patronesFecha) {
    const match = texto.match(patron);
    if (match) {
      info.fecha = match[0];
      break;
    }
  }
  
  const patronesOperacion = [
    /(?:OPERACI[OÓ]N|N[UÚ]MERO|REF)[:\s#]*(\d{8,20})/i,
    /(?:C[OÓ]DIGO|CODE)[:\s#]*(\d{8,20})/i
  ];
  
  for (const patron of patronesOperacion) {
    const match = texto.match(patron);
    if (match) {
      info.operacion = match[1];
      break;
    }
  }
  
  return info;
}







// ========================================
// PROCESAR VOUCHER
// ========================================
// ==================== PROCESAR VOUCHER ====================
async function procesarVoucher(telefono, message, client) {
  try {
    const cliente = await buscarClientePorTelefono(telefono);
    
    if (!cliente) {
      await client.sendMessage(message.from, "Lo siento, no encontramos tu cuenta. Contacta a soporte.");
      return;
    }

    // Descargar imagen del voucher
    const media = await message.downloadMedia();
    
    if (!media) {
      await client.sendMessage(message.from, "No pude descargar la imagen. Intenta nuevamente.");
      return;
    }

    // Guardar voucher
    const timestamp = Date.now();
    const filename = `voucher_${cliente.id}_${timestamp}.jpg`;
    const filepath = path.join(CONFIG.VOUCHERS_DIR, filename);
    fs.writeFileSync(filepath, media.data, 'base64');
    
    console.log(`✅ Voucher guardado: ${filename}`);

    // Procesar con OCR
    const datosVoucher = await procesarImagenVoucher(filepath);

    if (datosVoucher) {
      console.log("📊 Datos extraídos:", datosVoucher);

      // Agregar nota en UCRM con datos del voucher
      let notaVoucher = `📸 CLIENTE ENVIÓ VOUCHER\n`;
      notaVoucher += `Archivo: ${filename}\n`;
      notaVoucher += `Teléfono: ${telefono}\n`;
      if (datosVoucher.monto) notaVoucher += `Monto: S/ ${datosVoucher.monto.toFixed(2)}\n`;
      if (datosVoucher.fecha) notaVoucher += `Fecha: ${datosVoucher.fecha}\n`;
      if (datosVoucher.operacion) notaVoucher += `Operación: ${datosVoucher.operacion}\n`;
      if (datosVoucher.banco) notaVoucher += `Banco: ${datosVoucher.banco}\n`;
      notaVoucher += `⏳ PENDIENTE DE VERIFICACIÓN`;

      await agregarNotaCliente(cliente.id, notaVoucher);

      // Notificar al admin
      let mensajeAdmin = `🆕 NUEVO VOUCHER\n\n`;
      mensajeAdmin += `${cliente.firstName} ${cliente.lastName}\n`;
      mensajeAdmin += `ID: ${cliente.id}\n`;
      if (datosVoucher.monto) mensajeAdmin += `💰 S/ ${datosVoucher.monto.toFixed(2)}\n`;
      if (datosVoucher.banco) mensajeAdmin += `🏦 ${datosVoucher.banco}\n`;
      mensajeAdmin += `\n${CONFIG.UCRM_URL}/client/${cliente.id}`; // ✅ UCRM_URL

      await enviarWhatsApp(CONFIG.PHONE_NOTIFICACIONES, mensajeAdmin); // ✅ PHONE_NOTIFICACIONES

      // Responder al cliente
      let respuesta = `✅ ¡Gracias ${cliente.firstName}!\n\n`;
respuesta += `Recibimos tu comprobante de pago.\n`;

if (datosVoucher.monto) {
  respuesta += `💰 Monto: S/ ${datosVoucher.monto.toFixed(2)}\n`;
}

respuesta += `\n⏳ Estamos verificando tu pago.\n`;
respuesta += `Te confirmaremos en unos minutos. 😊`;

      await client.sendMessage(message.from, respuesta);
      console.log("✅ Voucher procesado correctamente");

    } else {
      // OCR falló, pero igual guardar
      await agregarNotaCliente(
        cliente.id, 
        `Voucher recibido - OCR falló: ${filename}`
      );

      await client.sendMessage(
      message.from, 
      `Gracias ${cliente.firstName}, recibimos tu comprobante. ✅\n` +
        `Estamos verificando y te confirmaremos pronto.`
      );

      await enviarWhatsApp(
        CONFIG.PHONE_NOTIFICACIONES,
        `${cliente.firstName} envió voucher pero OCR falló.\n${filename}`
      );
    }

  } catch (error) {
    console.error("Error procesando voucher:", error.message);
    // ⚠️ NO enviar mensaje de error al cliente, solo log interno
  }
}



// ========================================
// FUNCIONES AUXILIARES
// ========================================
function formatearFecha(fecha) {
  const d = new Date(fecha);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const anio = d.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

function obtenerNombreMes(fecha) {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 
                 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const d = new Date(fecha);
  return meses[d.getMonth()];
}

function diasParaVencer(fecha) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const vencimiento = new Date(fecha);
  vencimiento.setHours(0, 0, 0, 0);
  const diff = vencimiento - hoy;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function limpiarTelefono(telefono) {
  if (!telefono) return null;
  let limpio = telefono.replace(/[^\d]/g, '');
  
  if (limpio.startsWith('51')) return limpio;
  if (limpio.startsWith('9') && limpio.length === 9) return '51' + limpio;
  if (limpio.length === 9) return '51' + limpio;
  
  return limpio;
}

// ========================================
// VALIDACIÓN DE CLIENTES ACTIVOS
// ========================================
function clienteDebeRecibirMensajes(cliente) {
  if (!cliente) return false;
  if (!CONFIG.VALIDAR_CLIENTE_ACTIVO) return true;
  
  // ✅ Solo rechazar si isActive === 0 (DESCONECTADO)
  // Los SUSPENDIDOS tienen isActive === 1, así que SÍ deben recibir mensajes
  if (cliente.isActive === 0) {
    console.log(`   ⏭️  Cliente ${cliente.id} (${cliente.firstName}) DESCONECTADO - NO enviar`);
    return false;
  }
  
  // ✅ Cliente ACTIVO o SUSPENDIDO (ambos tienen isActive === 1)
  return true;
}
// ========================================
// VALIDACIÓN DE CLIENTES ACTIVOS
// ========================================
// ========================================
// VALIDACIÓN DE SERVICIOS ACTIVOS - CORREGIDO
// ========================================


// 🔧 CORRECCIÓN 1: Validación de servicios CORRECTA
// ========================================
async function clienteTieneServicioActivo(clienteId, cliente = null) {
  if (!CONFIG.VALIDAR_CLIENTE_ACTIVO) return true;
  
  // ✅ SIEMPRE validar servicios (incluso si isActive === 1)
  if (!cliente) {
    cliente = await obtenerCliente(clienteId);
    if (!cliente) {
      console.log(`   ⚠️  Cliente ${clienteId}: No encontrado`);
      return false;
    }
  }
  
  try {
    const response = await axios.get(`${CONFIG.UCRM_URL}/api/v1.0/clients/services`, {
      headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
      params: { clientId: clienteId },
      httpsAgent
    });
    
    if (!Array.isArray(response.data) || response.data.length === 0) {
      console.log(`   ⚠️  Cliente ${clienteId}: Sin servicios`);
      return false;
    }
    
    // ✅ Estados válidos: Activo (1), Finalizado (2), Suspendido (3), Terminado (4)
    const estadosValidos = [1, 2, 3, 4];
    
    const serviciosValidos = response.data.filter(s => estadosValidos.includes(s.status));
    
    if (serviciosValidos.length === 0) {
      console.log(`   ⏸️  Cliente ${clienteId}: Sin servicios válidos`);
      return false;
    }
    
    // ✅ Log detallado
    const conteo = {
      activos: response.data.filter(s => s.status === 1).length,
      suspendidos: response.data.filter(s => s.status === 3).length
    };
    
    console.log(`   ✅ Cliente ${clienteId}: ${conteo.activos} activo(s), ${conteo.suspendidos} suspendido(s)`);
    return true;
    
  } catch (error) {
    console.error(`   ⚠️  Error verificando servicios ${clienteId}:`, error.message);
    return true; // En caso de error, permitir envío
  }
}

// ========================================
// 🔧 CORRECCIÓN 2: Función debeRecibirMensajeCompleto MEJORADA
// ========================================

// ========================================
// Función debeRecibirMensajeCompleto MEJORADA
// ========================================
async function debeRecibirMensajeCompleto(cliente, factura) {
  const razones = { cumple: [], noCumple: [] };

  // 🚫 0. LISTA NEGRA
  if (clienteEstaBloqueado(cliente)) {
    razones.noCumple.push('Cliente en lista negra');
    return { debe: false, razones };
  }

  // 1. Estado de factura
  if (factura.status !== 1) {
    razones.noCumple.push('Factura no está en estado "No Pagada"');
    return { debe: false, razones };
  }
  razones.cumple.push('✅ Factura NO pagada');

  // 2. Monto pendiente
  const monto = Number(factura.amountToPay || factura.toPay || 0);
  if (monto <= 0) {
    razones.noCumple.push('Sin monto pendiente');
    return { debe: false, razones };
  }
  razones.cumple.push(`✅ Monto: S/ ${monto.toFixed(2)}`);

  // 3. Días de deuda
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const vencimiento = new Date(factura.dueDate);
  vencimiento.setHours(0, 0, 0, 0);
  const diasDeuda = Math.floor((hoy - vencimiento) / (1000 * 60 * 60 * 24));
  
  if (diasDeuda < 0) {
    razones.noCumple.push(`Factura aún no vence (${Math.abs(diasDeuda)} días)`);
    return { debe: false, razones };
  }
  razones.cumple.push(`✅ Días de deuda: ${diasDeuda}`);

  // 4. Teléfono
  const telefono = cliente.contacts?.[0]?.phone;
  if (!telefono) {
    razones.noCumple.push('Sin teléfono');
    return { debe: false, razones };
  }
  razones.cumple.push(`✅ Teléfono: ${telefono}`);

  // 5. ✅ VALIDAR SERVICIOS (SIEMPRE)
  const tieneServicioValido = await clienteTieneServicioActivo(cliente.id, cliente);
  if (!tieneServicioValido) {
    razones.noCumple.push('Sin servicios válidos');
    return { debe: false, razones };
  }
  razones.cumple.push('✅ Servicios válidos');

  return { debe: true, razones };
}

// ========================================
// 🔧 CORRECCIÓN 3: actualizarColaRecordatorios USA debeRecibirMensajeCompleto
// ========================================
async function actualizarColaRecordatorios() {
  try {
    console.log('\n🔄 Actualizando cola de recordatorios...');
    
    const ahora = new Date();
    const ultimaActualizacion = cicloActual.ultimaActualizacionCola
      ? new Date(cicloActual.ultimaActualizacionCola)
      : null;
    
    const esNuevoDia = !ultimaActualizacion || 
      ahora.toDateString() !== ultimaActualizacion.toDateString();
    
    // ✅ SIEMPRE actualizar la cola cada nuevo día para detectar facturas nuevas
    if (esNuevoDia || colaRecordatorios.clientes.length === 0) {
      console.log('   🆕 Actualizando cola (nuevo día o cola vacía)...');
      colaRecordatorios.clientes = [];
      cicloActual.ultimaActualizacionCola = ahora.toISOString();
      guardarCicloActual();
    } else {
      console.log(`   ℹ️  Cola existente: ${colaRecordatorios.clientes.length} clientes (mismo día)`);
      return;
    }

    const facturas = await obtenerFacturasSinPagar();
    console.log(`   📊 Facturas sin pagar: ${facturas.length}`);

    if (facturas.length === 0) {
      console.log('   ✅ No hay facturas pendientes');
      return;
    }

    // Agrupar por cliente
    const facturasPorCliente = {};
    for (const factura of facturas) {
      if (!factura.clientId) continue;
      if (!facturasPorCliente[factura.clientId]) {
        facturasPorCliente[factura.clientId] = [];
      }
      facturasPorCliente[factura.clientId].push(factura);
    }

    console.log(`   👥 Clientes con deuda: ${Object.keys(facturasPorCliente).length}`);

    let clientesAgregados = 0;
    let saltadosListaNegra = 0;
    let saltadosSinServicio = 0;
    let saltadosSinTelefono = 0;
    let saltadosFacturasInvalidas = 0;

    const totalClientes = Object.keys(facturasPorCliente).length;
    let clientesRevisados = 0;

    for (const [clienteId, facturasCliente] of Object.entries(facturasPorCliente)) {
      clientesRevisados++;

      if (clientesRevisados % 10 === 0) {
        process.stdout.write(`\r   📋 Progreso: ${clientesRevisados}/${totalClientes}...`);
      }

      const cliente = await obtenerCliente(clienteId);
      if (!cliente) continue;

      // ✅ USAR debeRecibirMensajeCompleto para CADA factura
      let facturasValidas = [];
      let diasDeudaMax = -Infinity;
      let totalDeuda = 0;

      for (const factura of facturasCliente) {
        const validacion = await debeRecibirMensajeCompleto(cliente, factura);
        
        if (!validacion.debe) {
          // Contar razones de rechazo
          if (validacion.razones.noCumple.includes('Cliente en lista negra')) {
            saltadosListaNegra++;
          } else if (validacion.razones.noCumple.some(r => r.includes('servicio'))) {
            saltadosSinServicio++;
          } else if (validacion.razones.noCumple.includes('Sin teléfono')) {
            saltadosSinTelefono++;
          } else {
            saltadosFacturasInvalidas++;
          }
          continue;
        }

        const vencimiento = new Date(factura.dueDate);
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        vencimiento.setHours(0, 0, 0, 0);

        const diasDeuda = Math.floor((hoy - vencimiento) / (1000 * 60 * 60 * 24));

        if (diasDeuda > diasDeudaMax) {
          diasDeudaMax = diasDeuda;
        }

        totalDeuda += factura.amountToPay;
        facturasValidas.push(factura);
      }

      if (facturasValidas.length === 0) continue;

      // ✅ AGREGAR A LA COLA
      colaRecordatorios.clientes.push({
        clienteId: cliente.id,
        nombre: `${cliente.firstName} ${cliente.lastName}`.trim(),
        telefono: limpiarTelefono(cliente.contacts[0].phone),
        facturas: facturasValidas.map(f => ({
          id: f.id,
          numero: f.number,
          monto: f.amountToPay,
          vencimiento: f.dueDate,
          mes: obtenerNombreMesCompleto(f.dueDate)
        })),
        cantidadFacturas: facturasValidas.length,
        diasDeuda: diasDeudaMax,
        totalDeuda,
        monto: totalDeuda,
        ultimoEnvio: null,
        intentos: 0
      });

      clientesAgregados++;
    }

    console.log('\n');

    // Ordenar por días de deuda
    colaRecordatorios.clientes.sort((a, b) => b.diasDeuda - a.diasDeuda);
    guardarColaRecordatorios();

    // Resumen
    console.log('\n   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('   📊 RESUMEN DE PROCESAMIENTO');
    console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`   ✅ Clientes válidos en cola: ${colaRecordatorios.clientes.length}`);
    console.log('\n   ⏭️  CLIENTES/FACTURAS EXCLUIDOS:');
    console.log(`      • Lista negra: ${saltadosListaNegra}`);
    console.log(`      • Sin servicios válidos: ${saltadosSinServicio}`);
    console.log(`      • Sin teléfono: ${saltadosSinTelefono}`);
    console.log(`      • Facturas inválidas: ${saltadosFacturasInvalidas}`);

    if (colaRecordatorios.clientes.length > 0) {
      console.log('\n   👥 TOP 5 CLIENTES EN COLA:');
      colaRecordatorios.clientes.slice(0, 5).forEach((c, i) => {
        console.log(`      ${i + 1}. ${c.nombre} - ${c.facturas.length} factura(s) - ${c.diasDeuda} días - S/ ${c.totalDeuda.toFixed(2)}`);
      });
    }

    console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Error actualizando cola:', error.message);
  }
}


// ========================================
// FUNCIONES UCRM API
// ========================================
async function obtenerFacturasSinPagar() {
  try {
    // 🆕 YA NO LIMITAR POR FECHA - OBTENER TODAS LAS FACTURAS SIN PAGAR
    const response = await axios.get(`${CONFIG.UCRM_URL}/api/v1.0/invoices`, {
      headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
      params: { 
        status: 1,
        limit: CONFIG.API_LIMIT
        // 🆕 SIN createdDateFrom - Obtener facturas de cualquier fecha
      },
      httpsAgent
    });

    if (!Array.isArray(response.data)) return [];
    
    return response.data;
  } catch (error) {
    console.error('Error obteniendo facturas:', error.message);
    return [];
  }
}

async function obtenerCliente(clienteId) {
  try {
    const response = await axios.get(`${CONFIG.UCRM_URL}/api/v1.0/clients/${clienteId}`, {
      headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
      httpsAgent
    });
    return response.data;
  } catch (error) {
    return null;
  }
}
async function obtenerServiciosCliente(clienteId) {
  try {
    const response = await axios.get(`${CONFIG.UCRM_URL}/api/v1.0/clients/services`, {
      headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
      params: { clientId: clienteId },
      httpsAgent
    });
    
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.error(`   ⚠️  Error obteniendo servicios cliente ${clienteId}:`, error.message);
    return [];
  }
}
// ========================================
// 🆕 NUEVA FUNCIÓN: OBTENER FACTURA INDIVIDUAL
// ========================================
async function obtenerFactura(facturaId) {
  try {
    const response = await axios.get(`${CONFIG.UCRM_URL}/api/v1.0/invoices/${facturaId}`, {
      headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
      httpsAgent
    });
    return response.data;
  } catch (error) {
    console.error(`   ⚠️  Error obteniendo factura ${facturaId}:`, error.message);
    return null;
  }
}



async function obtenerTodosLosClientes() {
  try {
    let todosLosClientes = [];
    let offset = 0;
    const limit = 100;
    let hayMas = true;
    
    while (hayMas) {
      const response = await axios.get(`${CONFIG.UCRM_URL}/api/v1.0/clients`, {
        headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
        params: { limit, offset },
        httpsAgent
      });
      
      if (!Array.isArray(response.data)) break;
      
      const clientes = response.data;
      todosLosClientes = todosLosClientes.concat(clientes);
      
      if (clientes.length < limit) {
        hayMas = false;
      } else {
        offset += limit;
        await sleep(1000);
      }
    }
    
    return todosLosClientes;
  } catch (error) {
    console.error('Error obteniendo clientes:', error.message);
    return [];
  }
}

async function buscarClientePorTelefono(telefono) {
  try {
    const clientes = await obtenerTodosLosClientes();
    const numeroLimpio = limpiarTelefono(telefono);
    
    if (!numeroLimpio) return null;
    
    const ultimos9 = numeroLimpio.slice(-9);
    
    for (const cliente of clientes) {
      if (cliente.contacts && Array.isArray(cliente.contacts)) {
        for (const contacto of cliente.contacts) {
          if (contacto.phone) {
            const telefonoCliente = limpiarTelefono(contacto.phone);
            const ultimos9Cliente = telefonoCliente ? telefonoCliente.slice(-9) : null;
            
            if (telefonoCliente === numeroLimpio || ultimos9Cliente === ultimos9) {
              return cliente;
            }
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}
// ========================================
// BUSCAR PAGOS CLIENTE
// ========================================
async function buscarPagosCliente(clienteId, dias = 7) {
  try {
    const fechaDesde = new Date();
    fechaDesde.setDate(fechaDesde.getDate() - dias);
    
    const response = await axios.get(`${CONFIG.UCRM_URL}/api/v1.0/payments`, {
      headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
      params: {
        clientId: clienteId,
        createdDateFrom: fechaDesde.toISOString().split('T')[0]
      },
      httpsAgent
    });
    
    if (!Array.isArray(response.data)) return [];
    
    return response.data;
  } catch (error) {
    return [];
  }
}
// ========================================
// OBTENER DEUDA TOTAL DEL CLIENTE
// ========================================
async function obtenerDeudaCliente(clienteId) {
  try {
    const response = await axios.get(`${CONFIG.UCRM_URL}/api/v1.0/invoices`, {
      headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
      params: { 
        clientId: clienteId,
        status: 1  // Solo facturas sin pagar
      },
      httpsAgent
    });
    
    if (!Array.isArray(response.data) || response.data.length === 0) {
      return { facturas: [], total: 0 };
    }
    
    let total = 0;
    const facturas = response.data.map(f => {
      const monto = Number(f.amountToPay || f.toPay || f.amountDue || 0);
      total += monto;
      return {
        numero: f.number,
        monto: monto,
        vence: f.dueDate,
        dias: diasParaVencer(f.dueDate)
      };
    });
    
    return { facturas, total };
  } catch (error) {
    console.error('Error obteniendo deuda:', error.message);
    return { facturas: [], total: 0 };
  }
}
// ========================================
// AGRUPAR FACTURAS POR CLIENTE
// ========================================
async function agruparFacturasPorCliente(facturas) {
  const clientesMap = new Map();
  
  for (const factura of facturas) {
    const clienteId = factura.clientId;
    
    if (!clientesMap.has(clienteId)) {
      clientesMap.set(clienteId, {
        clienteId: clienteId,
        facturas: [],
        total: 0
      });
    }
    
    const grupo = clientesMap.get(clienteId);
    grupo.facturas.push(factura);
    grupo.total += Number(factura.amountToPay || factura.toPay || 0);
  }
  
  return Array.from(clientesMap.values());
}

// ========================================
// OBTENER NOMBRE DEL MES
// ========================================
function obtenerNombreMesCompleto(fecha) {
  const meses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const d = new Date(fecha);
  return meses[d.getMonth()];
}


async function agregarNotaCliente(clienteId, nota) {
  try {
    await axios.post(
      `${CONFIG.UCRM_URL}/api/v1.0/clients/${clienteId}/notes`,
      { subject: 'Automatización', body: nota },
      { 
        headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
        httpsAgent
      }
    );
  } catch (error) {
    console.error(`   ⚠️  Error agregando nota:`, error.message);
  }
}

// ========================================
// DESCARGAR PDFs COMO BUFFER (SIN GUARDAR)
// ========================================
async function descargarPDFFacturaBuffer(facturaId) {
  try {
    const response = await axios.get(
      `${CONFIG.UCRM_URL}/api/v1.0/invoices/${facturaId}/pdf`,
      {
        headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
        responseType: 'arraybuffer',
        httpsAgent
      }
    );
    
    return Buffer.from(response.data);
  } catch (error) {
    console.error(`Error descargando PDF:`, error.message);
    return null;
  }
}

async function descargarPDFPagoBuffer(pagoId) {
  try {
    const response = await axios.get(
      `${CONFIG.UCRM_URL}/api/v1.0/payments/${pagoId}/pdf`,
      {
        headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
        responseType: 'arraybuffer',
        httpsAgent
      }
    );
    
    return Buffer.from(response.data);
  } catch (error) {
    console.error(`Error descargando recibo:`, error.message);
    return null;
  }
}

// ========================================
// ENVIO DE MENSAJES
// ========================================
// ========================================
// ENVIO DE MENSAJES
// ========================================
// ========================================
// ENVIO DE MENSAJES
// ========================================
async function enviarWhatsApp(telefono, mensaje) {
  if (!whatsappReady || !whatsappClient) {
    console.log('⚠️ WhatsApp no está listo')
    return false
  }
  
  try {
    const numeroLimpio = limpiarTelefono(telefono)
    if (!numeroLimpio) {
      console.log('❌ Teléfono inválido', telefono)
      return false
    }
    
    const chatId = `${numeroLimpio}@c.us`
    
    // ✅ NUEVO: Timeout de 60 segundos
    await Promise.race([
      whatsappClient.sendMessage(chatId, mensaje),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout 60s')), 60000)
      )
    ])
    
    console.log(`✅ Mensaje enviado a`, numeroLimpio)
    return true
    
  } catch (error) {
    // ✅ NUEVO: Detectar timeouts críticos y reiniciar
    if (error.message.includes('protocolTimeout') || 
        error.message.includes('Runtime.callFunctionOn') ||
        error.message.includes('Timeout 60s')) {
      
      console.error(`🚨 TIMEOUT CRÍTICO - Forzando reinicio`)
      
      // Intentar notificar por email (sin bloquear)
      enviarEmail(
        CONFIG.ADMIN_EMAIL,
        '🚨 Bot necesita reinicio',
        `WhatsApp Web saturado. Reiniciando automáticamente...`
      ).catch(() => {});
      
      process.exit(1) // PM2 lo reiniciará
    }
    
    console.error(`❌ Error enviando a`, telefono, `:`, error.message)
    return false
  }
}





async function enviarPDFDesdeMemoria(telefono, mensaje, pdfBuffer, nombreArchivo) {
    if (!whatsappReady || !whatsappClient) {
        console.log('⚠️  WhatsApp no está listo');
        return false;
    }

    try {
        const numeroLimpio = limpiarTelefono(telefono);
        if (!numeroLimpio) {
            console.log('⚠️  Teléfono inválido');
            return false;
        }

        const chatId = `${numeroLimpio}@c.us`;

        // 1. ENVIAR MENSAJE DE TEXTO
        await whatsappClient.sendMessage(chatId, mensaje);
        console.log('✅ Mensaje enviado');

        // 2. ENVIAR PDF SI EXISTE
        if (pdfBuffer) {
            await sleep(3000); // Esperar 3 segundos
            
            const base64Data = pdfBuffer.toString('base64');
            
            const media = new MessageMedia('application/pdf', base64Data, nombreArchivo);
await whatsappClient.sendMessage(chatId, media);

            
            console.log('✅ PDF enviado');
        }

        return true;

    } catch (error) {
        console.error('❌ Error enviando mensaje/PDF:', error.message);
        return false;
    }
}


async function enviarEmail(destinatario, asunto, contenido) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: CONFIG.EMAIL_USER,
        pass: CONFIG.EMAIL_PASS
      }
    });
    
    await transporter.sendMail({
      from: CONFIG.EMAIL_USER,
      to: destinatario,
      subject: asunto,
      text: contenido
    });
    return true;
  } catch (error) {
    console.error('❌ Error enviando email:', error.message);
    return false;
  }
}

// ========================================
// MONITOR DE PAGOS NUEVOS (CADA 5 MIN)
// ========================================
async function monitorearPagosNuevos() {
  if (!whatsappReady) {
    console.log('⏳ WhatsApp no está listo');
    return;
  }
  
  try {
    console.log('\n🔍 MONITOREANDO PAGOS NUEVOS...');
    
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const fechaFormateada = ayer.toISOString().split('T')[0];
    
    const response = await axios.get(`${CONFIG.UCRM_URL}/api/v1.0/payments`, {
      headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
      params: {
        createdDateFrom: fechaFormateada,
        limit: 100
      },
      httpsAgent
    });
    
    if (!Array.isArray(response.data) || response.data.length === 0) {
      console.log('   ℹ️  No hay pagos recientes');
      return;
    }
    
    console.log(`   📊 ${response.data.length} pagos en las últimas 24h`);
    
    let pagosNuevosProcesados = 0;
    
    for (const pago of response.data) {
      // Si ya fue procesado anteriormente, saltar
      if (yaSeProcesoPago(pago.id)) continue;
      
      console.log(`\n   💰 Nuevo pago: ID ${pago.id} - ${formatearFecha(pago.createdDate)}`);
      
      const cliente = await obtenerCliente(pago.clientId);
      if (!cliente) {
        marcarPagoProcesado(pago.id);
        continue;
      }
      
      const telefono = cliente.contacts?.[0]?.phone;
      if (!telefono) {
        marcarPagoProcesado(pago.id);
        continue;
      }
      
      let facturaId = null;
      if (pago.paymentCovers && pago.paymentCovers.length > 0) {
        facturaId = pago.paymentCovers[0].invoiceId;
      }
      
      const mensaje = `✅ ¡Hola ${cliente.firstName}!

🎉 Tu pago ha sido CONFIRMADO

💰 Monto: S/ ${Number(pago.amount).toFixed(2)}
📅 Fecha: ${formatearFecha(pago.createdDate)}
${facturaId ? `🧾 Factura: #${facturaId}` : ''}

📄 Te envío tu recibo en unos segundos...

¡Gracias por tu pago! 😊`;
      
      const enviado = await enviarWhatsApp(telefono, mensaje);
      
      if (enviado) {
        console.log('      ✅ Mensaje enviado');
        pagosNuevosProcesados++;
        
        await sleep(3000);
        
        const pdfBuffer = await descargarPDFPagoBuffer(pago.id);
        if (pdfBuffer) {
          try {
            const numeroLimpio = limpiarTelefono(telefono);
            const chatId = `${numeroLimpio}@c.us`;
            const base64Data = pdfBuffer.toString('base64');
            const mediaPDF = new MessageMedia('application/pdf', base64Data, `recibo_${pago.id}.pdf`);
            await whatsappClient.sendMessage(chatId, mediaPDF);
            console.log('✅ PDF enviado');
          } catch (error) {
            console.log('❌ Error enviando PDF:', error.message);
          }
        }
        
        await agregarNotaCliente(
          cliente.id, 
          `✅ PAGO CONFIRMADO AUTOMÁTICAMENTE\n💰 S/ ${pago.amount}\n📄 Recibo enviado por WhatsApp`
        );
        
        const notificacionAdmin = `✅ PAGO CONFIRMADO

👤 ${cliente.firstName} ${cliente.lastName}
🆔 ID: ${cliente.id}
💰 S/ ${Number(pago.amount).toFixed(2)}
📅 ${formatearFecha(pago.createdDate)}

✓ Cliente notificado`;

        await enviarWhatsApp(CONFIG.PHONE_NOTIFICACIONES, notificacionAdmin);
      }
      
      marcarPagoProcesado(pago.id);
      await sleep(2000);
    }
    
    if (pagosNuevosProcesados > 0) {
      console.log(`\n✅ ${pagosNuevosProcesados} pago(s) procesado(s)\n`);
    } else {
      console.log('✓ Sin pagos nuevos\n');
    }
    
  } catch (error) {
    if (error.response?.status !== 400) {
      console.error('❌ Error en monitor:', error.message);
    }
  }
}

// ========================================
// RECORDATORIOS PREVIOS (2 DÍAS ANTES)
// ========================================
// ========================================
// RECORDATORIOS PREVIOS (1 DÍA ANTES) - CORREGIDO
// ========================================
async function procesarRecordatoriosPrevios() {
  if (!whatsappReady) {
    console.log('\n⏳ WhatsApp no está listo\n');
    return;
  }
  
  const ahora = new Date();
  const hora = ahora.getHours();
  
  // Solo entre 6 PM y 8 PM
  if (hora < CONFIG.HORA_INICIO_PREVIOS || hora >= CONFIG.HORA_FIN_PREVIOS) {
    console.log(`\n⏸️  Fuera de horario (${hora}:00) - Recordatorios previos: 6 PM - 8 PM\n`);
    return;
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔔 RECORDATORIOS PREVIOS (1 DÍA ANTES)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const facturas = await obtenerFacturasSinPagar();
  
  if (facturas.length === 0) {
    console.log('✓ No hay facturas sin pagar\n');
    return;
  }

  // ✅ PASO 1: AGRUPAR FACTURAS POR CLIENTE
  const facturasPorCliente = {};
  
  for (const factura of facturas) {
    const dias = diasParaVencer(factura.dueDate);
    
    if (dias !== 1) continue; // Solo las que vencen mañana
    
    if (!facturasPorCliente[factura.clientId]) {
      facturasPorCliente[factura.clientId] = [];
    }
    
    facturasPorCliente[factura.clientId].push(factura);
  }

  let enviados = 0;
  let saltados = 0;

  // ✅ PASO 2: PROCESAR CLIENTE POR CLIENTE
  for (const [clienteId, facturasCliente] of Object.entries(facturasPorCliente)) {
    const cliente = await obtenerCliente(clienteId);
    if (!cliente) continue;
    
    // 🚫 VERIFICAR LISTA NEGRA
    if (clienteEstaBloqueado(cliente)) {
      saltados++;
      continue;
    }
    
    if (!clienteDebeRecibirMensajes(cliente)) continue;
    
    const tieneServicioActivo = await clienteTieneServicioActivo(cliente.id, cliente);
    if (!tieneServicioActivo) continue;
    
    // ✅ VERIFICAR SI YA SE ENVIÓ HOY (por cliente, no por factura)
    if (yaSeEnvioHoy(cliente.id, null, 1)) {
      saltados++;
      continue;
    }

    const telefono = cliente.contacts?.[0]?.phone;
    if (!telefono) continue;

    // ✅ PASO 3: CONSTRUIR MENSAJE CON TODAS LAS FACTURAS
    const primerNombre = cliente.firstName.split(' ')[0];
    let mensaje = `⏰ Hola ${primerNombre},\n\n`;
    
    if (facturasCliente.length === 1) {
      mensaje += `Tu pago del mes vence *MAÑANA*.\n\n`;
    } else {
      mensaje += `Tus ${facturasCliente.length} recibos vencen *MAÑANA*.\n\n`;
    }
    
    mensaje += `📋 *FACTURAS PENDIENTES:*\n`;
    
    let totalGeneral = 0;
    
    // Listar todas las facturas
    for (let i = 0; i < facturasCliente.length; i++) {
      const factura = facturasCliente[i];
      const mes = obtenerNombreMes(factura.dueDate);
      const monto = Number(factura.amountToPay || factura.total || 0);
      totalGeneral += monto;
      
      mensaje += `${i + 1}. Factura ${factura.number} (${mes})\n`;
      mensaje += `   💰 S/ ${monto.toFixed(2)}\n`;
      mensaje += `   📅 Vence: ${formatearFecha(factura.dueDate)}\n\n`;
    }
    
    mensaje += `━━━━━━━━━━━━━━━━\n`;
    mensaje += `💰 *TOTAL: S/ ${totalGeneral.toFixed(2)}*\n\n`;
    
    mensaje += `Puedes pagar en:\n\n`;
    mensaje += `💳 *YAPE:* ${CONFIG.CUENTAS_PAGO.yape}\n`;
    mensaje += `🏦 *CTA CTE. SCOTIABANK:* ${CONFIG.CUENTAS_PAGO.scotiabank}\n`;
    mensaje += `🏦 *CTA AHORROS BCP:* ${CONFIG.CUENTAS_PAGO.bcp}\n`;
    mensaje += `👤 *${CONFIG.CUENTAS_PAGO.nombre_titular}*\n\n`;
    
    mensaje += `Cuando pagues, dime *"Ya pagué"* con tu comprobante 📸\n\n`;
    mensaje += `¡Gracias por tu puntualidad! 😊`;

    console.log(`\n📤 (${enviados + 1}) ${cliente.firstName} ${cliente.lastName}`);
    console.log(`   ⏰ ${facturasCliente.length} factura(s) - Vence MAÑANA - S/ ${totalGeneral.toFixed(2)}`);
    
    // ✅ PASO 4: ENVIAR MENSAJE
    const enviado = await enviarWhatsApp(telefono, mensaje);
    
    if (!enviado) {
      console.log(`   ❌ Error enviando mensaje`);
      continue;
    }
    
    console.log(`   ✅ Mensaje enviado`);
    
    // ✅ PASO 5: ENVIAR PDFs DE TODAS LAS FACTURAS
    let pdfEnviados = 0;
    
    for (const factura of facturasCliente) {
      try {
        await sleep(3000); // 3 segundos entre PDFs
        
        console.log(`   📄 Enviando PDF factura ${factura.number}...`);
        const pdfBuffer = await descargarPDFFacturaBuffer(factura.id);
        
        if (pdfBuffer) {
          const numeroLimpio = limpiarTelefono(telefono);
          const chatId = `${numeroLimpio}@c.us`;
          const base64Data = pdfBuffer.toString('base64');
          
         const media = new MessageMedia('application/pdf', base64Data, `factura_${factura.numero}.pdf`);
await whatsappClient.sendMessage(chatId, media);
          
          console.log(`   ✅ PDF enviado: ${factura.number}`);
          pdfEnviados++;
        }
      } catch (error) {
        console.error(`   ❌ Error con PDF ${factura.number}:`, error.message);
      }
    }
    
    console.log(`   📊 PDFs enviados: ${pdfEnviados}/${facturasCliente.length}`);
    
    // ✅ MARCAR COMO ENVIADO (1 vez por cliente)
    marcarMensajeEnviado(cliente.id, null, 1);
    
    await agregarNotaCliente(
      cliente.id,
      `⏰ Recordatorio previo - ${facturasCliente.length} factura(s) - Vence MAÑANA - S/ ${totalGeneral.toFixed(2)} - ${pdfEnviados} PDFs`
    );
    
    enviados++;
    console.log(`   ✅ Completado\n`);
    
    if (enviados < Object.keys(facturasPorCliente).length) {
      await sleep(CONFIG.DELAY_RECORDATORIOS_DEUDA);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Enviados: ${enviados} | Saltados: ${saltados}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// ========================================
// VERIFICACION DE PAGOS
// ========================================
// ==================== VERIFICACION DE PAGOS ====================
async function verificarPagoCliente(telefono, client, pedirVoucher = false) {
  try {
    const cliente = await buscarClientePorTelefono(telefono);
    
    if (!cliente) {
      const numeroLimpio = limpiarTelefono(telefono);
      const chatId = `${numeroLimpio}@c.us`;
      await client.sendMessage(chatId, "Lo siento, no encontramos tu cuenta. Contacta a soporte.");
      return;
    }

    const pagos = await buscarPagosCliente(cliente.id, 7);
    
    if (pagos.length > 0) {
      // ✅ CLIENTE SÍ TIENE PAGOS REGISTRADOS
      const ultimoPago = pagos[0];
      
      const respuesta = `✅ Hola ${cliente.firstName}!

Confirmamos tu pago de S/ ${Number(ultimoPago.amount).toFixed(2)}
📅 Fecha: ${formatearFecha(ultimoPago.createdDate)}

¡Gracias por tu puntualidad! 😊`;
      
      const numeroLimpio = limpiarTelefono(telefono);
      const chatId = `${numeroLimpio}@c.us`;
      await client.sendMessage(chatId, respuesta);

      // ✅ Nota actualizada (el PDF ya se envió automáticamente por el monitor)
      await agregarNotaCliente(
        cliente.id,
        `Cliente escribió "Ya pagué" - Pago confirmado S/ ${ultimoPago.amount}`
      );

    } else {
      // ❌ NO HAY PAGO REGISTRADO - PEDIR COMPROBANTE
      let respuesta = `⏳ Hola ${cliente.firstName},\n\n`;
respuesta += `Aún no vemos tu pago registrado.\n\n`;
respuesta += `📸 Por favor envíame una FOTO de tu comprobante de pago.\n\n`;
respuesta += `Verifica que:\n`;
respuesta += `• Hayan pasado al menos 10 minutos\n`;
respuesta += `• El pago sea a nuestras cuentas oficiales`;
      
      const numeroLimpio = limpiarTelefono(telefono);
      const chatId = `${numeroLimpio}@c.us`;
      await client.sendMessage(chatId, respuesta);

      // Notificar al admin
      await agregarNotaCliente(
        cliente.id,
        `Cliente reportó pago pero no hay registro`
      );

      const notificacionAdmin = `⚠️ CLIENTE REPORTA PAGO SIN REGISTRO\n\n` +
        `${cliente.firstName} ${cliente.lastName}\n` +
        `ID: ${cliente.id}\n` +
        `📱 ${telefono}\n\n` +
        `Cliente dice "Ya pagué" pero no hay pago en el sistema.\n` +
        `Toca el número para contactarlo.`;
      
      await enviarWhatsApp(CONFIG.PHONE_NOTIFICACIONES, notificacionAdmin);
    }

  } catch (error) {
    console.error("Error verificando pago:", error.message);
    // ⚠️ NO enviar mensaje de error al cliente
  }
}

// ========================================
// CONSULTAR DEUDA DEL CLIENTE
// ========================================
async function consultarDeudaCliente(telefono, chat) {
  try {
    const cliente = await buscarClientePorTelefono(telefono);
    
    if (!cliente) {
      await chat.sendMessage('Lo siento, no encontramos tu cuenta. Contacta a soporte.');
      return;
    }
    
    console.log(`   🔍 Consultando deuda de ${cliente.firstName}...`);
    
    const { facturas, total } = await obtenerDeudaCliente(cliente.id);
    
    if (facturas.length === 0) {
      await chat.sendMessage(
        `✅ ¡Excelente ${cliente.firstName}!

No tienes deudas pendientes. 🎉

Gracias por estar al día con tus pagos. 😊`
      );
      return;
    }
    
    let respuesta = `💰 Hola ${cliente.firstName}\n\n`;
    respuesta += `Tu deuda actual es:\n\n`;
    
    for (const factura of facturas) {
      const estado = factura.dias < 0 
        ? `⚠️ vencida hace ${Math.abs(factura.dias)} días` 
        : factura.dias === 0 
          ? `⚠️ vence HOY` 
          : `📅 vence en ${factura.dias} días`;
      
      respuesta += `📋 Factura ${factura.numero}\n`;
      respuesta += `   💵 S/ ${factura.monto.toFixed(2)}\n`;
      respuesta += `   ${estado}\n\n`;
    }
    
    respuesta += `━━━━━━━━━━━━━━\n`;
    respuesta += `💰 *TOTAL: S/ ${total.toFixed(2)}*\n\n`;
    
    respuesta += `Puedes pagar en:\n\n`;
   respuesta += `💳 *YAPE:* ${CONFIG.CUENTAS_PAGO.yape}\n\n`;
   respuesta += `🏦 *CTA CTE. SCOTIABANK:* ${CONFIG.CUENTAS_PAGO.scotiabank}\n\n`;
   respuesta += `🏦 *CTA AHORROS BCP:* ${CONFIG.CUENTAS_PAGO.bcp}\n\n`;
   respuesta += `👤 *${CONFIG.CUENTAS_PAGO.nombre_titular}*\n\n`;
   respuesta += `Cuando pagues, envía tu COMPROBANTE 📸 y escribe *"Ya pagué"*`;
    
    
    await chat.sendMessage(respuesta);
    
    console.log(`   ✅ Deuda consultada: S/ ${total.toFixed(2)}`);
    
  } catch (error) {
    console.error('❌ Error consultando deuda:', error.message);
    await chat.sendMessage('⚠️ Error consultando tu deuda. Por favor intenta nuevamente.');
  }
}
// ========================================
// RESUMEN DIARIO
// ========================================
async function enviarResumenDiario() {
  try {
    console.log('\n📊 GENERANDO RESUMEN DIARIO...');
    
    const facturas = await obtenerFacturasSinPagar();
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    
    const response = await axios.get(`${CONFIG.UCRM_URL}/api/v1.0/payments`, {
      headers: { 'X-Auth-App-Key': CONFIG.UCRM_API_KEY },
      params: {
        createdDateFrom: hoy.toISOString().split('T')[0],
        limit: 100
      },
      httpsAgent
    });
    
    const pagosHoy = Array.isArray(response.data) ? response.data : [];
    
    const vencenHoy = facturas.filter(f => diasParaVencer(f.dueDate) === 0);
    const enDeuda = facturas.filter(f => diasParaVencer(f.dueDate) < 0);
    
    let resumen = `📊 *RESUMEN DIARIO*\n`;
    resumen += `📅 ${formatearFecha(new Date())}\n\n`;
    
    resumen += `✅ *PAGOS RECIBIDOS HOY:* ${pagosHoy.length}\n`;
    if (pagosHoy.length > 0) {
      let totalPagado = 0;
      for (const pago of pagosHoy.slice(0, 5)) {
        const cliente = await obtenerCliente(pago.clientId);
        if (cliente) {
          resumen += `   • ${cliente.firstName} ${cliente.lastName}: S/ ${Number(pago.amount).toFixed(2)}\n`;
          totalPagado += Number(pago.amount);
        }
      }
      resumen += `   💰 *Total:* S/ ${totalPagado.toFixed(2)}\n`;
    } else {
      resumen += `   (No se recibieron pagos)\n`;
    }
    
    resumen += `\n⚠️  *FACTURAS QUE VENCEN HOY:* ${vencenHoy.length}\n`;
    
    resumen += `\n🚨 *FACTURAS EN DEUDA:* ${enDeuda.length}\n`;
    if (enDeuda.length > 0) {
      const topDeuda = enDeuda
        .map(f => ({
          ...f,
          diasDeuda: Math.floor((hoy - new Date(f.dueDate)) / (1000 * 60 * 60 * 24))
        }))
        .sort((a, b) => b.diasDeuda - a.diasDeuda)
        .slice(0, 5);
      
      for (const factura of topDeuda) {
        const cliente = await obtenerCliente(factura.clientId);
        if (cliente) {
          resumen += `   • ${cliente.firstName}: ${factura.diasDeuda} días - S/ ${Number(factura.amountToPay || factura.total || 0).toFixed(2)}\n`;
        }
      }
    } else {
      resumen += `   ¡Ninguna! 🎉\n`;
    }
    
    resumen += `\n📈 *ESTADÍSTICAS:*\n`;
    resumen += `   Total pendientes: ${facturas.length}\n`;
    resumen += `   Facturas al día: ${facturas.length - enDeuda.length}\n`;
    resumen += `   Facturas en deuda: ${enDeuda.length}\n`;
    
    await enviarWhatsApp(CONFIG.PHONE_NOTIFICACIONES, resumen);
    await enviarEmail(
      CONFIG.ADMIN_EMAIL,
      `📊 Resumen Diario - ${formatearFecha(new Date())}`,
      resumen.replace(/\*/g, '')
    );
    
    console.log('✅ Resumen enviado\n');
    
  } catch (error) {
    console.error('❌ Error generando resumen:', error.message);
  }
}

// ========================================
// SERVIDOR HTTP
// ========================================
const app = express();
const PORT = 3000;

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    whatsapp: whatsappReady,
    vouchers: fs.readdirSync(CONFIG.VOUCHERS_DIR).length,
    timestamp: new Date().toISOString()
  });
});

app.get('/vouchers', (req, res) => {
  const vouchers = fs.readdirSync(CONFIG.VOUCHERS_DIR)
    .filter(f => f.endsWith('.jpg'))
    .map(f => ({
      nombre: f,
      fecha: fs.statSync(path.join(CONFIG.VOUCHERS_DIR, f)).mtime
    }))
    .sort((a, b) => b.fecha - a.fecha);
  
  res.json({ total: vouchers.length, vouchers });
});

app.get('/shutdown', async (req, res) => {
  res.json({ message: 'Apagando sistema...', status: 'OK' });
  setTimeout(async () => {
    guardarMensajesEnviados();
    guardarPagosProcesados();
    guardarCicloActual(); // ✅ NUEVO
    if (whatsappClient) await whatsappClient.destroy();
    process.exit(0);
  }, 2000);
});
// ========================================
// ENDPOINTS DE CICLOS
// ========================================
app.get('/ciclo', (req, res) => {
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
      totalClientes: colaRecordatorios.clientes.length,
      porcentajeCompletado: colaRecordatorios.clientes.length > 0 
        ? ((cicloActual.clientesEnviados.length / colaRecordatorios.clientes.length) * 100).toFixed(1) 
        : 0,
      cicloCompletado: cicloActual.cicloCompletado,
      proximoReinicio: cicloActual.inicioCiclo 
        ? new Date(new Date(cicloActual.inicioCiclo).getTime() + CONFIG.DIAS_ENTRE_RECORDATORIOS * 24 * 60 * 60 * 1000).toISOString()
        : null
    }
  });
});

app.get('/reiniciar-ciclo', (req, res) => {
  reiniciarCiclo();
  res.json({ 
    message: 'Ciclo reiniciado manualmente', 
    nuevoCiclo: cicloActual 
  });
});

// ========================================
// 🆕 NUEVO ENDPOINT: VERIFICAR COLA
// ========================================
// ========================================
// 🆕 ENDPOINT: VERIFICAR COLA (CORREGIDO)
// ========================================
app.get('/verificar-cola', async (req, res) => {
  try {
    const verificacion = [];
    const limite = req.query.limit ? parseInt(req.query.limit) : 10;
    
    console.log(`\n🔍 Verificando estado de ${limite} clientes en cola...`);
    
    for (const item of colaRecordatorios.clientes.slice(0, limite)) {
      // ✅ Verificar todas las facturas del cliente
      const facturasVerificadas = [];
      
      for (const facturaInfo of item.facturas) {
        const factura = await obtenerFactura(facturaInfo.id);
        
        let estadoReal;
        if (factura) {
          const statusNombres = {
            0: 'BORRADOR',
            1: 'PENDIENTE',
            2: 'PAGO PARCIAL',
            3: 'PAGADA'
          };
          
          estadoReal = {
            status: factura.status,
            statusNombre: statusNombres[factura.status] || `DESCONOCIDO (${factura.status})`,
            montoPendiente: Number(factura.amountToPay || factura.toPay || 0),
            montoTotal: Number(factura.total || 0),
            fechaVencimiento: factura.dueDate,
            numero: factura.number
          };
        } else {
          estadoReal = { 
            error: 'Factura no encontrada en UCRM' 
          };
        }
        
        facturasVerificadas.push({
          facturaId: facturaInfo.id,
          numero: facturaInfo.numero,
          montoEnCola: facturaInfo.monto,
          estadoReal: estadoReal
        });
      }
      
      verificacion.push({
        cliente: item.nombre,
        clienteId: item.clienteId,
        cantidadFacturas: item.cantidadFacturas,
        diasDeuda: item.diasDeuda,
        totalEnCola: item.monto,
        ultimoEnvio: item.ultimoEnvio,
        intentos: item.intentos,
        facturas: facturasVerificadas
      });
    }
    
    // Contar problemas
    let facturasNoEncontradas = 0;
    let facturasPagadas = 0;
    let facturasParcialesPagadas = 0;
    let sinSaldoPendiente = 0;
    
    for (const item of verificacion) {
      for (const factura of item.facturas) {
        if (factura.estadoReal.error) facturasNoEncontradas++;
        if (factura.estadoReal.status === 3) facturasPagadas++;
        if (factura.estadoReal.status === 2) facturasParcialesPagadas++;
        if (factura.estadoReal.montoPendiente === 0) sinSaldoPendiente++;
      }
    }
    
    const problemas = {
      facturasNoEncontradas,
      facturasPagadas,
      facturasParcialesPagadas,
      sinSaldoPendiente
    };
    
    const tieneProblemas = Object.values(problemas).some(v => v > 0);
    
    res.json({
      timestamp: new Date().toISOString(),
      totalEnCola: colaRecordatorios.clientes.length,
      clientesVerificados: verificacion.length,
      problemas: problemas,
      alerta: tieneProblemas ? '⚠️ Se encontraron facturas que NO deberían estar en cola' : '✅ Todo correcto',
      muestra: verificacion,
      recomendacion: tieneProblemas 
        ? 'Ejecuta: http://localhost:3000/limpiar-cola para eliminar facturas pagadas'
        : 'La cola está limpia'
    });
    
  } catch (error) {
    res.status(500).json({
      error: 'Error verificando cola',
      mensaje: error.message
    });
  }
});


// ========================================
// 🆕 NUEVO ENDPOINT: LIMPIAR COLA MANUALMENTE
// ========================================
// ========================================
// 🆕 ENDPOINT: LIMPIAR COLA (CORREGIDO)
// ========================================
app.get('/limpiar-cola', async (req, res) => {
  try {
    console.log('\n🧹 Limpiando cola manualmente...');
    
    const colaOriginal = colaRecordatorios.clientes.length;
    const eliminados = [];
    const conservados = [];
    
    for (const item of colaRecordatorios.clientes) {
      // ✅ Verificar TODAS las facturas del cliente
      let facturasValidas = [];
      let totalDeudaActualizada = 0;
      let diasDeudaMax = -Infinity;
      
      for (const facturaInfo of item.facturas) {
        const factura = await obtenerFactura(facturaInfo.id);
        
        if (!factura) {
          eliminados.push({
            cliente: item.nombre,
            facturaId: facturaInfo.id,
            numero: facturaInfo.numero,
            razon: 'Factura no encontrada'
          });
          continue;
        }
        
        if (factura.status !== 1) {
          eliminados.push({
            cliente: item.nombre,
            facturaId: facturaInfo.id,
            numero: factura.number,
            razon: factura.status === 3 ? 'Factura pagada' : 'Estado no pendiente'
          });
          continue;
        }
        
        const montoPendiente = Number(factura.amountToPay || factura.toPay || 0);
        if (montoPendiente <= 0) {
          eliminados.push({
            cliente: item.nombre,
            facturaId: facturaInfo.id,
            numero: factura.number,
            razon: 'Sin saldo pendiente'
          });
          continue;
        }
        
        // ✅ Factura válida
        const vencimiento = new Date(factura.dueDate);
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        vencimiento.setHours(0, 0, 0, 0);
        
        const diasDeuda = Math.floor((hoy - vencimiento) / (1000 * 60 * 60 * 24));
        
        if (diasDeuda > diasDeudaMax) {
          diasDeudaMax = diasDeuda;
        }
        
        totalDeudaActualizada += montoPendiente;
        facturasValidas.push({
          id: factura.id,
          numero: factura.number,
          monto: montoPendiente,
          vencimiento: factura.dueDate,
          mes: obtenerNombreMesCompleto(factura.dueDate)
        });
      }
      
      // Si el cliente tiene al menos 1 factura válida, conservarlo
      if (facturasValidas.length > 0) {
        conservados.push({
          ...item,
          facturas: facturasValidas,
          cantidadFacturas: facturasValidas.length,
          diasDeuda: diasDeudaMax,
          totalDeuda: totalDeudaActualizada,
          monto: totalDeudaActualizada
        });
      } else {
        // Cliente sin facturas válidas
        eliminados.push({
          cliente: item.nombre,
          clienteId: item.clienteId,
          razon: 'Todas las facturas fueron eliminadas'
        });
      }
    }
    
    colaRecordatorios.clientes = conservados;
    guardarColaRecordatorios();
    
    console.log(`   ✅ Limpieza completada: ${eliminados.length} facturas eliminadas, ${conservados.length} clientes conservados\n`);
    
    res.json({
      mensaje: '🧹 Limpieza completada',
      estadisticas: {
        totalOriginal: colaOriginal,
        clientesConservados: conservados.length,
        facturasEliminadas: eliminados.length
      },
      detalleEliminados: eliminados,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      error: 'Error limpiando cola',
      mensaje: error.message
    });
  }
});



app.listen(PORT, () => {
  console.log(`\n🌐 Servidor: http://localhost:${PORT}`);
  console.log(`   Health: /health`);
  console.log(`   Vouchers: /vouchers`);
  console.log(`   Shutdown: /shutdown\n`);
});

// ========================================
// INICIALIZACIÓN
// ========================================
console.log('\n╔═══════════════════════════════════════════╗');
console.log('║   SISTEMA UCRM v4.1 - CICLOS INTELIGENTES ║');
console.log('╚═══════════════════════════════════════════╝\n');

cargarMensajesEnviados();
cargarPagosProcesados();
cargarColaRecordatorios();
cargarCicloActual();
limpiarMensajesAntiguos();
limpiarPagosAntiguos();

const waitForWhatsApp = setInterval(() => {
  if (whatsappReady) {
    clearInterval(waitForWhatsApp);
    iniciarSistema();
  }
}, 2000);

// ========================================
// INICIAR SISTEMA
// ========================================
function iniciarSistema() {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║        ✅ SISTEMA LISTO                   ║');
  console.log('╚═══════════════════════════════════════════╝\n');
  console.log('📋 FUNCIONALIDADES ACTIVAS:\n');
  console.log('   ✅ Recordatorio 1 día ANTES del vencimiento (6-8 PM)');
  console.log('   ✅ Recordatorios de DEUDA CONTINUOS (0-60 días)');
  console.log('       → Horario: 8 AM - 6 PM (cada 10 min)');
  console.log('       → Máximo 1 mensaje cada 4 días por cliente');
  console.log('   ✅ Monitor de pagos (cada 5 min)');
  console.log('   ✅ Confirmación automática + PDF de recibo');
  console.log('   ✅ OCR de vouchers (Tesseract.js)');
  console.log('   ✅ Respuestas automáticas inteligentes');
  console.log('   ✅ Resumen diario (6 PM por WhatsApp y email)');
  console.log('   ✅ Validación de clientes ACTIVOS y SUSPENDIDOS');
  console.log('   ✅ PDFs en memoria (sin guardar en disco)');
  console.log('   ✅ Sistema de tracking (evita duplicados)\n');

  // 1. Monitor de pagos (cada 5 minutos)
  // 1. Monitor de pagos (cada 5 minutos) - SIN DUPLICADOS
  setTimeout(() => {
    monitorearPagosNuevos(); // Primera ejecución
    setInterval(() => {
      monitorearPagosNuevos();
    }, CONFIG.INTERVALO_MONITOR_PAGOS);
  }, 30000);

  // 2. Recordatorios previos (6 PM - 8 PM)
  programarRecordatoriosPrevios();

  // 3. Recordatorios de deuda (8 AM - 6 PM)
  programarRecordatoriosDeuda();

  // 4. Resumen diario (6 PM)
  const ahoraResumen = new Date();
  const proximoResumen = new Date();
  proximoResumen.setHours(18, 0, 0, 0);
  
  if (ahoraResumen >= proximoResumen) {
    proximoResumen.setDate(proximoResumen.getDate() + 1);
  }

  setTimeout(() => {
    enviarResumenDiario();
    setInterval(enviarResumenDiario, 24 * 60 * 60 * 1000);
  }, proximoResumen - ahoraResumen);

  console.log(`🔍 Monitor de pagos: cada 5 minutos\n`);
  console.log('🌐 Sistema optimizado para servidor 24/7\n');
}

// ========================================
// PROGRAMAR RECORDATORIOS PREVIOS
// ========================================
function programarRecordatoriosPrevios() {
  const ahora = new Date();
  const horaActual = ahora.getHours();
  
  if (horaActual >= CONFIG.HORA_INICIO_PREVIOS && horaActual < CONFIG.HORA_FIN_PREVIOS) {
    console.log('⚡ Sistema iniciado dentro del horario - Ejecutando recordatorios previos AHORA');
    procesarRecordatoriosPrevios();
  } else {
    const proximaEjecucion = new Date();
    
    if (horaActual >= CONFIG.HORA_FIN_PREVIOS) {
      proximaEjecucion.setDate(proximaEjecucion.getDate() + 1);
    }
    
    proximaEjecucion.setHours(CONFIG.HORA_INICIO_PREVIOS, 0, 0, 0);
    
    const msHasta = proximaEjecucion - ahora;
    
    console.log(`⏰ Recordatorios previos programados para: ${proximaEjecucion.toLocaleString('es-PE')}`);
    
    setTimeout(() => {
      procesarRecordatoriosPrevios();
      setInterval(procesarRecordatoriosPrevios, 24 * 60 * 60 * 1000);
    }, msHasta);
  }
}

// ========================================
// PROGRAMAR RECORDATORIOS DE DEUDA
// ========================================
function programarRecordatoriosDeuda() {
  const ahora = new Date();
  const horaActual = ahora.getHours();
  
  if (horaActual >= CONFIG.HORA_INICIO_DEUDA && horaActual < CONFIG.HORA_FIN_DEUDA) {
    console.log('⚡ Sistema iniciado dentro del horario - Comenzando ciclo AHORA');
    iniciarCicloRecordatoriosDeuda();
  } else {
    const proximaEjecucion = new Date();
    
    if (horaActual >= CONFIG.HORA_FIN_DEUDA) {
      proximaEjecucion.setDate(proximaEjecucion.getDate() + 1);
    }
    
    proximaEjecucion.setHours(CONFIG.HORA_INICIO_DEUDA, 0, 0, 0);
    
    const msHasta = proximaEjecucion - ahora;
    
    console.log(`⏰ Recordatorios de deuda programados para: ${proximaEjecucion.toLocaleString('es-PE')}`);
    
    setTimeout(() => {
      iniciarCicloRecordatoriosDeuda();
      setInterval(iniciarCicloRecordatoriosDeuda, 24 * 60 * 60 * 1000);
    }, msHasta);
  }
}

// ========================================
// INICIAR CICLO DE RECORDATORIOS
// ========================================
async function iniciarCicloRecordatoriosDeuda() {
  const horaFin = new Date();
  horaFin.setHours(CONFIG.HORA_FIN_DEUDA, 0, 0, 0);
  
  console.log('\n🚀 ═══════════════════════════════════════');
  console.log('   CICLO DE RECORDATORIOS DE DEUDA INICIADO');
  console.log(`   Horario: ${CONFIG.HORA_INICIO_DEUDA}:00 - ${CONFIG.HORA_FIN_DEUDA}:00`);
  console.log(`   Intervalo: cada 10 minutos`);
  console.log('═══════════════════════════════════════\n');
  
  // Ejecutar inmediatamente
  await procesarRecordatoriosDeuda();
  
  // Repetir cada 10 minutos hasta las 6 PM
  const intervalo = setInterval(async () => {
    const ahora = new Date();
    
    if (ahora >= horaFin) {
      clearInterval(intervalo);
      console.log('\n✓ Ciclo de recordatorios completado por hoy (6 PM alcanzado)');
      
      const manana = new Date();
      manana.setDate(manana.getDate() + 1);
      manana.setHours(CONFIG.HORA_INICIO_DEUDA, 0, 0, 0);
      
      const msHastaManana = manana - ahora;
      
      setTimeout(() => {
        iniciarCicloRecordatoriosDeuda();
      }, msHastaManana);
      
      return;
    }
    
    await procesarRecordatoriosDeuda();
  }, CONFIG.DELAY_RECORDATORIOS_DEUDA);
}

// ========================================
// PROCESAR RECORDATORIOS DE DEUDA
// ========================================
// ========================================
// PROCESAR RECORDATORIOS DE DEUDA - CORREGIDO
// ========================================

async function procesarRecordatoriosDeuda() {
  // 🔒 BLOQUEO: Verificar si ya hay un proceso en ejecución
  if (procesandoRecordatorios) {
    console.log('\n⏸️  Proceso anterior aún en curso - Saltando esta iteración\n');
    return;
  }
  
  // 🔒 ACTIVAR BLOQUEO
  procesandoRecordatorios = true;
  
  if (!whatsappReady) {
    procesandoRecordatorios = false;
    return;
  }
  
  const ahora = new Date();
  const hora = ahora.getHours();
  
  if (hora < CONFIG.HORA_INICIO_DEUDA || hora >= CONFIG.HORA_FIN_DEUDA) {
    procesandoRecordatorios = false;
    return;
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`⚠️  RECORDATORIOS INTELIGENTES - ${ahora.toLocaleTimeString('es-PE')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const ultimaActualizacion = colaRecordatorios.ultimaActualizacion 
    ? new Date(colaRecordatorios.ultimaActualizacion) 
    : null;
  
  if (!ultimaActualizacion || (ahora - ultimaActualizacion) > 60 * 60 * 1000) {
    await actualizarColaRecordatorios();
  }
  
  if (colaRecordatorios.clientes.length === 0) {
    console.log('✓ No hay clientes en deuda\n');
    procesandoRecordatorios = false;
    return;
  }
  
  if (cicloActual.inicioCiclo) {
    const diasDesdeInicio = (ahora - new Date(cicloActual.inicioCiclo)) / (1000 * 60 * 60 * 24);
    
    if (diasDesdeInicio >= CONFIG.DIAS_ENTRE_RECORDATORIOS) {
      console.log(`♻️  Ciclo completado (${Math.floor(diasDesdeInicio)} días) - REINICIANDO\n`);
      reiniciarCiclo();
    }
  }
  
  if (!cicloActual.inicioCiclo) {
    reiniciarCiclo();
  }
  
  if (cicloActual.cicloCompletado) {
    const diasDesdeInicio = (ahora - new Date(cicloActual.inicioCiclo)) / (1000 * 60 * 60 * 24);
    const diasRestantes = CONFIG.DIAS_ENTRE_RECORDATORIOS - diasDesdeInicio;
    
    console.log(`⏸️  Ciclo completado - Esperando ${diasRestantes.toFixed(1)} días más\n`);
    console.log(`   Total enviados en este ciclo: ${cicloActual.clientesEnviados.length}`);
    console.log(`   Próximo reinicio: ${new Date(new Date(cicloActual.inicioCiclo).getTime() + CONFIG.DIAS_ENTRE_RECORDATORIOS * 24 * 60 * 60 * 1000).toLocaleString('es-PE')}\n`);
    procesandoRecordatorios = false;
    return;
  }
  
  let clientesRevisados = 0;
  let clientesYaEnviados = 0;

  for (const item of colaRecordatorios.clientes) {
    clientesRevisados++;
    
    // 🔒 ANTI-DUPLICADO: Verificar en ciclo actual
    if (cicloActual.clientesEnviados.includes(item.clienteId)) {
      clientesYaEnviados++;
      continue;
    }
    
    // 🔒 ANTI-DUPLICADO: Verificar si ya se envió HOY
    if (yaSeEnvioHoy(item.clienteId, null, item.diasDeuda)) {
      console.log(`   ⏭️  Ya enviado hoy: ${item.nombre}`);
      clientesYaEnviados++;
      continue;
    }
    
    const cliente = await obtenerCliente(item.clienteId);
    if (!cliente) {
      console.log(`   ⚠️  Cliente ID ${item.clienteId} no encontrado - Saltando`);
      continue;
    }
    
    if (clienteEstaBloqueado(cliente)) {
      clientesYaEnviados++;
      continue;
    }

    // ✅ NUEVO: Verificar si el cliente ya pagó HOY antes de enviar recordatorio
    const pagosRecientes = await buscarPagosCliente(item.clienteId, 1); // últimas 24h
    if (pagosRecientes.length > 0) {
      console.log(`   ✅ ${item.nombre} ya pagó - SALTANDO recordatorio de deuda`);
      cicloActual.clientesEnviados.push(item.clienteId);
      guardarCicloActual();
      clientesYaEnviados++;
      continue;   // ← ✅ CONTINÚA con el siguiente cliente
    }
    
    console.log(`\n📤 ${item.nombre}`);
    console.log(`   📊 ${item.cantidadFacturas} factura(s) - ${item.diasDeuda} días - S/ ${item.monto.toFixed(2)}`);
    console.log(`   📊 Progreso: ${cicloActual.clientesEnviados.length + 1}/${colaRecordatorios.clientes.length}`);
    
    // ============================================
    // 🔒 MARCAR COMO ENVIADO **ANTES** DE ENVIAR
    // ============================================
    cicloActual.clientesEnviados.push(item.clienteId);
    marcarMensajeEnviado(item.clienteId, null, item.diasDeuda);
    guardarCicloActual();
    guardarMensajesEnviados();
    console.log(`   🔖 Cliente marcado como notificado (protección anti-duplicado)`);
    
    // ============================================
    // ✅ CONSTRUCCIÓN DEL MENSAJE - FORMATO VISUAL
    // ============================================
    const primerNombre = item.nombre.split(' ')[0];

    let mensaje = `¡Hola, ${primerNombre}! 😊\n\n`;
    mensaje += `Espero que te encuentres muy bien.\n`;

    // 🔹 CASO 1: SOLO 1 RECIBO
    if (item.cantidadFacturas === 1) {
        const factura = item.facturas[0];
        mensaje += `Le escribo para recordarle que tiene un recibo pendiente:\n`;
        
        // Días de retraso
        if (item.diasDeuda > 1) {
            mensaje += `De ${item.diasDeuda} días de retraso\n\n`;
        } else if (item.diasDeuda === 1) {
            mensaje += `De 1 día de retraso\n\n`;
        } else {
            mensaje += `Que vence HOY\n\n`;
        }
        
        mensaje += `📄 *RECIBO*:\n`;
        mensaje += `1. Factura Recibo -${factura.numero} (${factura.mes}): S/ ${factura.monto.toFixed(2)}\n\n`;
        mensaje += `⚠️ *Total a regularizar: S/ ${item.monto.toFixed(2)}*\n`;
        
        // Días de deuda
        if (item.diasDeuda > 1) {
            mensaje += `⚠️ *${item.diasDeuda} días de retraso*\n\n`;
        } else if (item.diasDeuda === 1) {
            mensaje += `⚠️ *1 día de retraso*\n\n`;
        } else {
            mensaje += `⚠️ *Vence HOY*\n\n`;
        }
    }
    // 🔹 CASO 2: VARIAS FACTURAS
    else {
        mensaje += `Le escribo para hacerle recordar que tiene ${item.cantidadFacturas} recibos pendientes:\n`;
        
        // Días de retraso
        if (item.diasDeuda > 1) {
            mensaje += `De ${item.diasDeuda} días de retraso\n\n`;
        } else if (item.diasDeuda === 1) {
            mensaje += `De 1 día de retraso\n\n`;
        } else {
            mensaje += `Que vencen HOY\n\n`;
        }
        
        mensaje += `📄 *FACTURAS PENDIENTES*:\n`;
        for (let i = 0; i < item.facturas.length; i++) {
            const factura = item.facturas[i];
            mensaje += `${i + 1}. Factura Recibo -${factura.numero}\n`;
            mensaje += `📅 ${factura.mes}\n`;
            mensaje += `💰 S/ ${factura.monto.toFixed(2)}\n\n`;
        }
        
        mensaje += `💰 *TOTAL: S/ ${item.monto.toFixed(2)}*\n\n`;
    }

    mensaje += `Para evitar cualquier inconveniente con tu servicio, te agradecería mucho que puedas realizar el pago a la brevedad.\n`;
    mensaje += `Puedes hacerlo de forma rápida y segura por:\n\n`;

    mensaje += `Puedes pagar en:\n`;
    mensaje += `📱 Yape: *${CONFIG.CUENTAS_PAGO.yape}*\n`;
    mensaje += `🏦 Scotiabank (Cta Cte): *${CONFIG.CUENTAS_PAGO.scotiabank}*\n`;
    mensaje += `🏦 BCP (Cta Ahorros): *${CONFIG.CUENTAS_PAGO.bcp}*\n`;
    mensaje += `A nombre de *${CONFIG.CUENTAS_PAGO.nombre_titular}*\n\n`;

    mensaje += `Una vez pagado, solo envíame un mensaje con "Ya pagué" y el comprobante 📸, para poder confirmarlo de inmediato.\n\n`;
    mensaje += `¡Muchas gracias por tu atención y por tu confianza! 🙏\n`;
    mensaje += `Quedo atenta a cualquier duda.`;

    console.log(`   📨 Enviando mensaje con ${item.cantidadFacturas} factura(s)...`);
    
    // ============================================
    // ✅ ENVIAR UN SOLO MENSAJE DE TEXTO
    // ============================================
    const resultadoMensaje = await enviarWhatsApp(item.telefono, mensaje);
    
    if (!resultadoMensaje) {
      console.log(`   ❌ Error al enviar mensaje - Continuando con siguiente cliente\n`);
      continue;
    }
    
    console.log(`   ✅ Mensaje enviado`);
    
    // ============================================
    // ✅ ENVIAR PDFs DE TODAS LAS FACTURAS
    // ============================================
    let pdfEnviados = 0;
    
    for (const factura of item.facturas) {
      try {
        await sleep(3000);
        
        console.log(`   📄 Descargando PDF de factura ${factura.numero}...`);
        const pdfBuffer = await descargarPDFFacturaBuffer(factura.id);
        
        if (pdfBuffer) {
          const numeroLimpio = limpiarTelefono(item.telefono);
          const chatId = `${numeroLimpio}@c.us`;
          
          const base64Data = pdfBuffer.toString('base64');
          
          const media = new MessageMedia('application/pdf', base64Data, `factura_${factura.numero}.pdf`);
          await whatsappClient.sendMessage(chatId, media);

          console.log(`   ✅ PDF enviado: Factura ${factura.numero}`);

        
          pdfEnviados++;
        } else {
          console.log(`   ⚠️  No se pudo descargar PDF de factura ${factura.numero}`);
        }
        
      } catch (errorPDF) {
        console.error(`   ❌ Error enviando PDF ${factura.numero}:`, errorPDF.message);
      }
    }
    
    console.log(`   📊 PDFs enviados: ${pdfEnviados}/${item.facturas.length}`);
    
    // ============================================
    // ✅ ACTUALIZAR ESTADÍSTICAS
    // ============================================
    item.ultimoEnvio = new Date().toISOString();
    item.intentos++;
    guardarColaRecordatorios();
    
    await agregarNotaCliente(
      item.clienteId,
      `📩 Recordatorio ${item.intentos} - ${item.cantidadFacturas} factura(s) - ${item.diasDeuda} días - S/ ${item.monto.toFixed(2)} - ${pdfEnviados} PDF(s) enviados`
    );
    
    console.log(`   ✅ Completado (intento #${item.intentos})\n`);
    
    // 🔒🔒🔒 VERIFICAR CICLO COMPLETO Y SALIR INMEDIATAMENTE
    if (cicloActual.clientesEnviados.length >= colaRecordatorios.clientes.length) {
      cicloActual.cicloCompletado = true;
      guardarCicloActual();
      console.log(`\n🎉 ¡CICLO COMPLETADO! Enviados todos los ${cicloActual.clientesEnviados.length} clientes`);
      console.log(`⏸️  Esperando ${CONFIG.DIAS_ENTRE_RECORDATORIOS} días antes de reiniciar\n`);
    }
    
    console.log(`🔒 STOP - 1 cliente procesado\n`);
    procesandoRecordatorios = false; // 🔒 LIBERAR BLOQUEO
    return; // ← SALIR COMPLETAMENTE DE LA FUNCIÓN
  }
  
  // Si llegamos aquí, no se procesó ningún cliente
  console.log(`✓ Revisados ${clientesRevisados} clientes`);
  console.log(`✓ Ya enviados en este ciclo: ${clientesYaEnviados}`);
  console.log(`✓ Esperando próximo intervalo\n`);
  procesandoRecordatorios = false; // 🔒 LIBERAR BLOQUEO
}


// ========================================
// MANEJO DE ERRORES Y CIERRE
// ========================================
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Deteniendo sistema...');
  guardarMensajesEnviados();
  guardarPagosProcesados();
  guardarCicloActual(); 
  guardarColaRecordatorios();
  if (whatsappClient) await whatsappClient.destroy();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
  guardarMensajesEnviados();
  guardarPagosProcesados();
  guardarCicloActual();
  guardarColaRecordatorios();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada:', reason);
});

module.exports = {
  procesarRecordatoriosPrevios,
  procesarRecordatoriosDeuda,
  procesarVoucher,
  verificarPagoCliente,
  enviarWhatsApp,
  enviarResumenDiario
};
