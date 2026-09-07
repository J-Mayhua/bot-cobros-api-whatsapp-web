// src/storage/jsonStore.js
// Abstraccion generica para leer y escribir estado JSON del sistema.

const fs = require('fs');

function leer(archivo, valorPorDefecto = null) {
  try {
    if (!fs.existsSync(archivo)) return valorPorDefecto;
    return JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch (error) {
    console.error(`Error leyendo ${archivo}:`, error.message);
    return valorPorDefecto;
  }
}

function escribir(archivo, data) {
  try {
    fs.writeFileSync(archivo, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error escribiendo ${archivo}:`, error.message);
  }
}

module.exports = { leer, escribir };
