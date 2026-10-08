// Global State & Backend Resolution
const BACKEND_URL = '';
let CURRENT_CIRCLE_ID = localStorage.getItem('famsafe_circle_id');
if (CURRENT_CIRCLE_ID === 'circle-garcia-001' || CURRENT_CIRCLE_ID === 'undefined' || !CURRENT_CIRCLE_ID) {
  CURRENT_CIRCLE_ID = null;
  localStorage.removeItem('famsafe_circle_id');
}
let socket;
let map;
let memberMarkers = {}; // id -> L.marker
let zoneCircles = {};   // id -> L.circle
let previewZoneMarker = null;
let previewZoneCircle = null;
let isZonePickingActive = false;
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
let userLiveCoords = null;
let userCurrentLocationMarker = null;

// Map Initialization
function initMap() {
  map = L.map('map', {
    zoomControl: false
  }).setView([19.4326, -99.1332], 13); // Default Mexico City fallback until GPS coordinates arrive

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // OpenStreetMap 100% libre sin API key requerida
  tileLayerInstance = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  // Auto-detect real user city and location
  detectUserLocation();
}

function detectUserLocation() {
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLiveCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        console.log("📍 Ubicación GPS real detectada:", userLiveCoords);

        if (map) {
          // If no members are loaded yet, fly directly to user's real city/street!
          if (state.members.length === 0) {
            map.flyTo([userLiveCoords.lat, userLiveCoords.lng], 15, { duration: 1.5 });
          }

          // Add a pulsing blue dot for the current device
          if (!userCurrentLocationMarker) {
            const myDotHtml = `
              <div class="relative flex items-center justify-center">
                <div class="w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow-lg"></div>
                <div class="absolute w-8 h-8 bg-blue-500/30 rounded-full animate-ping"></div>
              </div>
            `;
            const icon = L.divIcon({ html: myDotHtml, className: '', iconSize: [32, 32], iconAnchor: [16, 16] });
            userCurrentLocationMarker = L.marker([userLiveCoords.lat, userLiveCoords.lng], { icon }).addTo(map);
            userCurrentLocationMarker.bindTooltip("<strong>📍 Tu ubicación actual</strong>", { permanent: false });
          } else {
            userCurrentLocationMarker.setLatLng([userLiveCoords.lat, userLiveCoords.lng]);
          }
        }
      },
      (err) => {
        console.warn("GPS no disponible o permiso no otorgado, usando ubicación por IP:", err.message);
        // Fallback to IP geolocation for city
        fetch('https://ipapi.co/json/')
          .then(r => r.json())
          .then(data => {
            if (data.latitude && data.longitude) {
              userLiveCoords = { lat: data.latitude, lng: data.longitude };
              if (map && state.members.length === 0) {
                map.flyTo([data.latitude, data.longitude], 13, { duration: 1.5 });
              }
            }
          })
          .catch(() => {});
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }
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
  if (!CURRENT_CIRCLE_ID) {
    state = { circle: null, members: [], safeZones: [], alerts: [], activeSos: [], activeWalks: [] };
    renderEmptyCircleState();
    openAuthModal();
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/circles/${CURRENT_CIRCLE_ID}`);
    if (!res.ok) {
      CURRENT_CIRCLE_ID = null;
      localStorage.removeItem('famsafe_circle_id');
      state = { circle: null, members: [], safeZones: [], alerts: [], activeSos: [], activeWalks: [] };
      renderEmptyCircleState();
      openAuthModal();
      return;
    }

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
    renderEmptyCircleState();
    openAuthModal();
  }
}

function renderEmptyCircleState() {
  document.getElementById('circle-name').innerText = "Sin Círculo Activo";
  document.getElementById('circle-code').innerText = "------";
  document.getElementById('plan-badge').innerText = "Crear Familia";

  const container = document.getElementById('members-container');
  container.innerHTML = `
    <div class="text-center p-6 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 space-y-3">
      <div class="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto text-2xl font-bold">
        <i class="ph-bold ph-users-three"></i>
      </div>
      <div>
        <h4 class="font-bold text-xs text-slate-800">Crea tu Círculo Familiar</h4>
        <p class="text-[11px] text-slate-500 mt-1">Registra a tu familia para comenzar a ver a tus seres queridos en este mapa.</p>
      </div>
      <button onclick="openAuthModal()" class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm transition">
        Crear Mi Familia
      </button>
    </div>
  `;

  const zonesContainer = document.getElementById('zones-container');
  if (zonesContainer) zonesContainer.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">No hay zonas configuradas</p>';
  const alertsContainer = document.getElementById('alerts-container');
  if (alertsContainer) alertsContainer.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Sin alertas recientes</p>';

  if (map) {
    Object.values(memberMarkers).forEach(m => map.removeLayer(m));
    memberMarkers = {};
    Object.values(zoneCircles).forEach(c => map.removeLayer(c));
    zoneCircles = {};
  }
}

// Render Top Bar Info
function renderHeader() {
  if (!state.circle) return;
  document.getElementById('circle-name').innerText = state.circle.name;
  document.getElementById('circle-code').innerText = state.circle.inviteCode;

  const plan = state.currentPlan || { name: "Plan Pro ($149 MXN/mes)" };
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

  if (state.members.length > 0) {
    centerMapOnCircle();
  } else if (state.safeZones.length > 0) {
    const firstZone = state.safeZones[0];
    map.flyTo([firstZone.lat, firstZone.lng], 15, { duration: 1.2 });
  } else if (userLiveCoords) {
    map.flyTo([userLiveCoords.lat, userLiveCoords.lng], 14, { duration: 1.2 });
  }
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

  socket.on('member:joined', ({ member, alert }) => {
    state.members.push(member);
    updateOrCreateMemberMarker(member);
    renderMembers();
    playChime('normal');
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
  ['members', 'zones', 'alerts'].forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (el) el.classList.add('hidden');
    if (btn) btn.className = "flex-1 py-3 px-2 border-b-2 border-transparent hover:text-slate-700 flex items-center justify-center gap-1.5";
  });

  const activeEl = document.getElementById(`tab-${tab}`);
  const activeBtn = document.getElementById(`tab-btn-${tab}`);
  if (activeEl) activeEl.classList.remove('hidden');
  if (activeBtn) activeBtn.className = "flex-1 py-3 px-2 border-b-2 border-blue-600 text-blue-600 font-bold flex items-center justify-center gap-1.5";

  if (tab === 'alerts') {
    document.getElementById('unread-alert-badge')?.classList.add('hidden');
  }
}

// Real Emergency SOS Action (No simulation)
async function triggerRealSos() {
  if (!state.circle) {
    alert("Debes crear o unirte a tu círculo familiar primero.");
    openAuthModal();
    return;
  }

  const member = state.members[0];
  if (!member) {
    alert("No se encontró ningún familiar activo en este círculo.");
    return;
  }

  const confirmSos = confirm(
    `🚨 ¿ACTIVAR ALERTA DE EMERGENCIA SOS?\n\nSe enviará una notificación prioritaria inmediata a toda tu familia con tu ubicación GPS en tiempo real.`
  );
  if (!confirmSos) return;

  playChime('emergency');

  let lat = userLiveCoords?.lat || member.lastLocation?.lat || 19.4326;
  let lng = userLiveCoords?.lng || member.lastLocation?.lng || -99.1332;
  let accuracy = userLiveCoords?.accuracy || 10;

  if ('geolocation' in navigator) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 6000 });
      });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      accuracy = pos.coords.accuracy;
    } catch (e) {
      console.warn("Using last known GPS position for SOS:", e.message);
    }
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/sos/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: member.id,
        lat,
        lng,
        accuracy,
        note: `🚨 SOS REAL activado desde el dispositivo de ${member.name}`
      })
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      alert("Error del servidor al emitir SOS.");
      return;
    }

    if (map) {
      map.flyTo([lat, lng], 17, { duration: 1.5 });
    }

    await fetchCircleData();
    alert("🚨 ¡Alerta de Emergencia SOS transmitida con éxito a tu familia!");
  } catch (err) {
    alert("Error al emitir alerta SOS: " + err.message);
  }
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
  document.getElementById('zone-pick-banner').classList.remove('hidden');
  isZonePickingActive = true;

  // Determine initial coordinates: userLiveCoords -> first safezone -> map center -> fallback
  let initLat = 19.4326;
  let initLng = -99.1332;

  if (userLiveCoords) {
    initLat = userLiveCoords.lat;
    initLng = userLiveCoords.lng;
  } else if (state.safeZones.length > 0) {
    initLat = state.safeZones[0].lat;
    initLng = state.safeZones[0].lng;
  } else if (map) {
    const center = map.getCenter();
    initLat = center.lat;
    initLng = center.lng;
  }

  document.getElementById('zone-lat-input').value = initLat.toFixed(6);
  document.getElementById('zone-lng-input').value = initLng.toFixed(6);

  const radius = parseInt(document.getElementById('zone-radius-input').value) || 150;
  const color = document.querySelector('input[name="zone-color"]:checked')?.value || '#10b981';

  updateOrCreateZonePreview(initLat, initLng, radius, color);

  if (map) {
    map.on('click', handleMapClickForZone);
    map.panTo([initLat, initLng]);
  }
}

function closeNewZoneModal() {
  document.getElementById('modal-zone').classList.add('hidden');
  document.getElementById('zone-pick-banner').classList.add('hidden');
  isZonePickingActive = false;

  if (map) {
    map.off('click', handleMapClickForZone);
    if (previewZoneMarker) {
      map.removeLayer(previewZoneMarker);
      previewZoneMarker = null;
    }
    if (previewZoneCircle) {
      map.removeLayer(previewZoneCircle);
      previewZoneCircle = null;
    }
  }

  clearZoneSearch();
}

function updateOrCreateZonePreview(lat, lng, radius, color) {
  if (!map) return;

  const previewIcon = L.divIcon({
    html: `
      <div class="flex items-center justify-center -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing">
        <div class="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-2xl border-2 border-white ring-4 ring-blue-500/30">
          <i class="ph-bold ph-shield-check text-xl"></i>
        </div>
      </div>
    `,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });

  if (previewZoneMarker) {
    previewZoneMarker.setLatLng([lat, lng]);
  } else {
    previewZoneMarker = L.marker([lat, lng], { icon: previewIcon, draggable: true }).addTo(map);
    previewZoneMarker.bindTooltip("<strong>📍 Mueve o arrastra aquí</strong>", { permanent: false, direction: 'top' });

    previewZoneMarker.on('drag', (e) => {
      const pos = e.target.getLatLng();
      if (previewZoneCircle) previewZoneCircle.setLatLng(pos);
      document.getElementById('zone-lat-input').value = pos.lat.toFixed(6);
      document.getElementById('zone-lng-input').value = pos.lng.toFixed(6);
    });

    previewZoneMarker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      reverseGeocodeZone(pos.lat, pos.lng);
    });
  }

  if (previewZoneCircle) {
    previewZoneCircle.setLatLng([lat, lng]);
    previewZoneCircle.setRadius(radius);
    previewZoneCircle.setStyle({ color, fillColor: color });
  } else {
    previewZoneCircle = L.circle([lat, lng], {
      radius: radius || 150,
      color: color || '#10b981',
      fillColor: color || '#10b981',
      fillOpacity: 0.25,
      weight: 2,
      dashArray: '6, 6'
    }).addTo(map);
  }
}

function handleMapClickForZone(e) {
  if (!isZonePickingActive) return;
  const lat = e.latlng.lat;
  const lng = e.latlng.lng;

  document.getElementById('zone-lat-input').value = lat.toFixed(6);
  document.getElementById('zone-lng-input').value = lng.toFixed(6);

  const radius = parseInt(document.getElementById('zone-radius-input').value) || 150;
  const color = document.querySelector('input[name="zone-color"]:checked')?.value || '#10b981';

  updateOrCreateZonePreview(lat, lng, radius, color);
  reverseGeocodeZone(lat, lng);
}

function updateZonePreviewRadius(radius) {
  document.getElementById('radius-val').innerText = `${radius}m`;
  if (previewZoneCircle) {
    previewZoneCircle.setRadius(parseInt(radius));
  }
}

function updateZonePreviewColor(color) {
  if (previewZoneCircle) {
    previewZoneCircle.setStyle({ color, fillColor: color });
  }
}

function onManualCoordsChange() {
  const lat = parseFloat(document.getElementById('zone-lat-input').value);
  const lng = parseFloat(document.getElementById('zone-lng-input').value);
  if (!isNaN(lat) && !isNaN(lng)) {
    const radius = parseInt(document.getElementById('zone-radius-input').value) || 150;
    const color = document.querySelector('input[name="zone-color"]:checked')?.value || '#10b981';
    updateOrCreateZonePreview(lat, lng, radius, color);
    if (map) map.panTo([lat, lng]);
  }
}

function setZoneToCurrentLocation() {
  if (userLiveCoords) {
    applyZoneCoords(userLiveCoords.lat, userLiveCoords.lng, "Mi Ubicación Actual");
  } else if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyZoneCoords(pos.coords.latitude, pos.coords.longitude, "Mi Ubicación Actual");
      },
      () => alert("No se pudo obtener la ubicación GPS.")
    );
  }
}

function focusZoneOnMap() {
  const lat = parseFloat(document.getElementById('zone-lat-input').value);
  const lng = parseFloat(document.getElementById('zone-lng-input').value);
  if (!isNaN(lat) && !isNaN(lng) && map) {
    map.flyTo([lat, lng], 16, { duration: 1.2 });
  }
}

function applyZoneCoords(lat, lng, suggestedName) {
  document.getElementById('zone-lat-input').value = parseFloat(lat).toFixed(6);
  document.getElementById('zone-lng-input').value = parseFloat(lng).toFixed(6);

  const radius = parseInt(document.getElementById('zone-radius-input').value) || 150;
  const color = document.querySelector('input[name="zone-color"]:checked')?.value || '#10b981';

  updateOrCreateZonePreview(lat, lng, radius, color);

  if (map) {
    map.flyTo([lat, lng], 16, { duration: 1.2 });
  }

  if (suggestedName && !document.getElementById('zone-name-input').value.trim()) {
    document.getElementById('zone-name-input').value = suggestedName;
  }
}

async function searchZoneLocation() {
  const input = document.getElementById('zone-search-input');
  const query = input.value.trim();
  if (!query) return;

  const btn = document.getElementById('zone-search-btn');
  const resultsContainer = document.getElementById('zone-search-results');
  btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i><span>...</span>';

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=1`);
    const results = await res.json();

    resultsContainer.innerHTML = '';
    if (!results || results.length === 0) {
      resultsContainer.innerHTML = `
        <div class="p-3 text-center text-slate-500">
          <p class="font-bold text-xs">No se encontraron resultados</p>
          <p class="text-[10px]">Prueba con otra calle, colegio o referencia</p>
        </div>
      `;
      resultsContainer.classList.remove('hidden');
      return;
    }

    results.forEach(item => {
      const row = document.createElement('div');
      row.className = "p-2.5 hover:bg-blue-50 cursor-pointer transition flex items-start gap-2.5";
      const shortName = item.name || item.display_name.split(',')[0];
      const addressDetail = item.display_name.split(',').slice(1, 4).join(',').trim();

      row.innerHTML = `
        <div class="w-6 h-6 rounded-md bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 mt-0.5">
          <i class="ph-bold ph-map-pin text-xs"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-slate-800 text-xs truncate">${shortName}</div>
          <div class="text-[10px] text-slate-500 truncate">${addressDetail}</div>
        </div>
      `;

      row.onclick = () => {
        applyZoneCoords(item.lat, item.lon, shortName);
        input.value = shortName;
        document.getElementById('zone-search-clear').classList.remove('hidden');
        resultsContainer.classList.add('hidden');
      };

      resultsContainer.appendChild(row);
    });

    resultsContainer.classList.remove('hidden');
    document.getElementById('zone-search-clear').classList.remove('hidden');
  } catch (err) {
    alert("Error buscando ubicación: " + err.message);
  } finally {
    btn.innerHTML = '<i class="ph-bold ph-magnifying-glass"></i><span>Buscar</span>';
  }
}

function clearZoneSearch() {
  document.getElementById('zone-search-input').value = '';
  document.getElementById('zone-search-clear').classList.add('hidden');
  document.getElementById('zone-search-results').classList.add('hidden');
  document.getElementById('zone-search-results').innerHTML = '';
}

async function reverseGeocodeZone(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    if (data && data.display_name) {
      const nameInput = document.getElementById('zone-name-input');
      const parts = data.display_name.split(',');
      const placeName = parts[0].trim();
      if (!nameInput.value.trim()) {
        nameInput.value = placeName;
      }
      const searchInput = document.getElementById('zone-search-input');
      searchInput.value = parts.slice(0, 3).join(',').trim();
      document.getElementById('zone-search-clear').classList.remove('hidden');
    }
  } catch (e) {
    // ignore network errors
  }
}

async function handleCreateZone(e) {
  e.preventDefault();
  const name = document.getElementById('zone-name-input').value;
  const lat = parseFloat(document.getElementById('zone-lat-input').value);
  const lng = parseFloat(document.getElementById('zone-lng-input').value);
  const radiusMeters = parseInt(document.getElementById('zone-radius-input').value);
  const color = document.querySelector('input[name="zone-color"]:checked')?.value || '#10b981';

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
    await fetchCircleData();
  } catch (err) {
    alert("Error creando zona: " + err.message);
  }
}

async function deleteSafeZone(zoneId) {
  if (confirm("¿Deseas eliminar esta zona segura?")) {
    await fetch(`${BACKEND_URL}/api/zones/${zoneId}`, { method: 'DELETE' });
    await fetchCircleData();
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
  const member = state.members[0];
  if (!member) {
    alert("Crea tu familia primero para probar el acompañamiento.");
    return;
  }
  // Start a 3-second walk to trigger expiry immediately
  const res = await fetch(`${BACKEND_URL}/api/walk/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      memberId: member.id,
      destinationName: 'Casa Familiar',
      estimatedMinutes: 0.05 // 3 seconds
    })
  });
}

function copyInviteCode() {
  const code = state.circle?.inviteCode || "FAM789";
  navigator.clipboard.writeText(code);
  alert(`¡Código ${code} copiado al portapapeles! Compártelo con el teléfono de tus familiares para unirse.`);
}

// Multi-tenant Auth & WhatsApp Modals
function openAuthModal() {
  document.getElementById('modal-auth').classList.remove('hidden');
}

function closeAuthModal() {
  document.getElementById('modal-auth').classList.add('hidden');
}

function switchAuthTab(tab) {
  ['create', 'join', 'login'].forEach(t => {
    document.getElementById(`form-${t === 'create' ? 'register-family' : t === 'join' ? 'join-family' : 'login-user'}`).classList.add('hidden');
    document.getElementById(`auth-tab-${t}`).className = "flex-1 pb-3 border-b-2 border-transparent hover:text-slate-700";
  });

  const activeForm = tab === 'create' ? 'form-register-family' : tab === 'join' ? 'form-join-family' : 'form-login-user';
  document.getElementById(activeForm).classList.remove('hidden');
  document.getElementById(`auth-tab-${tab}`).className = "flex-1 pb-3 border-b-2 border-blue-600 text-blue-600 font-bold";
}

function openInviteModal() {
  const code = state.circle?.inviteCode || "FAM789";
  document.getElementById('share-invite-code').innerText = code;
  document.getElementById('modal-invite').classList.remove('hidden');
}

function closeInviteModal() {
  document.getElementById('modal-invite').classList.add('hidden');
}

function shareViaWhatsApp() {
  const code = state.circle?.inviteCode || "FAM789";
  const family = state.circle?.name || "nuestra familia";
  const url = window.location.origin;
  const message = `¡Hola! Únete al círculo de seguridad de ${family} en FamSafe. Descarga o abre la app en: ${url} e ingresa este código de invitación: *${code}*`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(whatsappUrl, '_blank');
}

async function handleRegisterFamily(e) {
  e.preventDefault();
  const familyName = document.getElementById('reg-family-name').value;
  const parentName = document.getElementById('reg-parent-name').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/register-family`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        familyName,
        parentName,
        email,
        password,
        lat: userLiveCoords ? userLiveCoords.lat : undefined,
        lng: userLiveCoords ? userLiveCoords.lng : undefined
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      alert("Error al registrar familia. Verifica los datos e intenta nuevamente.");
      return;
    }
    if (data.error) {
      alert("Error: " + data.error);
      return;
    }

    // Switch active circle
    CURRENT_CIRCLE_ID = data.circle.id;
    localStorage.setItem('famsafe_circle_id', data.circle.id);
    closeAuthModal();
    openInviteModal();
    await fetchCircleData();
    if (socket) {
      socket.emit('circle:join', CURRENT_CIRCLE_ID);
    }
  } catch (err) {
    alert("Error al registrar familia: " + err.message);
  }
}

async function handleJoinFamily(e) {
  e.preventDefault();
  const inviteCode = document.getElementById('join-invite-code').value;
  const memberName = document.getElementById('join-member-name').value;
  const role = document.getElementById('join-member-role').value;

  try {
    const res = await fetch(`${BACKEND_URL}/api/circles/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteCode,
        memberName,
        role,
        lat: userLiveCoords ? userLiveCoords.lat : undefined,
        lng: userLiveCoords ? userLiveCoords.lng : undefined
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      alert("Código de invitación no válido o círculo no encontrado.");
      return;
    }
    if (data.error) {
      alert("Error: " + data.error);
      return;
    }

    CURRENT_CIRCLE_ID = data.circle.id;
    localStorage.setItem('famsafe_circle_id', data.circle.id);
    closeAuthModal();
    alert(`¡Te has unido exitosamente a la ${data.circle.name}!`);
    await fetchCircleData();
    if (socket) {
      socket.emit('circle:join', CURRENT_CIRCLE_ID);
    }
  } catch (err) {
    alert("Error al unirse: " + err.message);
  }
}

async function handleLoginUser(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      alert("Correo o contraseña incorrectos, o la cuenta aún no ha sido creada.");
      return;
    }
    if (data.error) {
      alert("Error: " + data.error);
      return;
    }

    CURRENT_CIRCLE_ID = data.circle.id;
    localStorage.setItem('famsafe_circle_id', data.circle.id);
    closeAuthModal();
    alert(`¡Bienvenido de vuelta, ${data.user.name}!`);
    await fetchCircleData();
    if (socket) {
      socket.emit('circle:join', CURRENT_CIRCLE_ID);
    }
  } catch (err) {
    alert("Error al iniciar sesión: " + err.message);
  }
}

// Socket listener for new member joining in realtime
// (placed inside setupSocket)

// Bootstrapping
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  fetchCircleData();
  setupSocket();
});
