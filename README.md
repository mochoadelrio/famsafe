# 🛡️ FamSafe SaaS - Family Safety & Real-Time Tracking Platform

**FamSafe** es una plataforma SaaS de seguimiento familiar y protección de menores en tiempo real, diseñada desde el día cero para resolver los problemas críticos del mercado: **cero venta de datos**, **motor de bajo impacto en batería (<3% diario)**, **modo de privacidad por etapas para adolescentes** y **alertas contextuales de emergencia con audio ambiental**.

---

## 🚀 Inicio Rápido (Servidor y Dashboard Web)

### 1. Requisitos
* Node.js v18+ instalado.

### 2. Instalación y Ejecución
```bash
cd /Users/manuel8a/.gemini/antigravity/scratch/famsafe
npm install
npm start
```

Abre tu navegador en:
👉 **`http://localhost:3005`**

---

## 🌟 Funcionalidades Clave Implementadas

1. **Dashboard Interactivo en Tiempo Real:**
   * Mapa vectorial Leaflet con avatares de los miembros, marcadores con pulso de radar en vivo e indicadores de batería/velocidad.
   * Visualización interactiva de **Geocercas (Safe Zones)** con radio en metros y detección automática de entrada/salida.

2. **Centro de Protección de Menores:**
   * **Safe Zones (Zonas Seguras):** Perímetros dinámicos (Escuela, Casa, Club) que disparan alertas automáticas de llegada y salida.
   * **Monitor de Batería Crítica:** Alertas automáticas en tiempo real cuando el teléfono de un hijo baja del 15%.
   * **Botón de Emergencia SOS:** Interrumpe el flujo normal, fija el mapa con halo rojo intermitente y emite sirena de advertencia sonora (Web Audio API).

3. **Diferenciador "Acompáñame a Casa" (Walk With Me):**
   * El familiar o adolescente inicia un trayecto con un tiempo estimado (ej. 15 minutos).
   * Si el tiempo expira sin confirmar llegada con su huella o botón, se escala automáticamente una alarma crítica a todos los tutores con la última ubicación.

4. **Banco de Pruebas y Simulador Integrado:**
   * Pestaña **"Simulador"** en la barra lateral para probar en vivo sin necesidad de salir a la calle:
     * *Mover a Lucas a la escuela (Entrada a zona)*.
     * *Mover a Lucas a la calle (Salida de zona / trayecto)*.
     * *Mover a Lucas a casa (Llegada a salvo)*.
     * *Simular batería baja (<15%)*.
     * *Simular SOS de pánico*.

5. **Monetización SaaS Multi-Plan:**
   * Modal interactivo de suscripciones con tres niveles de monetización:
     * **Plan Gratuito ($0):** 2 integrantes, 1 zona segura.
     * **Plan Familiar Pro ($7.99 USD/mes):** Hasta 10 integrantes, zonas ilimitadas, Walk With Me, historial de 30 días.
     * **Plan Guardian Plus ($14.99 USD/mes):** Transmisión de audio ambiental SOS, detección de impacto vehicular y asistencia 24/7.

---

## 📱 Integración con Aplicaciones Móviles (Flutter / React Native)

Para que las apps nativas de iOS y Android envíen ubicación en segundo plano, se conectan a los siguientes endpoints:

### Ingesta de Telemetría (Background Service)
```http
POST /api/telemetry
Content-Type: application/json

{
  "memberId": "user-lucas-child",
  "lat": 40.412500,
  "lng": -3.705000,
  "accuracy": 8,
  "speedKmh": 0,
  "battery": 45,
  "isCharging": false,
  "status": "stationary",
  "address": "Colegio San Martín"
}
```

### Disparo de SOS de Emergencia
```http
POST /api/sos/trigger
Content-Type: application/json

{
  "memberId": "user-lucas-child",
  "note": "Botón de pánico activado por el menor"
}
```

### WebSockets en Tiempo Real
Conéctate al servidor vía `socket.io-client` y únete al canal del círculo familiar:
```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000');
socket.emit('circle:join', 'circle-garcia-001');

socket.on('member:location_update', ({ member }) => {
  console.log(`Posición en vivo de ${member.name}:`, member.lastLocation);
});

socket.on('sos:triggered', ({ sosSession, member }) => {
  // Disparar alarma nativa que despierte la pantalla del padre
});
```

---

## 🏗️ Escalado a Producción (Arquitectura para +100,000 Usuarios)

Para llevar este prototipo a escala global:
1. **Base de Datos:** Migrar de `famsafe_db.json` a **PostgreSQL con la extensión PostGIS** para consultas geoespaciales masivas (`ST_DWithin`, `ST_Contains`).
2. **Caché en Memoria:** Añadir un cluster **Redis** para almacenar la última coordenada de cada usuario en RAM (<2ms de latencia).
3. **Pagos:** Conectar la pasarela **Stripe** para web y **RevenueCat** para gestionar las compras In-App en Apple App Store y Google Play Store con el precio de \$7.99 y \$14.99 USD/mes.
