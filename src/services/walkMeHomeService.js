import { db } from './db.js';

class WalkMeHomeManager {
  constructor() {
    this.activeTimers = new Map();
  }

  startSession(memberId, destinationName, estimatedMinutes = 15, io) {
    const member = db.getMemberById(memberId);
    if (!member) throw new Error("Miembro no encontrado");

    const expiresAt = new Date(Date.now() + estimatedMinutes * 60 * 1000).toISOString();

    const session = db.createWalkSession({
      circleId: member.circleId,
      memberId: member.id,
      memberName: member.name,
      destinationName,
      estimatedMinutes,
      expiresAt,
      startLocation: member.lastLocation
    });

    const alert = db.addAlert({
      circleId: member.circleId,
      memberId: member.id,
      type: 'walk_started',
      title: `🚶 Acompáñame a Casa Iniciado`,
      message: `${member.name} inició trayecto hacia '${destinationName}'. Tiempo estimado: ${estimatedMinutes} min.`
    });

    // Schedule check for expiration
    const timeoutMs = estimatedMinutes * 60 * 1000;
    const timerId = setTimeout(() => {
      this.handleTimeout(session.id, io);
    }, timeoutMs);

    this.activeTimers.set(session.id, timerId);

    if (io) {
      io.to(member.circleId).emit('walk:started', { session, alert });
    }

    return session;
  }

  finishSession(sessionId, io, reason = 'arrived_safe') {
    if (this.activeTimers.has(sessionId)) {
      clearTimeout(this.activeTimers.get(sessionId));
      this.activeTimers.delete(sessionId);
    }

    const session = db.completeWalkSession(sessionId);
    if (!session) return null;

    const alert = db.addAlert({
      circleId: session.circleId,
      memberId: session.memberId,
      type: 'walk_completed',
      title: `🛡️ Llegada a Salvo Confirmada`,
      message: `${session.memberName} confirmó haber llegado seguro a su destino: '${session.destinationName}'.`
    });

    if (io) {
      io.to(session.circleId).emit('walk:completed', { session, alert });
    }

    return session;
  }

  handleTimeout(sessionId, io) {
    const session = db.data.activeWalkSessions.find(s => s.id === sessionId && s.status === 'active');
    if (!session) return;

    session.status = 'expired_unconfirmed';
    db.save();

    const member = db.getMemberById(session.memberId);

    const alert = db.addAlert({
      circleId: session.circleId,
      memberId: session.memberId,
      type: 'walk_alert',
      title: `⚠️ TIEMPO AGOTADO: ${session.memberName} no ha confirmado llegada`,
      message: `El tiempo estimado (${session.estimatedMinutes} min) hacia '${session.destinationName}' expiró sin confirmación del usuario.`
    });

    if (io) {
      io.to(session.circleId).emit('walk:expired', { session, alert, member });
    }
  }
}

export const walkMeHomeService = new WalkMeHomeManager();
