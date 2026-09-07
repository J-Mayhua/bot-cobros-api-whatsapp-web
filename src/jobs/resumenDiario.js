// src\jobs\resumenDiario.js
// Resumen diario por WhatsApp y correo.

const axios = require('axios');
const https = require('https');
const CONFIG = require('../config');
const { formatearFecha, diasParaVencer } = require('../utils/fechas');
const { obtenerFacturasSinPagar, obtenerCliente } = require('../services/ucrmClient');
const { enviarWhatsApp } = require('../services/whatsappService');
const { enviarEmail } = require('../services/emailService');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
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

module.exports = { enviarResumenDiario };
