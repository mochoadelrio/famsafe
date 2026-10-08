// Global State & Backend Resolution
const BACKEND_URL = window.location.hostname.includes('vercel.app')
  ? 'https://famsafe.onrender.com'
  : '';
const CURRENT_CIRCLE_ID = "circle-garcia-001";
let socket;
let map;
let memberMarkers = {}; // id -> L.marker
let zoneCircles = {};   // id -> L.circle
let state = {
  circle: null,
  members: [],
  safeZones: [],
  alerts: [],
  activeSos: [],
  activeWalks: []
};

// Web Audio API Synthesizer (Zero-dependency sound effects)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playChime(type = 'normal') {
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'normal') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } else if (type === 'emergency') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(900, audioCtx.currentTime);
      osc.frequency.linearRampToValueAtTime(450, audioCtx.currentTime + 0.3);
      osc.frequency.linearRampToValueAtTime(900, audioCtx.currentTime + 0.6);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.65);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.65);
    }
  } catch (e) {
    console.warn("Audio play prevented:", e);
  }
}

let currentTileLayer = 'osm';
let tileLayerInstance;

// Map Initialization
function initMap() {
  map = L.map('map', {
    zoomControl: false
  }).setView([40.416775, -3.703790], 15);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // OpenStreetMap 100% libre sin API key requerida
  tileLayerInstance = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);
}

function toggleSatelliteView() {
  if (currentTileLayer === 'osm') {
    map.removeLayer(tileLayerInstance);
    tileLayerInstance = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri World Imagery',
      maxZoom: 18
    }).addTo(map);
    currentTileLayer = 'satellite';
  } else {
    map.removeLayer(tileLayerInstance);
    tileLayerInstance = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    }).addTo(map);
    currentTileLayer = 'osm';
  }
}

// Fetch Full Initial State from Backend
async function fetchCircleData() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/circles/${CURRENT_CIRCLE_ID}`);
    const data = await res.json();
    state = data;

    renderHeader();
    renderMembers();
    renderSafeZones();
    renderAlerts();
    renderMapElements();
    checkActiveSos();
    checkActiveWalks();
  } catch (err) {
    console.error("Error fetching circle data:", err);
  }
}

// Render Top Bar Info
function renderHeader() {
  if (!state.circle) return;
  document.getElementById('circle-name').innerText = state.circle.name;
  document.getElementById('circle-code').innerText = state.circle.inviteCode;

  const plan = state.currentPlan || { name: "Plan Pro ($7.99/mes)" };
  document.getElementById('plan-badge').innerText = plan.name;
}

// Render Family Members in Sidebar
function renderMembers() {
  const container = document.getElementById('members-container');
  const walkSelect = document.getElementById('walk-member-select');
  container.innerHTML = '';
  walkSelect.innerHTML = '';

  state.members.forEach(member => {
    // Add to Walk Select
    const opt = document.createElement('option');
    opt.value = member.id;
    opt.innerText = member.name;
    walkSelect.appendChild(opt);

    const isSos = member.status === 'sos';
    const batteryColor = member.battery <= 20 ? 'bg-red-500' : member.battery <= 50 ? 'bg-amber-500' : 'bg-emerald-500';

    const card = document.createElement('div');
    card.className = `p-3 rounded-2xl border transition cursor-pointer ${
      isSos ? 'bg-red-50 border-red-300 shadow-sm shadow-red-100' : 'bg-white border-slate-200 hover:border-blue-400 hover:shadow-sm'
    }`;
    card.onclick = () => focusMemberOnMap(member.id);

    let roleBadge = '';
    if (member.role === 'child') {
      roleBadge = '<span class="text-[10px] bg-blue-100 text-blue-700 font-extrabold px-1.5 py-0.5 rounded">Hijo (9a)</span>';
    } else if (member.role === 'teen') {
      roleBadge = '<span class="text-[10px] bg-purple-100 text-purple-700 font-extrabold px-1.5 py-0.5 rounded">Adolescente (15a)</span>';
    } else {
      roleBadge = '<span class="text-[10px] bg-slate-100 text-slate-700 font-bold px-1.5 py-0.5 rounded">Tutor</span>';
    }

    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="relative">
          <img src="${member.avatar}" class="w-11 h-11 rounded-full object-cover border-2 ${isSos ? 'border-red-500 ring-2 ring-red-300' : 'border-slate-200'}">
          ${isSos ? '<span class="absolute -top-1 -right-1 bg-red-600 text-white rounded-full p-0.5 text-[10px] animate-ping">🚨</span>' : ''}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between">
            <h4 class="font-bold text-xs text-slate-900 truncate">${member.name}</h4>
            ${roleBadge}
          </div>
          <p class="text-[11px] text-slate-500 truncate mt-0.5">${member.lastLocation?.address || 'Ubicación actual'}</p>

          <!-- Battery & Status Bar -->
          <div class="flex items-center justify-between mt-2 pt-1 border-t border-slate-100 text-[10px] font-semibold text-slate-500">
            <div class="flex items-center gap-1.5">
              <i class="ph-bold ${member.battery <= 20 ? 'ph-battery-warning text-red-500' : 'ph-battery-charging text-slate-400'}"></i>
              <span>${member.battery}%</span>
              <div class="w-10 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full ${batteryColor}" style="width: ${member.battery}%"></div>
              </div>
            </div>
            <div class="flex items-center gap-1 text-slate-600">
              <i class="ph-bold ${member.status === 'walking' ? 'ph-person-simple-walk text-blue-600' : member.status === 'sos' ? 'ph-warning text-red-600' : 'ph-map-pin text-slate-400'}"></i>
              <span class="capitalize">${member.status === 'sos' ? '¡SOS!' : member.status === 'walking' ? `${member.speedKmh} km/h` : 'Estacionario'}</span>
            </div>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// Render Safe Zones in Sidebar
function renderSafeZones() {
  const container = document.getElementById('zones-container');
  container.innerHTML = '';

  state.safeZones.forEach(zone => {
    const card = document.createElement('div');
    card.className = "p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition flex items-center justify-between";
    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl flex items-center justify-center text-white" style="background-color: ${zone.color}">
          <i class="ph-bold ph-shield-check text-lg"></i>
        </div>
        <div>
          <h4 class="font-bold text-xs text-slate-900">${zone.name}</h4>
          <span class="text-[11px] text-slate-400 font-medium">Radio: ${zone.radiusMeters}m</span>
        </div>
      </div>
      <button onclick="deleteSafeZone('${zone.id}')" class="text-slate-300 hover:text-red-500 p-1" title="Eliminar zona">
        <i class="ph-bold ph-trash"></i>
      </button>
    `;
    container.appendChild(card);
  });
}

// Render Alerts in Sidebar
function renderAlerts() {
  const container = document.getElementById('alerts-container');
  container.innerHTML = '';

  state.alerts.slice(0, 15).forEach(alert => {
    const isSos = alert.type === 'sos';
    const isBattery = alert.type === 'low_battery';
    const isEntry = alert.type === 'zone_entry';

    let icon = 'ph-bell';
    let iconBg = 'bg-slate-100 text-slate-600';
    if (isSos) { icon = 'ph-warning'; iconBg = 'bg-red-100 text-red-600'; }
    else if (isBattery) { icon = 'ph-battery-warning'; iconBg = 'bg-amber-100 text-amber-600'; }
    else if (isEntry) { icon = 'ph-shield-check'; iconBg = 'bg-emerald-100 text-emerald-600'; }

    const item = document.createElement('div');
    item.className = `p-2.5 rounded-xl border text-xs ${isSos ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'} space-y-1`;
    item.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="w-6 h-6 rounded-lg ${iconBg} flex items-center justify-center shrink-0">
          <i class="ph-bold ${icon} text-sm"></i>
        </div>
        <strong class="font-bold text-slate-800 text-[11px] truncate flex-1">${alert.title}</strong>
        <span class="text-[10px] text-slate-400">${new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <p class="text-[11px] text-slate-600 pl-8 leading-snug">${alert.message}</p>
    `;
    container.appendChild(item);
  });
}

// Render Elements on Leaflet Map
function renderMapElements() {
  // 1. Draw Safe Zones (Geocences)
  Object.values(zoneCircles).forEach(c => map.removeLayer(c));
  zoneCircles = {};

  state.safeZones.forEach(zone => {
    const circle = L.circle([zone.lat, zone.lng], {
      color: zone.color,
      fillColor: zone.color,
      fillOpacity: 0.15,
      weight: 2,
      radius: zone.radiusMeters
    }).addTo(map);

    circle.bindTooltip(`<strong>${zone.name}</strong><br>Perímetro seguro`, { permanent: false, direction: 'top' });
    zoneCircles[zone.id] = circle;
  });

  // 2. Draw Members
  state.members.forEach(member => {
    updateOrCreateMemberMarker(member);
  });
}

function updateOrCreateMemberMarker(member) {
  if (!member.lastLocation) return;
  const isSos = member.status === 'sos';

  const customHtml = `
    <div class="custom-member-marker">
      <div class="marker-pulse-ring ${isSos ? 'sos' : ''}"></div>
      <div class="marker-avatar-container">
        <img src="${member.avatar}" class="marker-avatar-img" />
      </div>
      <div class="marker-name-tag">${member.name.split(' ')[0]} ${isSos ? '🚨' : ''}</div>
    </div>
  `;

  const customIcon = L.divIcon({
    html: customHtml,
    className: 'leaflet-custom-marker',
    iconSize: [52, 60],
    iconAnchor: [26, 30]
  });

  if (memberMarkers[member.id]) {
    memberMarkers[member.id].setLatLng([member.lastLocation.lat, member.lastLocation.lng]);
    memberMarkers[member.id].setIcon(customIcon);
  } else {
    const marker = L.marker([member.lastLocation.lat, member.lastLocation.lng], { icon: customIcon }).addTo(map);
    marker.on('click', () => focusMemberOnMap(member.id));
    memberMarkers[member.id] = marker;
  }
}

function focusMemberOnMap(memberId) {
  const member = state.members.find(m => m.id === memberId);
  if (member && member.lastLocation) {
    map.flyTo([member.lastLocation.lat, member.lastLocation.lng], 16, { duration: 1.2 });
  }
}

function centerMapOnCircle() {
  const group = [];
  state.members.forEach(m => {
    if (m.lastLocation) group.push([m.lastLocation.lat, m.lastLocation.lng]);
  });
  if (group.length > 0) {
    map.fitBounds(L.latLngBounds(group).pad(0.3));
  }
}

// WebSockets Connection & Event Listeners
function setupSocket() {
  socket = io(BACKEND_URL || undefined);

  socket.on('connect', () => {
    document.getElementById('connection-status').innerText = 'Sincronizado en vivo';
    socket.emit('circle:join', CURRENT_CIRCLE_ID);
  });

  socket.on('member:location_update', ({ member, alerts }) => {
    // Update local state
    const idx = state.members.findIndex(m => m.id === member.id);
    if (idx !== -1) {
      state.members[idx] = member;
    }
    updateOrCreateMemberMarker(member);
    renderMembers();
  });

  socket.on('alert:new', (alert) => {
    state.alerts.unshift(alert);
    renderAlerts();
    playChime(alert.type === 'sos' ? 'emergency' : 'normal');

    // Show unread dot if on another tab
    const activeTab = document.getElementById('tab-alerts').classList.contains('hidden');
    if (activeTab) {
      document.getElementById('unread-alert-badge').classList.remove('hidden');
    }
  });

  socket.on('sos:triggered', ({ sosSession, alert, member }) => {
    state.activeSos.push(sosSession);
    const idx = state.members.findIndex(m => m.id === member.id);
    if (idx !== -1) state.members[idx] = member;
    updateOrCreateMemberMarker(member);
    renderMembers();
    checkActiveSos();
    playChime('emergency');
    focusMemberOnMap(member.id);
  });

  socket.on('sos:resolved', ({ sosId, member }) => {
    state.activeSos = state.activeSos.filter(s => s.id !== sosId);
    if (member) {
      const idx = state.members.findIndex(m => m.id === member.id);
      if (idx !== -1) state.members[idx] = member;
      updateOrCreateMemberMarker(member);
      renderMembers();
    }
    checkActiveSos();
  });

  socket.on('walk:started', ({ session, alert }) => {
    state.activeWalks.push(session);
    checkActiveWalks();
  });

  socket.on('walk:completed', ({ session }) => {
    state.activeWalks = state.activeWalks.filter(w => w.id !== session.id);
    checkActiveWalks();
  });

  socket.on('walk:expired', ({ session, alert }) => {
    state.activeWalks = state.activeWalks.filter(w => w.id !== session.id);
    checkActiveWalks();
    playChime('emergency');
  });

  socket.on('zone:created', (zone) => {
    state.safeZones.push(zone);
    renderSafeZones();
    renderMapElements();
  });

  socket.on('zone:deleted', ({ zoneId }) => {
    state.safeZones = state.safeZones.filter(z => z.id !== zoneId);
    renderSafeZones();
    renderMapElements();
  });

  socket.on('billing:updated', ({ circle, plan }) => {
    state.circle = circle;
    state.currentPlan = plan;
    renderHeader();
  });
}

function checkActiveSos() {
  const banner = document.getElementById('sos-active-banner');
  if (state.activeSos && state.activeSos.length > 0) {
    const current = state.activeSos[0];
    document.getElementById('sos-banner-title').innerText = `¡EMERGENCIA SOS ACTIVA: ${current.memberName.toUpperCase()}!`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function checkActiveWalks() {
  const card = document.getElementById('walk-floating-card');
  if (state.activeWalks && state.activeWalks.length > 0) {
    const current = state.activeWalks[0];
    document.getElementById('walk-floating-member').innerText = `${current.memberName} $\\to$ ${current.destinationName}`;
    card.classList.remove('hidden');
  } else {
    card.classList.add('hidden');
  }
}

// Tab Switching
function switchTab(tab) {
  ['members', 'zones', 'alerts', 'sim'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.add('hidden');
    document.getElementById(`tab-btn-${t}`).className = "flex-1 py-3 px-2 border-b-2 border-transparent hover:text-slate-700 flex items-center justify-center gap-1.5";
  });

  document.getElementById(`tab-${tab}`).classList.remove('hidden');
  document.getElementById(`tab-btn-${tab}`).className = "flex-1 py-3 px-2 border-b-2 border-blue-600 text-blue-600 font-bold flex items-center justify-center gap-1.5";

  if (tab === 'alerts') {
    document.getElementById('unread-alert-badge').classList.add('hidden');
  }
}

// Simulator Actions
async function simulateMoveKid(target) {
  await fetch(`${BACKEND_URL}/api/simulation/move-kid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId: 'user-lucas-child', target })
  });
  focusMemberOnMap('user-lucas-child');
}

async function simulateLowBattery(memberId, battery) {
  await fetch(`${BACKEND_URL}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      memberId,
      lat: 40.4148,
      lng: -3.7082,
      battery: battery
    })
  });
}

async function triggerDemoSos() {
  await fetch(`${BACKEND_URL}/api/sos/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      memberId: 'user-lucas-child',
      note: 'Simulación de SOS desde el botón de pánico del menor'
    })
  });
}

async function resolveCurrentSos() {
  if (state.activeSos.length === 0) return;
  const current = state.activeSos[0];
  await fetch(`${BACKEND_URL}/api/sos/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sosId: current.id })
  });
}

function playDemoSiren() {
  playChime('emergency');
}

// Modal Handlers
function openPricingModal() {
  document.getElementById('modal-pricing').classList.remove('hidden');
}

function closePricingModal() {
  document.getElementById('modal-pricing').classList.add('hidden');
}

async function selectPlan(planId) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/billing/upgrade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ circleId: CURRENT_CIRCLE_ID, planId })
    });
    const data = await res.json();
    if (data.success) {
      closePricingModal();
    }
  } catch (err) {
    alert("Error al actualizar plan: " + err.message);
  }
}

function openNewZoneModal() {
  document.getElementById('modal-zone').classList.remove('hidden');
}

function closeNewZoneModal() {
  document.getElementById('modal-zone').classList.add('hidden');
}

async function handleCreateZone(e) {
  e.preventDefault();
  const name = document.getElementById('zone-name-input').value;
  const lat = parseFloat(document.getElementById('zone-lat-input').value);
  const lng = parseFloat(document.getElementById('zone-lng-input').value);
  const radiusMeters = parseInt(document.getElementById('zone-radius-input').value);
  const color = document.querySelector('input[name="zone-color"]:checked').value;

  try {
    const res = await fetch(`${BACKEND_URL}/api/zones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        circleId: CURRENT_CIRCLE_ID,
        name,
        lat,
        lng,
        radiusMeters,
        color
      })
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      openPricingModal();
      return;
    }
    closeNewZoneModal();
  } catch (err) {
    alert("Error creando zona: " + err.message);
  }
}

async function deleteSafeZone(zoneId) {
  if (confirm("¿Deseas eliminar esta zona segura?")) {
    await fetch(`${BACKEND_URL}/api/zones/${zoneId}`, { method: 'DELETE' });
  }
}

function openWalkModal() {
  document.getElementById('modal-walk').classList.remove('hidden');
}

function closeWalkModal() {
  document.getElementById('modal-walk').classList.add('hidden');
}

async function handleStartWalk(e) {
  e.preventDefault();
  const memberId = document.getElementById('walk-member-select').value;
  const destinationName = document.getElementById('walk-dest-input').value;
  const estimatedMinutes = parseInt(document.getElementById('walk-time-select').value);

  await fetch(`${BACKEND_URL}/api/walk/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId, destinationName, estimatedMinutes })
  });

  closeWalkModal();
}

async function completeCurrentWalk() {
  if (state.activeWalks.length === 0) return;
  const current = state.activeWalks[0];
  await fetch(`${BACKEND_URL}/api/walk/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: current.id })
  });
}

async function simulateWalkExpiry() {
  // Start a 1-second walk to trigger expiry immediately
  const res = await fetch(`${BACKEND_URL}/api/walk/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      memberId: 'user-sofia-teen',
      destinationName: 'Casa Familiar',
      estimatedMinutes: 0.05 // 3 seconds
    })
  });
}

function copyInviteCode() {
  navigator.clipboard.writeText(state.circle.inviteCode);
  alert(`¡Código ${state.circle.inviteCode} copiado al portapapeles! Compártelo con el teléfono de tus familiares para unirse.`);
}

// Bootstrapping
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  fetchCircleData();
  setupSocket();
});
