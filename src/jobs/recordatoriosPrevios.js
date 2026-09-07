// src\jobs\recordatoriosPrevios.js
// Recordatorios previos al vencimiento.

const { MessageMedia } = require('whatsapp-web.js');
const CONFIG = require('../config');
const { clienteEstaBloqueado } = require('../config/blacklist');
const { formatearFecha, obtenerNombreMes, diasParaVencer, sleep } = require('../utils/fechas');
const { limpiarTelefono } = require('../utils/telefono');
const ucrm = require('../services/ucrmClient');
const whatsappService = require('../services/whatsappService');
const state = require('../storage/state');
const { enviarWhatsApp } = whatsappService;
const {
  obtenerFacturasSinPagar, obtenerCliente, clienteTieneServicioActivo,
  descargarPDFFacturaBuffer, agregarNotaCliente
} = ucrm;
const clienteDebeRecibirMensajes = cliente => !CONFIG.VALIDAR_CLIENTE_ACTIVO || cliente.isActive !== 0;

async function procesarRecordatoriosPrevios() {
  if (!whatsappService.isReady()) {
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
    if (state.yaSeEnvioHoy(cliente.id)) {
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
await whatsappService.getClient().sendMessage(chatId, media);
          
          console.log(`   ✅ PDF enviado: ${factura.number}`);
          pdfEnviados++;
        }
      } catch (error) {
        console.error(`   ❌ Error con PDF ${factura.number}:`, error.message);
      }
    }
    
    console.log(`   📊 PDFs enviados: ${pdfEnviados}/${facturasCliente.length}`);
    
    // ✅ MARCAR COMO ENVIADO (1 vez por cliente)
    state.marcarMensajeEnviado(cliente.id);
    
    await agregarNotaCliente(
      cliente.id,
      `⏰ Recordatorio previo - ${facturasCliente.length} factura(s) - Vence MAÑANA - S/ ${totalGeneral.toFixed(2)} - ${pdfEnviados} PDFs`
    );
    
    enviados++;
    console.log(`   ✅ Completado\n`);
    
    if (enviados < Object.keys(facturasPorCliente).length) {
      await sleep(CONFIG.DELAY_RECORDATORIOS_DEUDA);
    }

    function programarRecordatoriosPrevios() {
      const ahora = new Date();
      const horaActual = ahora.getHours();
      if (horaActual >= CONFIG.HORA_INICIO_PREVIOS && horaActual < CONFIG.HORA_FIN_PREVIOS) {
        console.log('⚡ Sistema iniciado dentro del horario - Ejecutando recordatorios previos AHORA');
        procesarRecordatoriosPrevios();
        return;
      }
      const proximaEjecucion = new Date();
      if (horaActual >= CONFIG.HORA_FIN_PREVIOS) proximaEjecucion.setDate(proximaEjecucion.getDate() + 1);
      proximaEjecucion.setHours(CONFIG.HORA_INICIO_PREVIOS, 0, 0, 0);
      console.log(`⏰ Recordatorios previos programados para: ${proximaEjecucion.toLocaleString('es-PE')}`);
      setTimeout(() => {
        procesarRecordatoriosPrevios();
        setInterval(procesarRecordatoriosPrevios, 24 * 60 * 60 * 1000);
      }, proximaEjecucion - ahora);
    }

  }

  

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Enviados: ${enviados} | Saltados: ${saltados}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

module.exports = { procesarRecordatoriosPrevios, programarRecordatoriosPrevios };
