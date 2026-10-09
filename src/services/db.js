import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'famsafe_db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Clean initial database structure (Zero test data)
const initialData = {
  circles: [],
  members: [],
  safeZones: [],
  alerts: [],
  users: [],
  activeWalkSessions: [],
  activeSosSessions: [],
  validatedPayments: []
};

class Database {
  constructor() {
    this.load();
  }

  load() {
    if (fs.existsSync(DATA_FILE)) {
      try {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        if (!this.data.validatedPayments) this.data.validatedPayments = [];
        return;
      } catch (err) {
        console.error("Error reading database file, restoring defaults:", err);
      }
    }
    this.data = JSON.parse(JSON.stringify(initialData));
    this.save();
  }

  save() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error("Error saving database file:", err);
    }
  }

  getCircles() {
    return this.data.circles;
  }

  getCircleById(circleId) {
    return this.data.circles.find(c => c.id === circleId);
  }

  getMembersByCircle(circleId) {
    return this.data.members.filter(m => m.circleId === circleId);
  }

  getMemberById(memberId) {
    return this.data.members.find(m => m.id === memberId);
  }

  updateMemberLocation(memberId, { lat, lng, accuracy = 10, speedKmh = 0, status = "walking", battery, address }) {
    const member = this.getMemberById(memberId);
    if (!member) return null;

    const nowIso = new Date().toISOString();
    const resolvedAddr = address || member.lastLocation?.address || "Coordenadas actualizadas";

    member.lastLocation = {
      lat,
      lng,
      accuracy,
      timestamp: nowIso,
      address: resolvedAddr
    };
    member.speedKmh = speedKmh;
    member.status = status;
    if (battery !== undefined) {
      member.battery = battery;
    }

    // Store in persistent Location History according to plan retention (7, 30, or 90 days)
    if (!Array.isArray(member.locationHistory)) {
      member.locationHistory = [];
    }

    const lastEntry = member.locationHistory[0];
    const isSameSpot = lastEntry &&
      Math.abs(lastEntry.lat - lat) < 0.0001 &&
      Math.abs(lastEntry.lng - lng) < 0.0001 &&
      (Date.now() - new Date(lastEntry.timestamp).getTime()) < 5 * 60 * 1000;

    if (isSameSpot) {
      lastEntry.timestamp = nowIso;
      lastEntry.address = resolvedAddr;
      lastEntry.battery = member.battery;
      lastEntry.speedKmh = speedKmh;
    } else {
      member.locationHistory.unshift({
        id: `loc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        lat,
        lng,
        accuracy,
        speedKmh,
        status,
        battery: member.battery,
        address: resolvedAddr,
        timestamp: nowIso
      });
    }

    // Apply retention policy based on Circle Subscription Plan (7, 30, or 90 days)
    const circle = this.getCircleById(member.circleId);
    const planId = circle?.plan || 'pro_family';
    const maxDays = planId === 'guardian_plus' ? 90 : planId === 'pro_family' ? 30 : 7;
    const cutoffTime = Date.now() - (maxDays * 24 * 60 * 60 * 1000);

    member.locationHistory = member.locationHistory
      .filter(entry => new Date(entry.timestamp).getTime() >= cutoffTime)
      .slice(0, 1500);

    this.save();
    return member;
  }

  getMemberLocationHistory(memberId, daysFilter = null) {
    const member = this.getMemberById(memberId);
    if (!member) return null;

    if (!Array.isArray(member.locationHistory) || member.locationHistory.length === 0) {
      if (member.lastLocation) {
        member.locationHistory = [{
          id: `loc-init-${member.id}`,
          lat: member.lastLocation.lat,
          lng: member.lastLocation.lng,
          accuracy: member.lastLocation.accuracy || 10,
          speedKmh: member.speedKmh || 0,
          status: member.status || 'stationary',
          battery: member.battery || 100,
          address: member.lastLocation.address || 'Ubicación registrada',
          timestamp: member.lastLocation.timestamp || new Date().toISOString()
        }];
        this.save();
      } else {
        return { member, history: [], maxDaysAllowed: 30 };
      }
    }

    const circle = this.getCircleById(member.circleId);
    const planId = circle?.plan || 'pro_family';
    const maxDaysAllowed = planId === 'guardian_plus' ? 90 : planId === 'pro_family' ? 30 : 7;
    const effectiveDays = daysFilter ? Math.min(daysFilter, maxDaysAllowed) : maxDaysAllowed;
    const cutoff = Date.now() - (effectiveDays * 24 * 60 * 60 * 1000);

    const history = member.locationHistory.filter(h => new Date(h.timestamp).getTime() >= cutoff);
    return {
      member: { id: member.id, name: member.name, role: member.role, avatar: member.avatar },
      planId,
      maxDaysAllowed,
      effectiveDays,
      history
    };
  }

  updateMemberBattery(memberId, battery, isCharging = false) {
    const member = this.getMemberById(memberId);
    if (!member) return null;
    member.battery = battery;
    member.isCharging = isCharging;
    this.save();
    return member;
  }

  getSafeZonesByCircle(circleId) {
    return this.data.safeZones.filter(z => z.circleId === circleId);
  }

  addSafeZone(zone) {
    this.data.safeZones.push(zone);
    this.save();
    return zone;
  }

  removeSafeZone(zoneId) {
    this.data.safeZones = this.data.safeZones.filter(z => z.id !== zoneId);
    this.save();
  }

  getAlerts(circleId) {
    return this.data.alerts
      .filter(a => a.circleId === circleId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  addAlert(alert) {
    const newAlert = {
      id: `alert-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      read: false,
      ...alert
    };
    this.data.alerts.unshift(newAlert);
    // Keep max 100 alerts
    if (this.data.alerts.length > 100) {
      this.data.alerts = this.data.alerts.slice(0, 100);
    }
    this.save();
    return newAlert;
  }

  // SOS Sessions
  createSos(sosData) {
    const sos = {
      id: `sos-${Date.now()}`,
      status: "active",
      startedAt: new Date().toISOString(),
      audioRecordings: [],
      ...sosData
    };
    this.data.activeSosSessions.push(sos);
    this.save();
    return sos;
  }

  resolveSos(sosId) {
    const sos = this.data.activeSosSessions.find(s => s.id === sosId);
    if (sos) {
      sos.status = "resolved";
      sos.resolvedAt = new Date().toISOString();
      this.save();
    }
    return sos;
  }

  getActiveSos(circleId) {
    return this.data.activeSosSessions.filter(s => s.circleId === circleId && s.status === "active");
  }

  // Walk With Me Sessions
  createWalkSession(walkData) {
    const session = {
      id: `walk-${Date.now()}`,
      status: "active",
      startedAt: new Date().toISOString(),
      ...walkData
    };
    this.data.activeWalkSessions.push(session);
    this.save();
    return session;
  }

  completeWalkSession(sessionId) {
    const session = this.data.activeWalkSessions.find(s => s.id === sessionId);
    if (session) {
      session.status = "completed";
      session.completedAt = new Date().toISOString();
      this.save();
    }
    return session;
  }

  getActiveWalkSessions(circleId) {
    return this.data.activeWalkSessions.filter(w => w.circleId === circleId && w.status === "active");
  }

  // Multi-tenant Family Circle Management
  findCircleByInviteCode(inviteCode) {
    if (!inviteCode) return null;
    const clean = inviteCode.trim().toUpperCase();
    return this.data.circles.find(c => c.inviteCode === clean);
  }

  findUserByEmail(email) {
    if (!this.data.users) this.data.users = [];
    return this.data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  generateInviteCode(prefix = "FAM") {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 3; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const num = Math.floor(100 + Math.random() * 900);
    return `${prefix.substring(0, 3).toUpperCase()}${num}`;
  }

  createFamilyAccount({ familyName, parentName, email, phone, password, plan = "pro_family", lat, lng, address, paymentMeta = null }) {
    if (!this.data.users) this.data.users = [];

    const existingUser = this.findUserByEmail(email);
    if (existingUser) {
      throw new Error("Ya existe una cuenta registrada con este correo electrónico.");
    }

    const circleId = `circle-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const memberId = `member-${Date.now()}-guardian`;
    const userId = `user-${Date.now()}`;
    const inviteCode = this.generateInviteCode(familyName.substring(0, 3) || "FAM");

    const initialLat = (lat !== undefined && !isNaN(lat)) ? parseFloat(lat) : 19.4326;
    const initialLng = (lng !== undefined && !isNaN(lng)) ? parseFloat(lng) : -99.1332;
    const initialAddress = address || "Casa Familiar (Ubicación GPS)";

    // 1. Create Circle
    const newCircle = {
      id: circleId,
      name: familyName,
      inviteCode,
      plan: plan || "pro_family",
      subscription: {
        status: "active",
        planName: plan === "basic" ? "Plan Básico ($29 MXN/mes)" : plan === "guardian_plus" ? "Guardian Plus ($149 MXN/mes)" : "Familiar Pro ($79 MXN/mes)",
        renewsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        paymentMeta: paymentMeta || null
      },
      createdAt: new Date().toISOString()
    };
    this.data.circles.push(newCircle);

    // 2. Create Guardian Member with real location
    const newMember = {
      id: memberId,
      circleId,
      name: `${parentName} (Tutor)`,
      role: "guardian",
      avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
      phone: phone || "",
      battery: 100,
      isCharging: false,
      status: "stationary",
      speedKmh: 0,
      privacyMode: "standard",
      lastLocation: {
        lat: initialLat,
        lng: initialLng,
        accuracy: 10,
        timestamp: new Date().toISOString(),
        address: initialAddress
      }
    };
    this.data.members.push(newMember);

    // 3. Create User Credential
    const newUser = {
      id: userId,
      email: email.toLowerCase(),
      password,
      name: parentName,
      circleId,
      memberId,
      role: "guardian",
      createdAt: new Date().toISOString()
    };
    this.data.users.push(newUser);

    // 4. Default Safe Zone: Casa Familiar (Centered at user's actual home location!)
    const defaultZone = {
      id: `zone-${Date.now()}-home`,
      circleId,
      name: "Casa Familiar",
      icon: "home",
      lat: initialLat,
      lng: initialLng,
      radiusMeters: 150,
      color: "#10b981",
      notifyOnEntry: true,
      notifyOnExit: true
    };
    this.data.safeZones.push(defaultZone);

    // 5. Initial Welcome Alert
    this.addAlert({
      circleId,
      memberId,
      type: "circle_created",
      title: "🎉 ¡Bienvenidos a FamSafe!",
      message: `Círculo '${familyName}' creado exitosamente. Tu código de invitación es ${inviteCode}.`
    });

    this.save();
    return { circle: newCircle, member: newMember, user: newUser };
  }

  joinFamilyWithCode({ inviteCode, memberName, role = "child", phone = "", lat, lng, address, email, password }) {
    const circle = this.findCircleByInviteCode(inviteCode);
    if (!circle) {
      throw new Error(`Código de invitación '${inviteCode}' no encontrado. Verifica con el administrador de la familia.`);
    }

    const memberId = `member-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const avatar = role === 'child'
      ? "https://images.unsplash.com/photo-1543610892-0b1f7e6d8ac1?w=150&auto=format&fit=crop&q=80"
      : role === 'teen'
      ? "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80"
      : "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80";

    const memberLat = (lat !== undefined && !isNaN(lat)) ? parseFloat(lat) : 19.4326;
    const memberLng = (lng !== undefined && !isNaN(lng)) ? parseFloat(lng) : -99.1332;

    const newMember = {
      id: memberId,
      circleId: circle.id,
      name: memberName,
      role: role || "child",
      avatar,
      phone: phone || "",
      battery: 95,
      isCharging: false,
      status: "stationary",
      speedKmh: 0,
      privacyMode: role === 'teen' ? 'teen_shield' : role === 'child' ? 'strict_child' : 'standard',
      lastLocation: {
        lat: memberLat,
        lng: memberLng,
        accuracy: 10,
        timestamp: new Date().toISOString(),
        address: address || "Dispositivo vinculado en tiempo real"
      }
    };

    this.data.members.push(newMember);

    // If user provided email and password, create login credential right away
    let newUser = null;
    if (email && password) {
      if (!this.data.users) this.data.users = [];
      const normalizedEmail = email.toLowerCase().trim();
      newUser = {
        id: `user-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        email: normalizedEmail,
        password,
        name: memberName,
        circleId: circle.id,
        memberId: newMember.id,
        role: role || "child",
        createdAt: new Date().toISOString()
      };
      const existingUserIdx = this.data.users.findIndex(u => u.email === normalizedEmail);
      if (existingUserIdx !== -1) {
        this.data.users[existingUserIdx] = newUser;
      } else {
        this.data.users.push(newUser);
      }
    }

    const alert = this.addAlert({
      circleId: circle.id,
      memberId: newMember.id,
      type: "member_joined",
      title: "👋 Nuevo Integrante",
      message: `${memberName} se ha unido al círculo familiar '${circle.name}'.`
    });

    this.save();
    return { circle, member: newMember, user: newUser, alert };
  }

  setMemberCredentials(memberId, email, password) {
    const member = this.getMemberById(memberId);
    if (!member) throw new Error("Miembro no encontrado.");
    if (!email || !password) throw new Error("Correo y contraseña requeridos.");

    if (!this.data.users) this.data.users = [];
    const normalizedEmail = email.toLowerCase().trim();

    const existing = this.data.users.find(u => u.email === normalizedEmail && u.memberId !== memberId);
    if (existing) {
      throw new Error("Este correo ya está registrado por otra cuenta.");
    }

    let user = this.data.users.find(u => u.memberId === memberId);
    if (user) {
      user.email = normalizedEmail;
      user.password = password;
      user.name = member.name;
    } else {
      user = {
        id: `user-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        email: normalizedEmail,
        password,
        name: member.name,
        circleId: member.circleId,
        memberId: member.id,
        role: member.role,
        createdAt: new Date().toISOString()
      };
      this.data.users.push(user);
    }
    this.save();
    return { user, member };
  }

  authenticateUser(email, password) {
    if (!this.data.users) this.data.users = [];
    const user = this.findUserByEmail(email);
    if (!user || user.password !== password) {
      throw new Error("Correo o contraseña incorrectos.");
    }
    const circle = this.getCircleById(user.circleId);
    const member = this.getMemberById(user.memberId);
    return { user, circle, member };
  }

  updateCirclePlan(circleId, planId, planName, paymentMeta = null) {
    const circle = this.getCircleById(circleId);
    if (!circle) throw new Error("Círculo no encontrado.");
    circle.plan = planId;
    circle.subscription = {
      status: "active",
      planName: planName || (planId === "basic" ? "Plan Básico ($29 MXN/mes)" : planId === "guardian_plus" ? "Guardian Plus ($149 MXN/mes)" : "Familiar Pro ($79 MXN/mes)"),
      renewsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      paymentMeta: paymentMeta || circle.subscription?.paymentMeta || null
    };
    this.save();
    return circle;
  }

  findPaymentByTrackingKey(trackingKey) {
    if (!this.data.validatedPayments) this.data.validatedPayments = [];
    const clean = (trackingKey || "").trim().toUpperCase();
    return this.data.validatedPayments.find(p => (p.trackingKey || "").toUpperCase() === clean);
  }

  recordValidatedPayment(paymentRecord) {
    if (!this.data.validatedPayments) this.data.validatedPayments = [];
    this.data.validatedPayments.push({
      id: `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date().toISOString(),
      ...paymentRecord
    });
    this.save();
  }

  renewCircleSubscription(circleId, { planId, billingPeriod = 'monthly', paymentMeta = null }) {
    const circle = this.getCircleById(circleId);
    if (!circle) throw new Error("Círculo no encontrado.");

    if (!circle.subscription) {
      circle.subscription = { status: "active", planName: "Familiar Pro ($79 MXN/mes)", renewsAt: new Date().toISOString() };
    }

    const currentRenewsAtMs = new Date(circle.subscription.renewsAt || circle.createdAt).getTime();
    const nowMs = Date.now();
    // If current subscription is still active in future, add time starting from expiration date!
    const baseMs = currentRenewsAtMs > nowMs ? currentRenewsAtMs : nowMs;
    const addedDays = billingPeriod === 'annual' ? 365 : 30;
    const newRenewsAt = new Date(baseMs + addedDays * 24 * 3600 * 1000).toISOString();

    const targetPlan = planId || circle.plan || 'pro_family';
    circle.plan = targetPlan;
    circle.subscription.status = "active";
    circle.subscription.renewsAt = newRenewsAt;
    if (paymentMeta) {
      circle.subscription.paymentMeta = paymentMeta;
    }

    this.save();
    return {
      circle,
      previousRenewsAt: new Date(currentRenewsAtMs).toISOString(),
      newRenewsAt
    };
  }

  adminUpdateCustomer(circleId, { plan, renewsAt, status, planName, isLifetime }) {
    const circle = this.getCircleById(circleId);
    if (!circle) throw new Error("Círculo no encontrado.");

    if (plan) circle.plan = plan;
    if (!circle.subscription) circle.subscription = {};
    if (status) circle.subscription.status = status;
    
    if (isLifetime !== undefined) {
      circle.subscription.isLifetime = isLifetime;
      if (isLifetime) {
        circle.subscription.renewsAt = null;
      }
    }
    
    if (renewsAt !== undefined) {
      if (!renewsAt || renewsAt === 'null' || renewsAt === 'vitalicio') {
        circle.subscription.renewsAt = null;
        circle.subscription.isLifetime = true;
      } else {
        circle.subscription.renewsAt = new Date(renewsAt).toISOString();
        circle.subscription.isLifetime = false;
      }
    }
    if (planName) circle.subscription.planName = planName;

    this.save();
    return circle;
  }
}

export const db = new Database();
