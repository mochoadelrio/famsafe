import { db } from './db.js';

export const PLANS = {
  freemium: {
    id: "freemium",
    name: "Plan Gratuito",
    priceUsd: 0,
    maxMembers: 2,
    maxSafeZones: 1,
    historyDays: 2,
    features: [
      "Hasta 2 miembros familiares",
      "1 Zona Segura (ej. Casa)",
      "Alertas de batería baja",
      "Historial de 48 horas"
    ]
  },
  pro_family: {
    id: "pro_family",
    name: "Plan Familiar Pro",
    priceUsd: 7.99,
    maxMembers: 10,
    maxSafeZones: 999,
    historyDays: 30,
    features: [
      "Hasta 10 miembros familiares",
      "Zonas Seguras ilimitadas con horarios",
      "Actualización de posición cada 5-15 seg",
      "Modo Privacidad Adolescente",
      "Acompáñame a Casa (Walk With Me)",
      "Historial de 30 días",
      "Soporte prioritario"
    ]
  },
  guardian_plus: {
    id: "guardian_plus",
    name: "Plan Guardian Plus (Protección Total)",
    priceUsd: 14.99,
    maxMembers: 999,
    maxSafeZones: 999,
    historyDays: 90,
    features: [
      "Todo lo de Pro sin límites",
      "Transmisión de audio ambiental en vivo en SOS",
      "Detección de accidentes y frenazos bruscos",
      "Alerta de desvío de rutas inusuales por IA",
      "Historial de 90 días con análisis de paradas",
      "Asistencia 24/7 en emergencias"
    ]
  }
};

export function canAddMember(circleId) {
  const circle = db.getCircleById(circleId);
  if (!circle) return false;
  const plan = PLANS[circle.plan] || PLANS.freemium;
  const currentMembers = db.getMembersByCircle(circleId);
  return currentMembers.length < plan.maxMembers;
}

export function canAddSafeZone(circleId) {
  const circle = db.getCircleById(circleId);
  if (!circle) return false;
  const plan = PLANS[circle.plan] || PLANS.freemium;
  const currentZones = db.getSafeZonesByCircle(circleId);
  return currentZones.length < plan.maxSafeZones;
}

export function upgradePlan(circleId, planId, io) {
  if (!PLANS[planId]) {
    throw new Error("Plan inválido");
  }

  const updatedCircle = db.updateCirclePlan(circleId, planId, PLANS[planId].name);

  const alert = db.addAlert({
    circleId,
    type: 'billing_success',
    title: '🎉 Suscripción Actualizada',
    message: `El círculo familiar ahora cuenta con ${PLANS[planId].name}. Todas las funciones premium están activas.`
  });

  if (io) {
    io.to(circleId).emit('billing:updated', { circle: updatedCircle, alert, plan: PLANS[planId] });
  }

  return { circle: updatedCircle, plan: PLANS[planId] };
}
