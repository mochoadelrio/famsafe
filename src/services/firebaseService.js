import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isFirebaseInitialized = false;

// Check if serviceAccountKey.json exists in root
const serviceAccountPath = path.join(__dirname, '../../serviceAccountKey.json');

if (fs.existsSync(serviceAccountPath)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    isFirebaseInitialized = true;
    console.log("🔥 Firebase Admin SDK inicializado correctamente con serviceAccountKey.json");
  } catch (err) {
    console.warn("⚠️ No se pudo inicializar Firebase con serviceAccountKey:", err.message);
  }
} else {
  console.log("ℹ️ Firebase listo en modo simulación. (Agrega 'serviceAccountKey.json' para enviar push reales a iOS/Android)");
}

/**
 * Sends a high-priority push notification to a device token or circle topic
 */
export async function sendPushNotification({ targetToken, topic, title, body, data = {} }) {
  if (!isFirebaseInitialized) {
    console.log(`[FCM Mock Push] Para: ${topic || targetToken} | Título: ${title} | Mensaje: ${body}`);
    return { success: true, simulated: true };
  }

  const message = {
    notification: { title, body },
    data: {
      ...data,
      click_action: "FLUTTER_NOTIFICATION_CLICK"
    },
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'famsafe_urgent_channel'
      }
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1
        }
      }
    }
  };

  if (topic) {
    message.topic = topic;
  } else if (targetToken) {
    message.token = targetToken;
  }

  try {
    const response = await admin.messaging().send(message);
    console.log("✅ Push Notification enviada exitosamente vía FCM:", response);
    return { success: true, response };
  } catch (error) {
    console.error("❌ Error enviando Push Notification FCM:", error);
    return { success: false, error };
  }
}
