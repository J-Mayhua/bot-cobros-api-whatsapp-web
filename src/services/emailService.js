// src\services\emailService.js
// Envio de correos electronicos.

const nodemailer = require('nodemailer');
const CONFIG = require('../config');

async function enviarEmail(destinatario, asunto, contenido) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: CONFIG.EMAIL_USER,
        pass: CONFIG.EMAIL_PASS
      }

    });
    
    await transporter.sendMail({
      from: CONFIG.EMAIL_USER,
      to: destinatario,
      subject: asunto,
      text: contenido
    });
    return true;
  } catch (error) {
    console.error('❌ Error enviando email:', error.message);
    return false;
  }

  
}

module.exports = { enviarEmail };
