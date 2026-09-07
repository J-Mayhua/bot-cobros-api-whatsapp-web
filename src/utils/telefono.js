// src\utils\telefono.js
// Normalizacion de telefonos.

function limpiarTelefono(telefono) {
  if (!telefono) return null;
  let limpio = telefono.replace(/[^\d]/g, '');
  
  if (limpio.startsWith('51')) return limpio;
  if (limpio.startsWith('9') && limpio.length === 9) return '51' + limpio;
  if (limpio.length === 9) return '51' + limpio;
  
  return limpio;
}

module.exports = { limpiarTelefono };
