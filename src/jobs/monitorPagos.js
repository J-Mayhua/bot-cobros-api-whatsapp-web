// src\jobs\monitorPagos.js
// Monitor de pagos nuevos.

const axios = require('axios');
const { MessageMedia } = require('whatsapp-web.js');
const CONFIG = require('../config');
const { formatearFecha, sleep } = require('../utils/fechas');
const { limpiarTelefono } = require('../utils/telefono');
const https = require('https');
const ucrm = require('../services/ucrmClient');
const whatsappService = require('../services/whatsappService');
const state = require('../storage/state');
const { enviarWhatsApp } = whatsappService;
const { obtenerCliente, descargarPDFPagoBuffer, agregarNotaCliente } = ucrm;
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function monitorearPagosNuevos() {
  if (!whatsappService.isReady()) {
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
      if (state.yaSeProcesoPago(pago.id)) continue;
      
      console.log(`\n   💰 Nuevo pago: ID ${pago.id} - ${formatearFecha(pago.createdDate)}`);
      
      const cliente = await obtenerCliente(pago.clientId);
      if (!cliente) {
        state.marcarPagoProcesado(pago.id);
        continue;
      }
      
      const telefono = cliente.contacts?.[0]?.phone;
      if (!telefono) {
        state.marcarPagoProcesado(pago.id);
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
            await whatsappService.getClient().sendMessage(chatId, mediaPDF);
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
      
      state.marcarPagoProcesado(pago.id);
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

module.exports = { monitorearPagosNuevos };
