# 🤖 Bot de Cobros por WhatsApp — Versión WhatsApp Web API

Bot de automatización de cobros y notificaciones por WhatsApp usando **WhatsApp Web**, integrado con el sistema de gestión **UCRM**. Versión mejorada con mayor estabilidad y nuevas funcionalidades respecto a la versión anterior.

---

## 🚀 ¿Qué hace este proyecto?

- 📬 Envía recordatorios automáticos a clientes con facturas vencidas
- ✅ Detecta pagos nuevos en UCRM y notifica al cliente con su recibo en PDF
- 📸 Procesa imágenes de comprobantes de pago con OCR (Tesseract.js)
- ⏰ Avisa a clientes 1 día antes del vencimiento de su factura
- 📊 Genera un resumen diario enviado por WhatsApp y correo al administrador
- 🔁 Sistema de ciclos inteligente para evitar mensajes duplicados
- 🚫 Lista negra de clientes inactivos

---

## 🛡️ ¿Por qué no se puede bloquear ni banear?

El bot está diseñado con un sistema de envío responsable que respeta los límites de WhatsApp:

- ⏱️ **Solo se envía 1 mensaje cada 10 minutos** — nunca envía en ráfaga
- 📅 **Máximo 1 mensaje por cliente por día** — evita el spam
- 🔄 **Ciclos de 5 días** — no repite el mismo cliente hasta que pase el ciclo
- 🕐 **Horario controlado** — solo envía entre 8 AM y 6 PM
- 🧠 **Sistema de tracking** — guarda historial en archivos JSON para no repetir
- ✅ **Verifica si el cliente ya pagó** antes de enviar cada recordatorio

Gracias a este sistema, el comportamiento del bot es idéntico al de una persona enviando mensajes manualmente, lo cual prácticamente elimina el riesgo de bloqueo.

---

## 🆚 Diferencias con la versión anterior (wppconnect)

| Característica | Versión anterior | Esta versión |
|---|---|---|
| Verificación de pago antes de enviar | ❌ No | ✅ Sí |
| Validación de servicios por cliente | Básica | Completa |
| Cola de recordatorios optimizada | ❌ No | ✅ Sí |
| Sistema anti-duplicado mejorado | Básico | Avanzado |
| Endpoints de administración | Pocos | Completos |
| Bloqueo anti-procesamiento simultáneo | ❌ No | ✅ Sí |

---

## 🛠️ Tecnologías usadas

| Tecnología | Uso |
|---|---|
| Node.js | Motor principal del sistema |
| wppconnect | Conexión con WhatsApp Web (gratuito) |
| UCRM REST API | Gestión de clientes, facturas y pagos |
| Tesseract.js | OCR para leer comprobantes de pago |
| Axios | Peticiones HTTP a la API |
| Nodemailer | Envío de resúmenes por correo |
| Express | Servidor HTTP para administración |
| PM2 | Gestor de procesos en servidor Linux |

---

## ✅ Requisitos previos

- Node.js v18 o superior
- Google Chrome instalado en el servidor
- PM2 instalado globalmente
- Cuenta activa en UCRM con API Key
- Servidor Linux (Ubuntu 20.04+ recomendado)

---

## 📦 Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/bot-cobros-whatsapp-v2.git
cd bot-cobros-whatsapp-v2

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
nano .env

# 4. Iniciar con PM2
pm2 start index.js --name ucrm-bot
pm2 save
pm2 startup
```

Al iniciar por primera vez, aparecerá un **código QR en la terminal**. Escanéalo con tu WhatsApp para vincular la cuenta.

---

## ⚙️ Configuración del archivo .env

```env
UCRM_URL=https://tu-servidor:8443
UCRM_API_KEY=tu_api_key_aqui
EMAIL_USER=tu_correo@gmail.com
EMAIL_PASS=tu_contraseña_de_aplicacion_gmail
ADMIN_EMAIL=admin@tuempresa.com
PHONE_RECORDATORIOS=51XXXXXXXXX
PHONE_NOTIFICACIONES=51XXXXXXXXX
SCOTIA_CUENTA=770-XXXXXXX
SCOTIA_CCI=009423207XXXXXXXXXX
BCP_CUENTA=XXXXXXXXXXXXXX
YAPE_NUMERO=9XXXXXXXX
NOMBRE_TITULAR_SCOTIA=Nombre Apellido
```

> ⚠️ Nunca subas tu archivo `.env` real a GitHub. Usa siempre `.env.example`.

---

## 📋 ¿Cómo funciona el sistema?

```
Cada 5 min   →  Monitor detecta pagos nuevos en UCRM
                  → Envía mensaje de confirmación al cliente
                  → Envía PDF del recibo automáticamente

8AM - 6PM    →  Recordatorios de deuda (1 cliente cada 10 min)
                  → Verifica primero si el cliente ya pagó
                  → Mensaje personalizado con detalle de facturas
                  → PDF de cada factura adjunto

6PM - 8PM    →  Recordatorios previos al vencimiento
                  → Aviso 1 día antes con datos de pago y PDF

6PM          →  Resumen diario al administrador por WhatsApp y correo

Respuestas   →  Si el cliente escribe "Ya pagué", el bot verifica en UCRM
                  → Si envía foto de comprobante, lo procesa con OCR
```

---

## 🌐 Endpoints de administración

Una vez corriendo, el bot expone un servidor en el puerto 3000:

| Endpoint | Descripción |
|---|---|
| `/health` | Estado del sistema y WhatsApp |
| `/ciclo` | Estado del ciclo actual de recordatorios |
| `/reiniciar-ciclo` | Fuerza reinicio del ciclo |
| `/verificar-cola` | Verifica facturas en cola y detecta las ya pagadas |
| `/limpiar-cola` | Elimina facturas ya pagadas de la cola |
| `/vouchers` | Lista comprobantes recibidos |
| `/shutdown` | Apagado limpio del sistema |

---

## 📁 Estructura del proyecto

```
├── index.js                   # Código principal
├── .env.example               # Plantilla de configuración
├── .env                       # Variables de entorno (NO subir a GitHub)
├── mensajes_enviados.json     # Historial de mensajes (generado automático)
├── pagos_procesados.json      # Historial de pagos (generado automático)
├── cola_recordatorios.json    # Cola de envíos (generado automático)
├── ciclo_actual.json          # Estado del ciclo (generado automático)
└── vouchers/                  # Comprobantes recibidos (generado automático)
```

---

## 👨‍💻 Sobre el proyecto

Desarrollado para automatizar el proceso de cobros en empresas proveedoras de internet (ISP) que usan UCRM como sistema de gestión. Esta versión mejorada incluye validaciones más robustas, mejor control de duplicados y un sistema de cola optimizado que garantiza que ningún cliente reciba mensajes innecesarios si ya realizó su pago.