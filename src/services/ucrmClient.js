// src\services\ucrmClient.js
// Cliente y operaciones de la API de UCRM.

const axios = require('axios');
const https = require('https');
const CONFIG = require('../config');
const { diasParaVencer, sleep } = require('../utils/fechas');
const { limpiarTelefono } = require('../utils/telefono');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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

  async function clienteTieneServicioActivo(clienteId, cliente = null) {
    if (!CONFIG.VALIDAR_CLIENTE_ACTIVO) return true;
    if (!cliente) {
      cliente = await obtenerCliente(clienteId);
      if (!cliente) return false;
    }
    try {
      const servicios = await obtenerServiciosCliente(clienteId);
      return servicios.some(servicio => [1, 2, 3, 4].includes(servicio.status));
    } catch (error) {
      console.error(`   ⚠️  Error verificando servicios ${clienteId}:`, error.message);
      return true;
    }
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

module.exports = {
  obtenerCliente, obtenerFacturasSinPagar, obtenerFactura, obtenerServiciosCliente,
  clienteTieneServicioActivo, obtenerTodosLosClientes, buscarClientePorTelefono,
  buscarPagosCliente, obtenerDeudaCliente, agregarNotaCliente, descargarPDFFacturaBuffer,
  descargarPDFPagoBuffer, agruparFacturasPorCliente
};
