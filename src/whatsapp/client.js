// src/whatsapp/client.js
// Cliente WhatsApp y handler de mensajes, incluyendo vouchers y consultas.

const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const CONFIG = require('../config');
const { limpiarTelefono } = require('../utils/telefono');
const { formatearFecha } = require('../utils/fechas');
const ucrm = require('../services/ucrmClient');
const whatsappService = require('../services/whatsappService');
const { procesarImagenVoucher } = require('../services/ocrService');
const {
  buscarClientePorTelefono, agregarNotaCliente, buscarPagosCliente,
  obtenerDeudaCliente
} = ucrm;
const { enviarWhatsApp } = whatsappService;
let client = null;
const mensajesProcesados = new Set();
let ultimaLimpiezaMensajes = Date.now();
const ultimasRespuestas = {};
const COOLDOWN_RESPUESTAS = 5 * 60 * 1000;

function puedeResponder(telefono, tipoRespuesta) {
  const clave = `${telefono}_${tipoRespuesta}`;
  const ahora = Date.now();
  if (ultimasRespuestas[clave] && ahora - ultimasRespuestas[clave] < COOLDOWN_RESPUESTAS) return false;
  ultimasRespuestas[clave] = ahora;
  return true;
}

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
            whatsappService.setClient(client);
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
            whatsappService.setReady(false);
        });

        await client.initialize();

    } catch (error) {
        console.error('❌ Error al inicializar WhatsApp:', error.message);
        process.exit(1);
    }

}

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

module.exports = { inicializarWhatsApp, procesarVoucher, verificarPagoCliente, consultarDeudaCliente };
