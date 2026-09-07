// src/routes/cola.js
// Rutas para verificar y limpiar la cola de recordatorios.

const express = require('express');
const state = require('../storage/state');
const { obtenerFactura } = require('../services/ucrmClient');
const { obtenerNombreMesCompleto } = require('../utils/fechas');
const router = express.Router();
let colaRecordatorios = state.getColaRecordatorios();
const guardarColaRecordatorios = () => state.guardarColaRecordatorios();

router.get('/verificar-cola', async (req, res) => {
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
router.get('/limpiar-cola', async (req, res) => {
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

module.exports = router;
