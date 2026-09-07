// src\jobs\recordatoriosDeuda.js
// Cola y procesamiento de recordatorios de deuda.

const axios = require('axios');
const https = require('https');
const { MessageMedia } = require('whatsapp-web.js');
const CONFIG = require('../config');
const { clienteEstaBloqueado } = require('../config/blacklist');
const { obtenerNombreMesCompleto, sleep } = require('../utils/fechas');
const { limpiarTelefono } = require('../utils/telefono');
const ucrm = require('../services/ucrmClient');
const whatsappService = require('../services/whatsappService');
const state = require('../storage/state');
const { enviarWhatsApp } = whatsappService;
const {
  obtenerCliente, obtenerFacturasSinPagar, obtenerFactura,
  buscarPagosCliente, agregarNotaCliente, descargarPDFFacturaBuffer
} = ucrm;
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
let cicloActual = state.getCicloActual();
let colaRecordatorios = state.getColaRecordatorios();
let procesandoRecordatorios = false;
function reiniciarCiclo() {
  cicloActual = { inicioCiclo: new Date().toISOString(), clientesEnviados: [], cicloCompletado: false };
  state.setCicloActual(cicloActual);
  guardarCicloActual();
  console.log('♻️  Ciclo reiniciado');
}
const guardarCicloActual = () => state.guardarCicloActual();
const guardarColaRecordatorios = () => state.guardarColaRecordatorios();
const guardarMensajesEnviados = () => state.guardarMensajesEnviados();
const yaSeEnvioHoy = clienteId => state.yaSeEnvioHoy(clienteId);
const marcarMensajeEnviado = clienteId => state.marcarMensajeEnviado(clienteId);

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
// Procesamiento del ciclo diario.

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
  
  if (!whatsappService.isReady()) {
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
          await whatsappService.getClient().sendMessage(chatId, media);

          console.log(`   ✅ PDF enviado: Factura ${factura.numero}`);

        
          pdfEnviados++;
        } else {
          console.log(`   ⚠️  No se pudo descargar PDF de factura ${factura.numero}`);
        }

        function programarRecordatoriosDeuda() {
          const ahora = new Date();
          const horaActual = ahora.getHours();
          if (horaActual >= CONFIG.HORA_INICIO_DEUDA && horaActual < CONFIG.HORA_FIN_DEUDA) {
            console.log('⚡ Sistema iniciado dentro del horario - Comenzando ciclo AHORA');
            iniciarCicloRecordatoriosDeuda();
            return;
          }
          const proximaEjecucion = new Date();
          if (horaActual >= CONFIG.HORA_FIN_DEUDA) proximaEjecucion.setDate(proximaEjecucion.getDate() + 1);
          proximaEjecucion.setHours(CONFIG.HORA_INICIO_DEUDA, 0, 0, 0);
          console.log(`⏰ Recordatorios de deuda programados para: ${proximaEjecucion.toLocaleString('es-PE')}`);
          setTimeout(() => {
            iniciarCicloRecordatoriosDeuda();
            setInterval(iniciarCicloRecordatoriosDeuda, 24 * 60 * 60 * 1000);
          }, proximaEjecucion - ahora);
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

module.exports = {
  clienteDebeRecibirMensajes, clienteTieneServicioActivo, debeRecibirMensajeCompleto,
  actualizarColaRecordatorios, procesarRecordatoriosDeuda, iniciarCicloRecordatoriosDeuda,
  programarRecordatoriosDeuda
};
