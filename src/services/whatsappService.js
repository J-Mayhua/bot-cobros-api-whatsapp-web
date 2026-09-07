// src\services\whatsappService.js
// Envio de mensajes y documentos por WhatsApp.

const { MessageMedia } = require('whatsapp-web.js');
const CONFIG = require('../config');
const { limpiarTelefono } = require('../utils/telefono');
const { sleep } = require('../utils/fechas');
const { enviarEmail } = require('./emailService');

let whatsappClient = null;
let whatsappReady = false;

function setClient(client, ready = true) {
  whatsappClient = client;
  whatsappReady = ready;
}

function setReady(ready) { whatsappReady = ready; }
function getClient() { return whatsappClient; }
function isReady() { return whatsappReady && Boolean(whatsappClient); }

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

module.exports = {
  enviarWhatsApp,
  enviarPDFDesdeMemoria,
  setClient,
  setReady,
  getClient,
  isReady
};
