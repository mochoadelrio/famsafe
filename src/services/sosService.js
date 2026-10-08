import { db } from './db.js';
import { sendPushNotification } from './firebaseService.js';

export function triggerEmergencySos(memberId, io, options = {}) {
  const member = db.getMemberById(memberId);
  if (!member) throw new Error("Miembro no encontrado");

  // Create SOS Session
  const sosSession = db.createSos({
    circleId: member.circleId,
    memberId: member.id,
    memberName: member.name,
    location: member.lastLocation,
    note: options.note || "¡Botón SOS pulsado por el usuario!",
    audioSampleUrl: options.audioSampleUrl || "simulated_ambient_audio.mp3"
  });

  // Create priority alert
  const alert = db.addAlert({
    circleId: member.circleId,
    memberId: member.id,
    type: 'sos',
    title: `🚨 ¡ALERTA DE SOS DE ${member.name.toUpperCase()}!`,
    message: `¡Pánico activado! Coordenadas: [${member.lastLocation.lat.toFixed(5)}, ${member.lastLocation.lng.toFixed(5)}]. Escuchando audio ambiental...`
  });

  // Update member status
  member.status = 'sos';
  db.save();

  // Broadcast immediate critical event to circle
  if (io) {
    io.to(member.circleId).emit('sos:triggered', {
      sosSession,
      alert,
      member
    });
  }

  // Send High Priority Critical Push
  sendPushNotification({
    topic: `circle_${member.circleId}`,
    title: alert.title,
    body: alert.message,
    data: {
      type: "sos_emergency",
      memberId: member.id,
      sosId: sosSession.id,
      lat: String(member.lastLocation.lat),
      lng: String(member.lastLocation.lng)
    }
  });

  return { sosSession, alert };
}

export function cancelEmergencySos(sosId, io) {
  const sos = db.resolveSos(sosId);
  if (!sos) return null;

  const member = db.getMemberById(sos.memberId);
  if (member) {
    member.status = 'stationary';
    db.save();
  }

  const alert = db.addAlert({
    circleId: sos.circleId,
    memberId: sos.memberId,
    type: 'sos_resolved',
    title: `✅ Emergencia SOS Resuelta`,
    message: `La alerta de emergencia de ${sos.memberName} ha sido marcada como resuelta.`
  });

  if (io) {
    io.to(sos.circleId).emit('sos:resolved', {
      sosId,
      alert,
      member
    });
  }

  return sos;
}
