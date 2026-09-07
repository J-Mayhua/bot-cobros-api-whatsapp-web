// src\utils\fechas.js
// Utilidades de fechas del sistema.

function formatearFecha(fecha) {
  const d = new Date(fecha);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const anio = d.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

function obtenerNombreMes(fecha) {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 
                 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const d = new Date(fecha);
  return meses[d.getMonth()];
}

function diasParaVencer(fecha) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const vencimiento = new Date(fecha);
  vencimiento.setHours(0, 0, 0, 0);
  const diff = vencimiento - hoy;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function obtenerNombreMesCompleto(fecha) {
  const meses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const d = new Date(fecha);
  return meses[d.getMonth()];
}

module.exports = { formatearFecha, obtenerNombreMes, obtenerNombreMesCompleto, diasParaVencer, sleep };
