import { db } from './db.js';
import { sendPushNotification } from './firebaseService.js';

/**
 * Calculates the great-circle distance between two points on the Earth (Haversine formula in meters).
 */
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Processes incoming telemetry for a member:
 * - Updates coordinates in DB
 * - Evaluates Geofences (Entry/Exit)
 * - Evaluates Battery Level
 * - Emits alerts to the circle
 */
export function processMemberTelemetry(memberId, telemetryData, io) {
  const member = db.getMemberById(memberId);
  if (!member) return null;

  const { lat, lng, accuracy, speedKmh, status, battery, isCharging, address } = telemetryData;

  const prevZoneId = member.currentZoneId;
  const safeZones = db.getSafeZonesByCircle(member.circleId);

  // Check geofence status
  let newZoneId = null;
  let currentZoneName = null;

  for (const zone of safeZones) {
    const dist = calculateDistanceMeters(lat, lng, zone.lat, zone.lng);
    if (dist <= zone.radiusMeters) {
      newZoneId = zone.id;
      currentZoneName = zone.name;
      break;
    }
  }

  const generatedAlerts = [];

  // Geofence Entry Event
  if (newZoneId && newZoneId !== prevZoneId) {
    const zone = safeZones.find(z => z.id === newZoneId);
    if (zone && zone.notifyOnEntry) {
      const alert = db.addAlert({
        circleId: member.circleId,
        memberId: member.id,
        type: 'zone_entry',
        title: `Llegada a ${zone.name}`,
        message: `${member.name} ha llegado y entrado a la zona segura '${zone.name}'.`
      });
      generatedAlerts.push(alert);
    }
  }

  // Geofence Exit Event
  if (prevZoneId && prevZoneId !== newZoneId) {
    const prevZone = safeZones.find(z => z.id === prevZoneId);
    if (prevZone && prevZone.notifyOnExit) {
      const alert = db.addAlert({
        circleId: member.circleId,
        memberId: member.id,
        type: 'zone_exit',
        title: `Salida de ${prevZone.name}`,
        message: `${member.name} ha salido del perímetro de '${prevZone.name}'.`
      });
      generatedAlerts.push(alert);
    }
  }

  // Battery Alert
  if (battery !== undefined) {
    if (battery <= 15 && (!member.battery || member.battery > 15)) {
      const alert = db.addAlert({
        circleId: member.circleId,
        memberId: member.id,
        type: 'low_battery',
        title: 'Batería Crítica (< 15%)',
        message: `El teléfono de ${member.name} tiene solo ${battery}% de carga.`
      });
      generatedAlerts.push(alert);
    }
  }

  // Update in DB
  member.currentZoneId = newZoneId;
  const updatedMember = db.updateMemberLocation(memberId, {
    lat,
    lng,
    accuracy,
    speedKmh,
    status,
    battery,
    address: currentZoneName ? `En ${currentZoneName}` : address
  });

  if (battery !== undefined) {
    db.updateMemberBattery(memberId, battery, isCharging);
  }

  // Emit real-time telemetry through WebSockets
  if (io) {
    io.to(member.circleId).emit('member:location_update', {
      member: updatedMember,
      alerts: generatedAlerts
    });

    if (generatedAlerts.length > 0) {
      generatedAlerts.forEach(alert => {
        io.to(member.circleId).emit('alert:new', alert);
        sendPushNotification({
          topic: `circle_${member.circleId}`,
          title: alert.title,
          body: alert.message,
          data: { alertId: alert.id, memberId: member.id, type: alert.type }
        });
      });
    }
  }

  return { member: updatedMember, alerts: generatedAlerts };
}
