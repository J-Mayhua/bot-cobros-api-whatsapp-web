// src\config\blacklist.js
// Lista negra y validacion de clientes bloqueados.

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

module.exports = { CLIENTES_BLOQUEADOS, clienteEstaBloqueado };
