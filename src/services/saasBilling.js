import { db } from './db.js';

export const PLANS = {
  basic: {
    id: "basic",
    name: "Plan Básico ($29 MXN/mes)",
    priceMxn: 29,
    priceMxnAnnual: 249,
    maxMembers: 3,
    maxSafeZones: 2,
    historyDays: 7,
    features: [
      "Hasta 3 integrantes familiares",
      "2 Zonas Seguras (ej. Casa y Escuela)",
      "Alertas de batería baja (< 15%)",
      "Historial de rutas de 7 días",
      "Botón de alerta de pánico SOS"
    ]
  },
  freemium: {
    id: "freemium",
    name: "Plan Básico ($29 MXN/mes)",
    priceMxn: 29,
    priceMxnAnnual: 249,
    maxMembers: 3,
    maxSafeZones: 2,
    historyDays: 7,
    features: [
      "Hasta 3 integrantes familiares",
      "2 Zonas Seguras (ej. Casa y Escuela)",
      "Alertas de batería baja (< 15%)",
      "Historial de rutas de 7 días",
      "Botón de alerta de pánico SOS"
    ]
  },
  pro_family: {
    id: "pro_family",
    name: "Familiar Pro ($79 MXN/mes)",
    priceMxn: 79,
    priceMxnAnnual: 699,
    maxMembers: 10,
    maxSafeZones: 999,
    historyDays: 30,
    features: [
      "Hasta 10 integrantes familiares",
      "Zonas Seguras ilimitadas con horarios",
      "Actualización de posición cada 5-15 seg",
      "Modo Privacidad Adolescente",
      "Acompáñame a Casa (Walk With Me)",
      "Historial de 30 días",
      "Alertas automáticas escolares"
    ]
  },
  guardian_plus: {
    id: "guardian_plus",
    name: "Guardian Plus ($149 MXN/mes)",
    priceMxn: 149,
    priceMxnAnnual: 1299,
    maxMembers: 999,
    maxSafeZones: 999,
    historyDays: 90,
    features: [
      "Integrantes familiares ilimitados",
      "Todo lo de Pro sin límites",
      "Transmisión de audio ambiental en vivo en SOS",
      "Detección de accidentes y frenazos bruscos",
      "Alerta de desvío de rutas inusuales por IA",
      "Historial de 90 días con análisis de paradas",
      "Asistencia prioritaria 24/7"
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
