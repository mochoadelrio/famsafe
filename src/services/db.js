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

// Initial seed data representing a modern family
const initialData = {
  circles: [
    {
      id: "circle-garcia-001",
      name: "Familia García",
      inviteCode: "FAM789",
      plan: "pro_family", // freemium, pro_family, guardian_plus
      subscription: {
        status: "active",
        planName: "Plan Familiar Pro ($7.99/mes)",
        renewsAt: "2026-11-01T00:00:00.000Z",
        stripeCustomerId: "cus_demo_garcia123"
      },
      createdAt: new Date().toISOString()
    }
  ],
  members: [
    {
      id: "user-carlos-parent",
      circleId: "circle-garcia-001",
      name: "Carlos (Papá)",
      role: "guardian", // guardian, child, teen
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
      phone: "+34 600 111 222",
      battery: 88,
      isCharging: false,
      status: "stationary", // stationary, walking, driving, sos
      speedKmh: 0,
      privacyMode: "standard", // standard, teen_shield
      lastLocation: {
        lat: 40.416775,
        lng: -3.703790,
        accuracy: 10,
        timestamp: new Date().toISOString(),
        address: "Puerta del Sol, Madrid (Oficina)"
      }
    },
    {
      id: "user-elena-parent",
      circleId: "circle-garcia-001",
      name: "Elena (Mamá)",
      role: "guardian",
      avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80",
      phone: "+34 600 333 444",
      battery: 64,
      isCharging: false,
      status: "stationary",
      speedKmh: 0,
      privacyMode: "standard",
      lastLocation: {
        lat: 40.420000,
        lng: -3.701000,
        accuracy: 12,
        timestamp: new Date().toISOString(),
        address: "Gran Vía 32, Madrid"
      }
    },
    {
      id: "user-lucas-child",
      circleId: "circle-garcia-001",
      name: "Lucas (Hijo - 9 años)",
      role: "child",
      avatar: "https://images.unsplash.com/photo-1543610892-0b1f7e6d8ac1?w=150&auto=format&fit=crop&q=80",
      phone: "+34 600 555 666",
      battery: 42,
      isCharging: false,
      status: "stationary",
      speedKmh: 0,
      privacyMode: "strict_child", // 24/7 tracking, high precision
      currentZoneId: "zone-school-001",
      lastLocation: {
        lat: 40.412500,
        lng: -3.705000,
        accuracy: 8,
        timestamp: new Date().toISOString(),
        address: "Colegio San Martín (En clase)"
      }
    },
    {
      id: "user-sofia-teen",
      circleId: "circle-garcia-001",
      name: "Sofía (Hija - 15 años)",
      role: "teen",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
      phone: "+34 600 777 888",
      battery: 18, // Simulated low battery alert
      isCharging: false,
      status: "walking",
      speedKmh: 4.8,
      privacyMode: "teen_shield", // Smart privacy: notifies safe zones, exact route on transit or SOS
      currentZoneId: null,
      lastLocation: {
        lat: 40.414800,
        lng: -3.708200,
        accuracy: 15,
        timestamp: new Date().toISOString(),
        address: "Calle Mayor, Regresando a casa"
      }
    }
  ],
  safeZones: [
    {
      id: "zone-home-001",
      circleId: "circle-garcia-001",
      name: "Casa Familiar",
      icon: "home",
      lat: 40.418000,
      lng: -3.704000,
      radiusMeters: 120,
      color: "#10b981", // Emerald green
      notifyOnEntry: true,
      notifyOnExit: true
    },
    {
      id: "zone-school-001",
      circleId: "circle-garcia-001",
      name: "Colegio San Martín",
      icon: "school",
      lat: 40.412500,
      lng: -3.705000,
      radiusMeters: 180,
      color: "#3b82f6", // Blue
      notifyOnEntry: true,
      notifyOnExit: true,
      schedule: {
        days: [1, 2, 3, 4, 5],
        curfewEntry: "08:30",
        curfewExit: "16:30"
      }
    },
    {
      id: "zone-sports-001",
      circleId: "circle-garcia-001",
      name: "Club Deportivo",
      icon: "football",
      lat: 40.422000,
      lng: -3.712000,
      radiusMeters: 200,
      color: "#8b5cf6", // Purple
      notifyOnEntry: true,
      notifyOnExit: true
    }
  ],
  alerts: [
    {
      id: "alert-001",
      circleId: "circle-garcia-001",
      memberId: "user-lucas-child",
      type: "zone_entry", // zone_entry, zone_exit, low_battery, sos, walk_alert
      title: "Llegada al Colegio",
      message: "Lucas ha entrado a la zona segura 'Colegio San Martín'",
      timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
      read: true
    },
    {
      id: "alert-002",
      circleId: "circle-garcia-001",
      memberId: "user-sofia-teen",
      type: "low_battery",
      title: "Batería Baja",
      message: "El teléfono de Sofía tiene 18% de batería restante.",
      timestamp: new Date(Date.now() - 600000).toISOString(),
      read: false
    }
  ],
  activeWalkSessions: [],
  activeSosSessions: []
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

    member.lastLocation = {
      lat,
      lng,
      accuracy,
      timestamp: new Date().toISOString(),
      address: address || member.lastLocation?.address || "Coordenadas actualizadas"
    };
    member.speedKmh = speedKmh;
    member.status = status;
    if (battery !== undefined) {
      member.battery = battery;
    }
    this.save();
    return member;
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

  createFamilyAccount({ familyName, parentName, email, phone, password, plan = "pro_family" }) {
    if (!this.data.users) this.data.users = [];

    const existingUser = this.findUserByEmail(email);
    if (existingUser) {
      throw new Error("Ya existe una cuenta registrada con este correo electrónico.");
    }

    const circleId = `circle-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const memberId = `member-${Date.now()}-guardian`;
    const userId = `user-${Date.now()}`;
    const inviteCode = this.generateInviteCode(familyName.substring(0, 3) || "FAM");

    // 1. Create Circle
    const newCircle = {
      id: circleId,
      name: familyName,
      inviteCode,
      plan: plan || "pro_family",
      subscription: {
        status: "active",
        planName: plan === "basic" ? "Plan Básico ($49 MXN/mes)" : "Plan Familiar Pro ($149 MXN/mes)",
        renewsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
      },
      createdAt: new Date().toISOString()
    };
    this.data.circles.push(newCircle);

    // 2. Create Guardian Member
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
        lat: 19.4326, // Default CDMX coordinates
        lng: -99.1332,
        accuracy: 10,
        timestamp: new Date().toISOString(),
        address: "Ubicación inicial configurada"
      }
    };
    this.data.members.push(newMember);

    // 3. Create User Credential
    const newUser = {
      id: userId,
      email: email.toLowerCase(),
      password, // In a full prod app we bcrypt, for instant MVP simplicity
      name: parentName,
      circleId,
      memberId,
      role: "guardian",
      createdAt: new Date().toISOString()
    };
    this.data.users.push(newUser);

    // 4. Default Safe Zone: Casa Familiar
    const defaultZone = {
      id: `zone-${Date.now()}-home`,
      circleId,
      name: "Casa Familiar",
      icon: "home",
      lat: 19.4326,
      lng: -99.1332,
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

  joinFamilyWithCode({ inviteCode, memberName, role = "child", phone = "" }) {
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
        lat: 19.4326 + (Math.random() - 0.5) * 0.005,
        lng: -99.1332 + (Math.random() - 0.5) * 0.005,
        accuracy: 10,
        timestamp: new Date().toISOString(),
        address: "Dispositivo vinculado"
      }
    };

    this.data.members.push(newMember);

    const alert = this.addAlert({
      circleId: circle.id,
      memberId: newMember.id,
      type: "member_joined",
      title: "👋 Nuevo Integrante",
      message: `${memberName} se ha unido al círculo familiar '${circle.name}'.`
    });

    this.save();
    return { circle, member: newMember, alert };
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
}

export const db = new Database();
