# Bot de cobros UCRM por WhatsApp

Bot Node.js para automatizar cobros de proveedores de Internet que usan UCRM: recibe comprobantes por WhatsApp, los analiza con OCR, consulta pagos y facturas en UCRM y envía recordatorios y notificaciones administrativas.

[![Node.js >=18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Licencia MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](#licencia)

## Tabla de contenidos

- [Características principales](#características-principales)
- [Stack tecnológico](#stack-tecnológico)
- [Requisitos previos](#requisitos-previos)
- [Instalación](#instalación)
- [Variables de entorno](#variables-de-entorno)
- [Uso](#uso--cómo-correr-el-proyecto)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Scripts disponibles](#scripts-disponibles)
- [Endpoints de la API](#endpoints-de-la-api)
- [Flujo del bot](#flujo-del-bot)
- [Datos sensibles y seguridad](#notas-sobre-datos-sensibles--seguridad)
- [Troubleshooting](#troubleshooting)
- [Licencia](#licencia)

## Características principales

- Conecta una cuenta de WhatsApp Web mediante `whatsapp-web.js` y muestra un QR en la terminal durante el primer inicio.
- Busca clientes en UCRM por número telefónico, tolerando distintos formatos del número.
- Recibe imágenes de comprobantes, las guarda en `vouchers/` y usa Tesseract.js en español para extraer monto, fecha, banco y número de operación.
- Agrega una nota del voucher al cliente en UCRM y notifica al administrador por WhatsApp.
- Responde a clientes conocidos que escriben frases como “ya pagué”, consultando sus pagos recientes.
- Detecta pagos nuevos en UCRM, confirma el pago al cliente, envía el recibo PDF y registra una nota en UCRM.
- Envía recordatorios de deuda entre las 08:00 y las 18:00, con cola persistida, control anti-duplicados, validación de servicios y PDFs de facturas.
- Envía recordatorios previos para facturas que vencen al día siguiente, entre las 18:00 y las 20:00.
- Omite clientes incluidos en la lista negra y clientes sin teléfono o sin servicios válidos.
- Envía un resumen diario de pagos, vencimientos y deuda por WhatsApp y correo electrónico.
- Expone endpoints Express para salud, ciclo de recordatorios, cola, vouchers y apagado controlado.
- Persiste estado operativo en archivos JSON locales para recuperar ciclos, pagos procesados y mensajes enviados.

## Stack tecnológico

| Tecnología | Uso |
| --- | --- |
| Node.js `>=18.0.0` | Runtime de la aplicación |
| Express `4.18.2` | API HTTP de monitoreo |
| `whatsapp-web.js` `^1.23.0` | Conexión con WhatsApp Web y envío de mensajes/PDF |
| Tesseract.js `^5.1.1` | OCR de comprobantes en español |
| Nodemailer `^6.9.7` | Resúmenes y alertas por correo mediante Gmail |
| Axios `^1.6.2` | Consumo de la API REST de UCRM |
| dotenv `^16.3.1` | Carga de variables desde `.env` |
| qrcode-terminal `^0.12.0` | Renderizado del QR en la terminal |
| Nodemon `^3.0.2` | Reinicio automático en desarrollo |

## Requisitos previos

- Node.js 18 o superior.
- npm, incluido normalmente con Node.js.
- Una instancia de UCRM accesible, una API Key y clientes con teléfonos configurados.
- Una cuenta de WhatsApp que pueda vincularse mediante WhatsApp Web.
- Chrome/Chromium compatible con Puppeteer. `whatsapp-web.js` configura Puppeteer en modo headless y con argumentos `--no-sandbox`.
- En Linux, si Chromium no inicia, pueden ser necesarias librerías del sistema como `libnss3`, `libatk-bridge2.0-0`, `libatk1.0-0`, `libgtk-3-0`, `libgbm1`, `libasound2` y dependencias relacionadas.
- Para `npm run stop`, `npm run health` y `npm run vouchers` se necesita `curl` disponible en el `PATH`.

## Instalación

1. Clona el repositorio y entra en su carpeta:

   ```bash
   git clone https://github.com/J-Mayhua/bot-cobros-api-whatsapp-web.git
   cd bot-cobros-api-whatsapp-web
   ```

2. Instala las dependencias:

   ```bash
   npm install
   ```

3. Crea el archivo local de configuración:

   ```bash
   cp .env.example .env
   ```

   En Windows PowerShell, usa `Copy-Item .env.example .env`.

4. Edita `.env` con la URL y API Key de UCRM, las credenciales de correo, teléfonos de notificación y cuentas de pago. Consulta la tabla de [Variables de entorno](#variables-de-entorno).

5. Inicia el bot con `npm start`. En el primer inicio aparecerá un QR en la terminal; escanéalo desde WhatsApp en el teléfono que se usará para el bot.

## Variables de entorno

Las variables marcadas como obligatorias son las que comprueba `validarConfig()` al iniciar. `PORT` se lee directamente en `index.js` y es opcional.

| Variable | Descripción | Ejemplo | Obligatoria |
| --- | --- | --- | --- |
| `UCRM_URL` | URL base de la instancia UCRM. | `https://tu-servidor:8443` | Sí |
| `UCRM_API_KEY` | API Key enviada como `X-Auth-App-Key`. | `tu_api_key_aqui` | Sí |
| `EMAIL_USER` | Cuenta Gmail usada por Nodemailer. | `tu_correo@gmail.com` | Sí |
| `EMAIL_PASS` | Contraseña de aplicación o credencial SMTP de la cuenta. | `tu_contraseña_de_aplicacion_gmail` | Sí |
| `ADMIN_EMAIL` | Destinatario del resumen diario y alertas por correo. | `admin@tuempresa.com` | Sí |
| `PHONE_RECORDATORIOS` | Teléfono configurado para recordatorios. | `519XXXXXXXX` | Sí |
| `PHONE_NOTIFICACIONES` | Teléfono administrativo para alertas y vouchers. | `519XXXXXXXX` | Sí |
| `SCOTIA_CUENTA` | Cuenta corriente Scotiabank mostrada a clientes. | `770-XXXXXXX` | Sí |
| `SCOTIA_CCI` | CCI de Scotiabank. | `009423207XXXXXXXXXX` | Sí |
| `BCP_CUENTA` | Cuenta de ahorros BCP mostrada a clientes. | `XXXXXXXXXXXXXX` | Sí |
| `YAPE_NUMERO` | Número de Yape mostrado a clientes. | `9XXXXXXXX` | Sí |
| `NOMBRE_TITULAR_SCOTIA` | Nombre del titular de la cuenta de pago. | `Nombre Apellido` | Sí |
| `PORT` | Puerto HTTP de Express. Si no se define, usa `3000`. | `3000` | No |

`PHONE_RECORDATORIOS` está validado y cargado por la configuración, aunque el envío de recordatorios utiliza principalmente el teléfono de cada cliente obtenido desde UCRM. `SCOTIA_CCI` también se valida, pero no se incluye actualmente en los textos de recordatorio.

## Uso / cómo correr el proyecto

### Producción o ejecución normal

```bash
npm start
```

### Desarrollo

```bash
npm run dev
```

Al iniciar, la aplicación carga el estado JSON, crea `vouchers/` si no existe, inicia Express en `http://localhost:3000` por defecto e inicializa WhatsApp. Cuando WhatsApp está listo, activa el monitor de pagos, los recordatorios y el resumen diario.

La sesión se conserva mediante `LocalAuth` en `.wwebjs_auth/`, con el identificador de cliente `ucrm-bot`. Por eso normalmente no es necesario volver a escanear el QR después de reiniciar.

## Estructura del proyecto

```text
.
├── index.js                         # Punto de entrada y programación de jobs
├── package.json                     # Dependencias y scripts npm
├── .env.example                     # Plantilla de variables de entorno
├── src/
│   ├── app.js                       # Crea la aplicación Express
│   ├── config/
│   │   ├── index.js                 # Configuración y validación del entorno
│   │   └── blacklist.js             # Lista negra de clientes
│   ├── jobs/
│   │   ├── monitorPagos.js          # Detecta pagos nuevos y envía recibos
│   │   ├── recordatoriosDeuda.js    # Cola y ciclo de deuda
│   │   ├── recordatoriosPrevios.js  # Avisos un día antes del vencimiento
│   │   ├── resumenDiario.js         # Resumen por WhatsApp y correo
│   │   ├── recordatorioDeuda.js     # Archivo existente actualmente vacío
│   │   └── monitosPagos.js          # Archivo existente actualmente vacío
│   ├── routes/
│   │   ├── health.js                # Salud, vouchers y apagado
│   │   ├── ciclo.js                 # Consulta y reinicio del ciclo
│   │   └── cola.js                  # Verificación y limpieza de la cola
│   ├── services/
│   │   ├── emailService.js          # Envío de correo con Nodemailer
│   │   ├── ocrService.js            # OCR y extracción de datos
│   │   ├── ucrmClient.js             # Cliente de la API REST de UCRM
│   │   └── whatsappService.js        # Estado y envío por WhatsApp
│   ├── storage/
│   │   ├── jsonStore.js              # Lectura y escritura JSON
│   │   └── state.js                  # Estado de pagos, ciclo y cola
│   ├── utils/
│   │   ├── fechas.js                 # Fechas, meses y pausas
│   │   └── telefono.js               # Normalización de teléfonos
│   └── whatsapp/
│       └── client.js                 # Cliente WhatsApp y handler de mensajes
└── vouchers/                         # Se crea al iniciar; almacena comprobantes JPG
```

Además, la ejecución genera en la raíz `mensajes_enviados.json`, `pagos_procesados.json`, `ciclo_actual.json` y `cola_recordatorios.json`.

## Scripts disponibles

| Script | Comando | Descripción |
| --- | --- | --- |
| `start` | `node index.js` | Inicia el bot y el servidor Express. |
| `dev` | `nodemon index.js` | Inicia el bot y lo reinicia cuando cambian archivos. |
| `stop` | `curl http://localhost:3000/shutdown` | Solicita un apagado controlado. Requiere que el bot esté activo y `curl`. |
| `reset-session` | `npm run clean-session && npm start` | Elimina la sesión local y vuelve a iniciar. Usa sintaxis `rm`, por lo que está pensado para Unix/Linux o una shell compatible. |
| `clean-session` | `rm -rf .wwebjs_auth` | Borra la sesión de WhatsApp guardada localmente. |
| `clean-vouchers` | `rm -rf vouchers/*.jpg` | Elimina los vouchers JPG guardados. |
| `test` | `node test.js` | Ejecuta `test.js`; ese archivo no está presente actualmente en la raíz del repositorio. |
| `health` | `curl http://localhost:3000/health` | Consulta el estado de la API y de WhatsApp. |
| `vouchers` | `curl http://localhost:3000/vouchers` | Consulta el listado de vouchers almacenados. |

## Endpoints de la API

Todos los endpoints son `GET` y no tienen autenticación implementada en el código actual. El puerto por defecto es `3000`.

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `GET` | `/health` | Devuelve estado general, estado de WhatsApp, cantidad de vouchers y timestamp. |
| `GET` | `/vouchers` | Lista los archivos `.jpg` de `vouchers/`, ordenados por modificación, con su cantidad. |
| `GET` | `/shutdown` | Guarda el estado, destruye el cliente WhatsApp y termina el proceso después de dos segundos. |
| `GET` | `/ciclo` | Devuelve inicio, días transcurridos/restantes, progreso y próximo reinicio del ciclo. |
| `GET` | `/reiniciar-ciclo` | Reinicia manualmente el ciclo y devuelve el nuevo estado. |
| `GET` | `/verificar-cola` | Verifica una muestra de facturas en la cola contra UCRM. Acepta `?limit=N` y usa `10` por defecto. |
| `GET` | `/limpiar-cola` | Elimina de la cola facturas pagadas, inexistentes o sin saldo pendiente. |

## Flujo del bot

### Cliente conocido envía un voucher

1. WhatsApp recibe una imagen y el bot encuentra al cliente por su teléfono en UCRM.
2. Guarda el archivo como `vouchers/voucher_<clienteId>_<timestamp>.jpg`.
3. Tesseract.js reconoce el texto en español y busca monto, fecha, operación y banco.
4. Agrega una nota al cliente en UCRM con los datos encontrados y estado pendiente de verificación.
5. Notifica el voucher al teléfono `PHONE_NOTIFICACIONES` y responde al cliente.
6. Si el OCR falla, conserva el voucher, registra la incidencia y avisa al administrador para revisión manual.

### Cliente conocido escribe “ya pagué”

1. El bot busca pagos del cliente en los últimos siete días.
2. Si encuentra un pago, confirma monto y fecha y agrega una nota en UCRM.
3. Si no encuentra pagos, solicita una foto del comprobante y notifica al administrador que el pago aún no figura en UCRM.
4. Las respuestas de este tipo tienen un cooldown de cinco minutos por teléfono y tipo de respuesta.

### Número no registrado envía un mensaje

1. El bot no encuentra el número en UCRM.
2. Si envía una imagen, guarda el comprobante como `comprobante_<telefono>_<timestamp>.jpg` y notifica al administrador que el número no está registrado.
3. Si envía texto relacionado con pago, Yape, transferencia, depósito o factura, reenvía una alerta al administrador.
4. Los mensajes no relacionados con pagos se ignoran.

## Notas sobre datos sensibles / seguridad

- No subas `.env`: contiene la API Key de UCRM, credenciales de correo, teléfonos y cuentas de pago.
- No subas `.wwebjs_auth/`: contiene la sesión autenticada de WhatsApp.
- No subas `vouchers/` ni sus imágenes: pueden contener datos personales y financieros.
- Protege también los JSON generados (`mensajes_enviados.json`, `pagos_procesados.json`, `ciclo_actual.json` y `cola_recordatorios.json`), porque contienen información operativa de clientes.
- La API de monitoreo no tiene autenticación; no la expongas directamente a Internet sin una capa de acceso y red segura.
- El estado actual del repositorio no muestra un archivo `.gitignore`. Antes de usarlo en un repositorio compartido, crea uno que excluya como mínimo `.env`, `.wwebjs_auth/`, `vouchers/` y los JSON de estado.

## Troubleshooting

### No aparece el QR

- Confirma que ejecutaste `npm start` o `npm run dev` y revisa la salida de la terminal.
- Borra la sesión con `npm run clean-session` y vuelve a iniciar para forzar un nuevo QR.
- Comprueba que la terminal soporte la salida de `qrcode-terminal`.

### La sesión se cae o WhatsApp no queda listo

- Verifica que el teléfono tenga conexión y que WhatsApp no haya cerrado la sesión vinculada.
- Revisa `/health`: `whatsapp` debe aparecer como `true`.
- El proceso puede terminar ante ciertos timeouts críticos de WhatsApp Web; vuelve a iniciarlo y, si persiste, elimina `.wwebjs_auth/` y vincula de nuevo.

### Puppeteer no encuentra o no puede iniciar Chromium

- Instala Chrome/Chromium compatible.
- En Linux instala las librerías del sistema requeridas por Chromium, especialmente `libnss3`, `libatk-bridge2.0-0`, `libgtk-3-0` y `libgbm1`.
- Revisa permisos y prueba en el mismo usuario que ejecutará Node.js. El cliente ya usa `--no-sandbox` y `--disable-setuid-sandbox`.

### El OCR no reconoce el voucher

- Usa una imagen nítida, completa y con buena iluminación.
- Verifica que el monto tenga un formato que el extractor reconoce, como `S/ 25.00`, `MONTO: 25.00` o `PEN 25.00`.
- El extractor reconoce patrones de bancos como BCP, Interbank, Scotiabank, BBVA, Yape y Plin; aun así, el comprobante queda guardado y puede revisarse manualmente.
- Comprueba que `vouchers/` tenga permisos de lectura y escritura.

## Licencia

Este proyecto se distribuye bajo la licencia **MIT**, según `package.json`.
