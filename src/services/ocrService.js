// src\services\ocrService.js
// Procesamiento OCR y extraccion de datos de vouchers.

const Tesseract = require('tesseract.js');

async function procesarImagenVoucher(imagePath) {
  try {
    console.log('   📸 Procesando imagen con OCR...');
    
    const { data: { text } } = await Tesseract.recognize(
      imagePath,
      'spa',
      {
        logger: m => {
          if (m.status === 'recognizing text') {
            process.stdout.write(`\r   OCR: ${Math.round(m.progress * 100)}%`);
          }
        }
      }
    );
    
    console.log('\n   ✓ OCR completado');
    return extraerDatosVoucher(text);
  } catch (error) {
    console.error('   ❌ Error en OCR:', error.message);
    return null;
  }
}

function extraerDatosVoucher(texto) {
  const info = {
    monto: null,
    fecha: null,
    operacion: null,
    banco: null,
    textoCompleto: texto
  };
  
  const bancosPatrones = [
    { nombres: ['BCP', 'BANCO CRÉDITO', 'BANCO CREDITO'], codigo: 'BCP' },
    { nombres: ['INTERBANK', 'INTER BANK'], codigo: 'INTERBANK' },
    { nombres: ['SCOTIABANK', 'SCOTIA'], codigo: 'SCOTIABANK' },
    { nombres: ['BBVA'], codigo: 'BBVA' },
    { nombres: ['YAPE'], codigo: 'YAPE' },
    { nombres: ['PLIN'], codigo: 'PLIN' }
  ];
  
  const textoMayuscula = texto.toUpperCase();
  
  for (const banco of bancosPatrones) {
    for (const nombre of banco.nombres) {
      if (textoMayuscula.includes(nombre)) {
        info.banco = banco.codigo;
        break;
      }

    }

    
    if (info.banco) break;
  }
  
  const patronesMonto = [
    /(?:ENVIASTE|RECIBISTE|PAGASTE|TRANSFERISTE)\s*S\/?\s*(\d{1,6}[.,]\d{2})/gi,
    /(?:MONTO|IMPORTE|TOTAL)\s*[:=]?\s*S\/?\s*(\d{1,6}[.,]\d{2})/gi,
    /S\/\s*(\d{1,6}[.,]\d{2})/gi,
    /PEN\s*(\d{1,6}[.,]\d{2})/gi
  ];
  
  const montosEncontrados = [];
  
  for (const patron of patronesMonto) {
    const matches = texto.matchAll(patron);
    for (const match of matches) {
      let montoStr = match[1].replace(/,/g, '.');
      let monto = parseFloat(montoStr);
      if (monto >= 1 && monto <= 999999) {
        montosEncontrados.push(monto);
      }
    }
  }
  
  if (montosEncontrados.length > 0) {
    info.monto = Math.max(...montosEncontrados);
  }
  
  const patronesFecha = [
    /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/,
    /(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\.?\s+(\d{4})/i
  ];
  
  for (const patron of patronesFecha) {
    const match = texto.match(patron);
    if (match) {
      info.fecha = match[0];
      break;
    }
  }
  
  const patronesOperacion = [
    /(?:OPERACI[OÓ]N|N[UÚ]MERO|REF)[:\s#]*(\d{8,20})/i,
    /(?:C[OÓ]DIGO|CODE)[:\s#]*(\d{8,20})/i
  ];
  
  for (const patron of patronesOperacion) {
    const match = texto.match(patron);
    if (match) {
      info.operacion = match[1];
      break;
    }
  }
  
  return info;
}

module.exports = { procesarImagenVoucher, extraerDatosVoucher };
