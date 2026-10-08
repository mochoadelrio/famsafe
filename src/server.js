import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { db } from './services/db.js';
import { processMemberTelemetry } from './services/geoEngine.js';
import { triggerEmergencySos, cancelEmergencySos } from './services/sosService.js';
import { walkMeHomeService } from './services/walkMeHomeService.js';
import { PLANS, upgradePlan, canAddSafeZone } from './services/saasBilling.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ---------------- REST API ROUTES ----------------

// Register a New Family Circle
app.post('/api/auth/register-family', (req, res) => {
  const { familyName, parentName, email, phone, password, plan, lat, lng, address } = req.body;
  if (!familyName || !parentName || !email || !password) {
    return res.status(400).json({ error: "Todos los campos principales son requeridos." });
  }

  try {
    const result = db.createFamilyAccount({
      familyName,
      parentName,
      email,
      phone,
      password,
      plan: plan || "pro_family",
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
      address
    });

    res.json({
      success: true,
      circle: result.circle,
      member: result.member,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      inviteCode: result.circle.inviteCode
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// User Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Correo y contraseña requeridos." });
  }

  try {
    const result = db.authenticateUser(email, password);
    res.json({
      success: true,
      circle: result.circle,
      member: result.member,
      user: { id: result.user.id, email: result.user.email, name: result.user.name }
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// Join Family by 6-digit Invite Code
app.post('/api/circles/join', (req, res) => {
  const { inviteCode, memberName, role, phone, lat, lng, address } = req.body;
  if (!inviteCode || !memberName) {
    return res.status(400).json({ error: "Código de invitación y nombre requeridos." });
  }

  try {
    const result = db.joinFamilyWithCode({
      inviteCode,
      memberName,
      role: role || "child",
      phone: phone || "",
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
      address
    });

    // Notify circle via WebSocket
    io.to(result.circle.id).emit('member:joined', {
      member: result.member,
      alert: result.alert
    });
    io.to(result.circle.id).emit('alert:new', result.alert);

    res.json({
      success: true,
      circle: result.circle,
      member: result.member
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Validate Invite Code preview
app.get('/api/circles/by-code/:code', (req, res) => {
  const circle = db.findCircleByInviteCode(req.params.code);
  if (!circle) {
    return res.status(404).json({ error: "Código de invitación no válido." });
  }
  res.json({
    success: true,
    circleId: circle.id,
    familyName: circle.name,
    plan: circle.plan
  });
});

// Get Circle Data (Overview)
app.get('/api/circles/:id', (req, res) => {
  const circleId = req.params.id;
  const circle = db.getCircleById(circleId);
  if (!circle) {
    return res.status(404).json({ error: "Círculo no encontrado" });
  }

  const members = db.getMembersByCircle(circleId);
  const safeZones = db.getSafeZonesByCircle(circleId);
  const alerts = db.getAlerts(circleId);
  const activeSos = db.getActiveSos(circleId);
  const activeWalks = db.getActiveWalkSessions(circleId);
  const currentPlan = PLANS[circle.plan] || PLANS.freemium;

  res.json({
    circle,
    currentPlan,
    members,
    safeZones,
    alerts,
    activeSos,
    activeWalks
  });
});

// Telemetry Ingestion (used by iOS / Android background service)
app.post('/api/telemetry', (req, res) => {
  const { memberId, lat, lng, accuracy, speedKmh, status, battery, isCharging, address } = req.body;
  if (!memberId || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: "Parámetros incompletos (memberId, lat, lng requeridos)" });
  }

  const result = processMemberTelemetry(memberId, {
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    accuracy: accuracy || 10,
    speedKmh: speedKmh || 0,
    status: status || 'walking',
    battery,
    isCharging,
    address
  }, io);

  if (!result) {
    return res.status(404).json({ error: "Miembro no encontrado" });
  }

  res.json({ success: true, result });
});

// Safe Zones Management
app.post('/api/zones', (req, res) => {
  const { circleId, name, lat, lng, radiusMeters, color, notifyOnEntry, notifyOnExit } = req.body;

  if (!canAddSafeZone(circleId)) {
    return res.status(403).json({
      error: "Límite de zonas alcanzado para tu plan actual. Actualiza a Pro para zonas ilimitadas."
    });
  }

  const newZone = db.addSafeZone({
    id: `zone-${Date.now()}`,
    circleId,
    name: name || "Nueva Zona Segura",
    icon: "shield",
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    radiusMeters: parseInt(radiusMeters) || 150,
    color: color || "#10b981",
    notifyOnEntry: notifyOnEntry ?? true,
    notifyOnExit: notifyOnExit ?? true
  });

  io.to(circleId).emit('zone:created', newZone);
  res.json({ success: true, zone: newZone });
});

app.delete('/api/zones/:id', (req, res) => {
  const zoneId = req.params.id;
  db.removeSafeZone(zoneId);
  io.emit('zone:deleted', { zoneId });
  res.json({ success: true });
});

// SOS Management
app.post('/api/sos/trigger', (req, res) => {
  const { memberId, note, lat, lng, accuracy } = req.body;
  try {
    if (lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng)) {
      db.updateMemberLocation(memberId, {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        accuracy: accuracy || 10,
        status: "sos",
        address: "🚨 Ubicación de Emergencia SOS en tiempo real"
      });
    }
    const result = triggerEmergencySos(memberId, io, { note });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/sos/resolve', (req, res) => {
  const { sosId } = req.body;
  const result = cancelEmergencySos(sosId, io);
  if (!result) return res.status(404).json({ error: "SOS no encontrado o ya resuelto" });
  res.json({ success: true, result });
});

// Walk With Me ("Acompáñame a Casa")
app.post('/api/walk/start', (req, res) => {
  const { memberId, destinationName, estimatedMinutes } = req.body;
  try {
    const session = walkMeHomeService.startSession(memberId, destinationName, estimatedMinutes, io);
    res.json({ success: true, session });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/walk/finish', (req, res) => {
  const { sessionId } = req.body;
  const session = walkMeHomeService.finishSession(sessionId, io);
  if (!session) return res.status(404).json({ error: "Sesión no encontrada" });
  res.json({ success: true, session });
});

// Billing & Subscription Upgrade
app.get('/api/billing/plans', (req, res) => {
  res.json(PLANS);
});

app.post('/api/billing/upgrade', (req, res) => {
  const { circleId, planId } = req.body;
  try {
    const result = upgradePlan(circleId, planId, io);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Real-time Simulation Helper (Move kid / teen step by step)
app.post('/api/simulation/move-kid', (req, res) => {
  const { memberId, target } = req.body; // target: 'home', 'school', 'street'
  const member = db.getMemberById(memberId || 'user-lucas-child');
  if (!member) return res.status(404).json({ error: "Miembro no encontrado" });

  let newCoords;
  let address;
  let status = "walking";
  let speed = 4.2;

  if (target === 'home') {
    newCoords = { lat: 40.418000, lng: -3.704000 };
    address = "Casa Familiar (Llegó a salvo)";
    status = "stationary";
    speed = 0;
  } else if (target === 'school') {
    newCoords = { lat: 40.412500, lng: -3.705000 };
    address = "Colegio San Martín (En clase)";
    status = "stationary";
    speed = 0;
  } else {
    // Intermediate street movement
    const jitterLat = (Math.random() - 0.5) * 0.003;
    const jitterLng = (Math.random() - 0.5) * 0.003;
    newCoords = { lat: 40.415000 + jitterLat, lng: -3.706000 + jitterLng };
    address = "Calle Arenal (En movimiento)";
    status = "walking";
    speed = 5.1;
  }

  const result = processMemberTelemetry(member.id, {
    lat: newCoords.lat,
    lng: newCoords.lng,
    accuracy: 8,
    speedKmh: speed,
    status,
    battery: member.battery,
    address
  }, io);

  res.json({ success: true, result });
});

// ---------------- WEBSOCKET HANDLING ----------------
io.on('connection', (socket) => {
  // Client joins family circle room
  socket.on('circle:join', (circleId) => {
    socket.join(circleId);
    console.log(`[Socket] Cliente conectado a círculo: ${circleId}`);
  });

  // Client emits live telemetry from mobile device
  socket.on('telemetry:push', (data) => {
    const { memberId, lat, lng, accuracy, speedKmh, status, battery, isCharging } = data;
    processMemberTelemetry(memberId, { lat, lng, accuracy, speedKmh, status, battery, isCharging }, io);
  });

  socket.on('disconnect', () => {
    // handled cleanly
  });
});

if (process.env.VERCEL !== '1') {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 FamSafe SaaS Server iniciado en http://localhost:${PORT}`);
    console.log(`🛡️  Monitoreo en tiempo real, Geocercas, SOS y Facturación`);
    console.log(`=======================================================`);
  });
}

export { app, server };
export default app;
