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
let gpsWatchId = null;
let lastSyncedCoords = null;
let hasCenteredOnRealGps = false;

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

function handleGpsSuccess(pos, forceCenter = false) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const accuracy = Math.round(pos.coords.accuracy || 10);
  const speedMps = pos.coords.speed || 0;
  const speedKmh = Math.max(0, Math.round(speedMps * 3.6));

  userLiveCoords = { lat, lng, accuracy, speedKmh };
  console.log("📍 Ubicación GPS real detectada:", userLiveCoords);

  if (map) {
    // Add or update pulsing blue dot for the current device
    if (!userCurrentLocationMarker) {
      const myDotHtml = `
        <div class="relative flex items-center justify-center">
          <div class="w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow-lg"></div>
          <div class="absolute w-8 h-8 bg-blue-500/30 rounded-full animate-ping"></div>
        </div>
      `;
      const icon = L.divIcon({ html: myDotHtml, className: '', iconSize: [32, 32], iconAnchor: [16, 16] });
      userCurrentLocationMarker = L.marker([lat, lng], { icon }).addTo(map);
      userCurrentLocationMarker.bindTooltip("<strong>📍 Tu ubicación GPS exacta</strong>", { permanent: false });
    } else {
      userCurrentLocationMarker.setLatLng([lat, lng]);
    }
  }

  const shouldCenter = forceCenter || !hasCenteredOnRealGps;
  hasCenteredOnRealGps = true;
  syncActiveMemberLocation(userLiveCoords, shouldCenter);
}

async function syncActiveMemberLocation(coords, shouldFlyTo = false, targetMemberId = null) {
  if (!coords) return;

  if (!state.members || state.members.length === 0) {
    if (shouldFlyTo && map) {
      map.flyTo([coords.lat, coords.lng], 16, { duration: 1.3 });
    }
    return;
  }

  const storedMemberId = targetMemberId || localStorage.getItem('famsafe_current_member_id');
  const myMember = (storedMemberId && state.members.find(m => m.id === storedMemberId))
    || state.members.find(m => m.role === 'guardian')
    || state.members[0];

  if (!myMember) return;

  const prevAddr = (myMember.lastLocation?.address && myMember.lastLocation.address !== 'Casa Familiar (Ubicación GPS)')
    ? myMember.lastLocation.address
    : 'Actualizando dirección GPS...';

  myMember.lastLocation = {
    lat: coords.lat,
    lng: coords.lng,
    accuracy: coords.accuracy || 10,
    timestamp: new Date().toISOString(),
    address: prevAddr
  };
  myMember.speedKmh = coords.speedKmh || 0;
  if (myMember.status !== 'sos') {
    myMember.status = (coords.speedKmh && coords.speedKmh > 2) ? 'walking' : 'stationary';
  }

  updateOrCreateMemberMarker(myMember);
  renderMembers();

  if (shouldFlyTo && map) {
    map.flyTo([coords.lat, coords.lng], 16, { duration: 1.3 });
  }

  // Avoid duplicate telemetry requests if position changed by less than ~8 meters and not forced
  if (!shouldFlyTo && lastSyncedCoords) {
    const dLat = Math.abs(coords.lat - lastSyncedCoords.lat);
    const dLng = Math.abs(coords.lng - lastSyncedCoords.lng);
    if (dLat < 0.00008 && dLng < 0.00008) return;
  }
  lastSyncedCoords = { lat: coords.lat, lng: coords.lng };

  // Reverse geocode street and neighborhood via OpenStreetMap Nominatim
  let resolvedAddress = 'Ubicación GPS en vivo';
  try {
    const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.lat}&lon=${coords.lng}`, {
      headers: { 'Accept-Language': 'es' }
    });
    if (geoRes.ok) {
      const geoData = await geoRes.json();
      if (geoData && geoData.address) {
        const road = geoData.address.road || geoData.address.pedestrian || geoData.address.residential || '';
        const suburb = geoData.address.suburb || geoData.address.neighbourhood || geoData.address.city_district || '';
        const city = geoData.address.city || geoData.address.town || geoData.address.municipality || geoData.address.state || '';
        const parts = [road, suburb !== road ? suburb : '', city].filter(Boolean);
        if (parts.length > 0) {
          resolvedAddress = parts.slice(0, 3).join(', ');
        } else if (geoData.display_name) {
          resolvedAddress = geoData.display_name.split(',').slice(0, 3).join(',');
        }
      }
    }
  } catch (e) {
    resolvedAddress = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
  }

  myMember.lastLocation.address = resolvedAddress;
  renderMembers();

  // Persist to AWS backend & notify circle
  try {
    await fetch(`${BACKEND_URL}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: myMember.id,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy || 10,
        speedKmh: coords.speedKmh || 0,
        status: myMember.status,
        battery: myMember.battery,
        isCharging: myMember.isCharging,
        address: resolvedAddress
      })
    });
  } catch (err) {
    console.warn("Error enviando telemetría GPS:", err);
  }
}

function forceRefreshMyGps(memberId = null) {
  if (memberId) {
    localStorage.setItem('famsafe_current_member_id', memberId);
  }
  if (!('geolocation' in navigator)) {
    alert("Tu navegador no soporta geolocalización GPS.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lastSyncedCoords = null; // Force backend sync & reverse geocode
      handleGpsSuccess(pos, true);
    },
    (err) => {
      alert("Permiso de ubicación GPS requerido. Asegúrate de permitir el acceso a la ubicación en el icono del candado junto a la barra de direcciones.");
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function detectUserLocation() {
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => handleGpsSuccess(pos, true),
      (err) => {
        console.warn("GPS de alta precisión no disponible, intentando estándar / IP:", err.message);
        navigator.geolocation.getCurrentPosition(
          (pos) => handleGpsSuccess(pos, true),
          () => {
            fetch('https://ipapi.co/json/')
              .then(r => r.json())
              .then(data => {
                if (data.latitude && data.longitude) {
                  userLiveCoords = { lat: data.latitude, lng: data.longitude, accuracy: 500, speedKmh: 0 };
                  syncActiveMemberLocation(userLiveCoords, true);
                }
              })
              .catch(() => {});
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );

    if (gpsWatchId !== null) {
      navigator.geolocation.clearWatch(gpsWatchId);
    }
    gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => handleGpsSuccess(pos, false),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
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

    // Immediately apply real device GPS coordinates if already acquired
    if (userLiveCoords) {
      lastSyncedCoords = null;
      syncActiveMemberLocation(userLiveCoords, true);
    }

    renderHeader();
    renderMembers();
    renderSafeZones();
    renderAlerts();
    renderMapElements();
    checkActiveSos();
    checkActiveWalks();
    checkSubscriptionExpiration();
    initLiveBatterySync();
    detectUserLocation();
  } catch (err) {
    console.error("Error fetching circle data:", err);
    renderEmptyCircleState();
    openAuthModal();
  }
}

function checkSubscriptionExpiration() {
  const banner = document.getElementById('subscription-expiring-banner');
  if (!banner) return;
  if (!state.circle || !state.circle.subscription) {
    banner.classList.add('hidden');
    return;
  }

  const renewsAt = state.circle.subscription.renewsAt;
  if (!renewsAt) {
    banner.classList.add('hidden');
    return;
  }

  const renewsDate = new Date(renewsAt);
  const now = new Date();
  const diffMs = renewsDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 3600 * 24));

  // If 3 days or fewer remaining (or already expired diffDays <= 0)
  if (diffDays <= 3) {
    const formattedDate = renewsDate.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });

    const titleElem = document.getElementById('sub-banner-title');
    const dateElem = document.getElementById('sub-banner-date');
    const descElem = document.getElementById('sub-banner-desc');

    if (diffDays <= 0) {
      if (titleElem) titleElem.innerText = `¡Tu suscripción ha vencido hoy!`;
      if (descElem) descElem.innerHTML = `Venció el <strong class="text-white underline">${formattedDate}</strong>. Renueva ahora o haz un Upgrade: tu nuevo periodo se reactivará de inmediato manteniendo a tu familia segura.`;
    } else if (diffDays === 1) {
      if (titleElem) titleElem.innerText = `¡Tu suscripción vence mañana!`;
      if (descElem) descElem.innerHTML = `Vence el <strong class="text-white underline">${formattedDate}</strong>. Si renuevas hoy, tu nuevo periodo empezará exactamente el <strong class="text-white underline">${formattedDate}</strong> sin perder días.`;
    } else {
      if (titleElem) titleElem.innerText = `¡Tu suscripción está por vencer en ${diffDays} días!`;
      if (descElem) descElem.innerHTML = `Vence el <strong class="text-white underline">${formattedDate}</strong>. Renueva o mejora tu plan: tu periodo se extenderá a partir de dicha fecha sin perder días.`;
    }

    if (dateElem) dateElem.innerText = formattedDate;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function renderEmptyCircleState() {
  document.getElementById('circle-name').innerText = "Sin Círculo Activo";
  document.getElementById('circle-code').innerText = "------";
  document.getElementById('plan-badge').innerText = "Crear Familia";
  document.getElementById('subscription-expiring-banner')?.classList.add('hidden');

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

  if (state.circle.subscription?.isLifetime || !state.circle.subscription?.renewsAt || state.circle.subscription?.isFounder) {
    document.getElementById('plan-badge').innerText = state.circle.subscription?.planName || "Guardian Plus (Vitalicio)";
  } else {
    const plan = state.currentPlan || { name: "Plan Pro ($79 MXN/mes)" };
    document.getElementById('plan-badge').innerText = plan.name;
  }
}

// Render Family Members in Sidebar
function renderMembers() {
  const container = document.getElementById('members-container');
  const walkSelect = document.getElementById('walk-member-select');
  container.innerHTML = '';
  walkSelect.innerHTML = '';

  const mobileCountElem = document.getElementById('mobile-member-count');
  if (mobileCountElem) mobileCountElem.innerText = state.members.length;

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
            <div onclick="event.stopPropagation(); calibrateMemberBattery('${member.id}', ${member.battery})" title="Batería: ${member.battery}%. Clic para calibrar manualmente." class="flex items-center gap-1.5 cursor-pointer hover:text-blue-600 transition">
              <i class="ph-bold ${member.battery <= 20 ? 'ph-battery-warning text-red-500' : member.isCharging ? 'ph-battery-charging text-emerald-500' : 'ph-battery-high text-slate-400'}"></i>
              <span>${member.battery}%</span>
              <div class="w-10 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full ${batteryColor}" style="width: ${member.battery}%"></div>
              </div>
            </div>
            <div onclick="event.stopPropagation(); forceRefreshMyGps('${member.id}')" class="flex items-center gap-1 text-blue-600 hover:text-blue-800 cursor-pointer transition" title="Clic para actualizar tu ubicación GPS exacta en este momento">
              <i class="ph-bold ${member.status === 'walking' ? 'ph-person-simple-walk text-blue-600' : member.status === 'sos' ? 'ph-warning text-red-600' : 'ph-gps-fix text-blue-600'}"></i>
              <span class="capitalize">${member.status === 'sos' ? '¡SOS!' : member.status === 'walking' ? `${member.speedKmh} km/h` : 'Actualizar GPS'}</span>
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
    if (window.innerWidth < 768) {
      toggleMobileSheet(false);
    }
  }
}

function centerMapOnCircle() {
  const group = [];
  state.members.forEach(m => {
    if (m.lastLocation) group.push([m.lastLocation.lat, m.lastLocation.lng]);
  });
  if (group.length === 1) {
    map.flyTo(group[0], 16, { duration: 1.2 });
  } else if (group.length > 1) {
    map.fitBounds(L.latLngBounds(group).pad(0.3));
  } else if (userLiveCoords) {
    map.flyTo([userLiveCoords.lat, userLiveCoords.lng], 16, { duration: 1.2 });
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

    // Trigger Native Device Notification with Vibration
    let notifTitle = "🔔 Alerta FamSafe";
    let notifType = 'normal';
    if (alert.type === 'sos') {
      notifTitle = "🚨 ¡EMERGENCIA SOS ACTIVADA!";
      notifType = 'emergency';
    } else if (alert.type === 'zone_exit') {
      notifTitle = "⚠️ Salida de Zona Segura";
    } else if (alert.type === 'zone_enter') {
      notifTitle = "📍 Llegada a Zona Segura";
    } else if (alert.type === 'battery_low') {
      notifTitle = "🪫 Alerta de Batería Baja";
    } else if (alert.type === 'walk_timeout') {
      notifTitle = "⚠️ Trayecto Expirado";
      notifType = 'emergency';
    }
    sendDeviceNotification(notifTitle, alert.message, notifType);

    // Show unread dot if on another tab
    const activeTab = document.getElementById('tab-alerts').classList.contains('hidden');
    if (activeTab) {
      document.getElementById('unread-alert-badge')?.classList.remove('hidden');
      document.getElementById('mobile-alert-dot')?.classList.remove('hidden');
    }
  });

  socket.on('member:joined', ({ member, alert }) => {
    state.members.push(member);
    updateOrCreateMemberMarker(member);
    renderMembers();
    playChime('normal');
    sendDeviceNotification("👤 Nuevo Integrante", `${member.name} se unió a tu familia.`, 'normal');
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
    sendDeviceNotification("🚨 ¡ALERTA SOS FAMILIAR!", `${member.name} necesita auxilio inmediato. Toca para ver su posición GPS en vivo.`, 'emergency');
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
    sendDeviceNotification("✅ SOS Resuelto", `La alerta de pánico ha sido desactivada.`, 'normal');
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
    sendDeviceNotification("⚠️ 'Acompáñame a Casa' Expiró", `No se confirmó la llegada a tiempo. Revisa la última ubicación en el mapa.`, 'emergency');
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
    checkSubscriptionExpiration();
  });

  socket.on('circle:subscription_updated', (circle) => {
    if (state.circle && state.circle.id === circle.id) {
      state.circle = circle;
      renderHeader();
      checkSubscriptionExpiration();
    }
  });

  socket.on('subscription:renewed', ({ circle }) => {
    if (state.circle && state.circle.id === circle.id) {
      state.circle = circle;
      renderHeader();
      checkSubscriptionExpiration();
    }
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
    document.getElementById('mobile-alert-dot')?.classList.add('hidden');
  }
}

// Mobile Responsive Sheet & Navigation
let isMobileSheetExpanded = false;

function toggleMobileSheet(forceState) {
  const sheet = document.getElementById('sidebar-panel');
  if (!sheet) return;

  if (typeof forceState === 'boolean') {
    isMobileSheetExpanded = forceState;
  } else {
    isMobileSheetExpanded = !isMobileSheetExpanded;
  }

  const chevron = document.getElementById('mobile-sheet-chevron');
  const actionText = document.getElementById('mobile-sheet-action-text');

  sheet.classList.remove('mobile-sheet-hidden');

  if (isMobileSheetExpanded) {
    sheet.classList.remove('mobile-sheet-collapsed');
    sheet.classList.add('mobile-sheet-expanded');
    if (chevron) chevron.className = "ph-bold ph-caret-down text-xs";
    if (actionText) actionText.innerText = "Ocultar";
  } else {
    sheet.classList.remove('mobile-sheet-expanded');
    sheet.classList.add('mobile-sheet-collapsed');
    if (chevron) chevron.className = "ph-bold ph-caret-up text-xs";
    if (actionText) actionText.innerText = "Ver Lista";
  }
  if (map) {
    setTimeout(() => map.invalidateSize(), 320);
  }
}

function handleMobileNav(tab) {
  const navTabs = ['map', 'members', 'zones', 'alerts'];
  navTabs.forEach(t => {
    const btn = document.getElementById(`nav-btn-${t}`);
    if (btn) {
      if (t === tab) {
        btn.className = "flex-1 py-1 flex flex-col items-center justify-center text-[10px] font-bold text-blue-600 transition";
      } else {
        btn.className = "flex-1 py-1 flex flex-col items-center justify-center text-[10px] font-bold text-slate-500 hover:text-blue-600 transition relative";
      }
    }
  });

  const sheet = document.getElementById('sidebar-panel');
  if (tab === 'map') {
    // Hide sheet completely to reveal full screen map
    if (sheet) {
      sheet.classList.remove('mobile-sheet-expanded');
      sheet.classList.add('mobile-sheet-collapsed');
      isMobileSheetExpanded = false;
    }
    if (map) {
      setTimeout(() => {
        map.invalidateSize();
        centerMapOnCircle();
      }, 150);
    }
  } else {
    // Switch tab inside sheet and expand sheet
    switchTab(tab);
    toggleMobileSheet(true);
  }
}

function openMobileMenu() {
  const menu = document.getElementById('modal-mobile-menu');
  if (!menu) return;
  const circleName = document.getElementById('mobile-menu-circle-name');
  if (circleName) circleName.innerText = state.circle ? `${state.circle.name} (${state.circle.inviteCode})` : "Sin Familia";
  const planName = document.getElementById('mobile-menu-plan');
  if (planName) planName.innerText = state.circle?.subscription?.planName || "Familiar Pro ($79 MXN)";
  menu.classList.remove('hidden');
}

function closeMobileMenu() {
  document.getElementById('modal-mobile-menu')?.classList.add('hidden');
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
// Modal Handlers
let modalBillingPeriod = 'monthly';
let currentCheckoutMode = 'standard'; // 'standard' | 'renewal' | 'upgrade'
let pricingModalContext = 'standard';

function openPricingModal(context = 'standard') {
  pricingModalContext = context;
  document.getElementById('modal-pricing')?.classList.remove('hidden');
}

function closePricingModal() {
  document.getElementById('modal-pricing')?.classList.add('hidden');
  pricingModalContext = 'standard';
}

function handleBannerRenewClick() {
  const currentPlan = state.circle?.plan || 'pro_family';
  openCheckoutModal(currentPlan, 'renewal');
}

function handleBannerUpgradeClick() {
  openPricingModal('upgrade');
}

function setModalBillingPeriod(period) {
  modalBillingPeriod = period;
  const isAnnual = period === 'annual';

  const btnMonthly = document.getElementById('modal-billing-monthly');
  const btnAnnual = document.getElementById('modal-billing-annual');

  if (isAnnual) {
    if (btnAnnual) btnAnnual.className = "px-4 py-1.5 rounded-full bg-white shadow-sm text-slate-900 transition flex items-center gap-1.5";
    if (btnMonthly) btnMonthly.className = "px-4 py-1.5 rounded-full text-slate-500 hover:text-slate-900 transition";

    const pBasic = document.getElementById('modal-price-basic');
    if (pBasic) pBasic.innerText = "$249";
    const perBasic = document.getElementById('modal-period-basic');
    if (perBasic) perBasic.innerText = "MXN / año";
    const subBasic = document.getElementById('modal-subtext-basic');
    if (subBasic) subBasic.innerText = "Equivale a solo $20 MXN/mes";

    const pPro = document.getElementById('modal-price-pro');
    if (pPro) pPro.innerText = "$699";
    const perPro = document.getElementById('modal-period-pro');
    if (perPro) perPro.innerText = "MXN / año";
    const subPro = document.getElementById('modal-subtext-pro');
    if (subPro) subPro.innerText = "Equivale a solo $58 MXN/mes";

    const pG = document.getElementById('modal-price-guardian');
    if (pG) pG.innerText = "$1,299";
    const perG = document.getElementById('modal-period-guardian');
    if (perG) perG.innerText = "MXN / año";
    const subG = document.getElementById('modal-subtext-guardian');
    if (subG) subG.innerText = "Equivale a solo $108 MXN/mes";
  } else {
    if (btnMonthly) btnMonthly.className = "px-4 py-1.5 rounded-full bg-white shadow-sm text-slate-900 transition";
    if (btnAnnual) btnAnnual.className = "px-4 py-1.5 rounded-full text-slate-500 hover:text-slate-900 transition flex items-center gap-1.5";

    const pBasic = document.getElementById('modal-price-basic');
    if (pBasic) pBasic.innerText = "$29";
    const perBasic = document.getElementById('modal-period-basic');
    if (perBasic) perBasic.innerText = "MXN / mes";
    const subBasic = document.getElementById('modal-subtext-basic');
    if (subBasic) subBasic.innerText = "Cobrado mes a mes";

    const pPro = document.getElementById('modal-price-pro');
    if (pPro) pPro.innerText = "$79";
    const perPro = document.getElementById('modal-period-pro');
    if (perPro) perPro.innerText = "MXN / mes";
    const subPro = document.getElementById('modal-subtext-pro');
    if (subPro) subPro.innerText = "Cobrado mes a mes";

    const pG = document.getElementById('modal-price-guardian');
    if (pG) pG.innerText = "$149";
    const perG = document.getElementById('modal-period-guardian');
    if (perG) perG.innerText = "MXN / mes";
    const subG = document.getElementById('modal-subtext-guardian');
    if (subG) subG.innerText = "Cobrado mes a mes";
  }
}

let currentCheckoutPlan = null;
let currentValidatedPayment = null;

function openCheckoutModal(planId, mode = 'standard') {
  closePricingModal();
  currentCheckoutMode = mode;
  const isAnnual = modalBillingPeriod === 'annual';
  
  let planName = 'Familiar Pro';
  let planPrice = isAnnual ? '$699 MXN / año' : '$79 MXN / mes';
  let amount = isAnnual ? 699 : 79;

  if (planId === 'basic') {
    planName = 'Plan Básico';
    planPrice = isAnnual ? '$249 MXN / año' : '$29 MXN / mes';
    amount = isAnnual ? 249 : 29;
  } else if (planId === 'guardian_plus') {
    planName = 'Guardian Plus';
    planPrice = isAnnual ? '$1,299 MXN / año' : '$149 MXN / mes';
    amount = isAnnual ? 1299 : 149;
  }

  currentCheckoutPlan = {
    planId,
    planName,
    billingPeriod: modalBillingPeriod,
    amount
  };

  currentValidatedPayment = null;

  const planNameElem = document.getElementById('checkout-plan-name');
  if (planNameElem) {
    if (mode === 'renewal') {
      planNameElem.innerText = `Renovación: ${planName} (${planPrice})`;
    } else if (mode === 'upgrade') {
      planNameElem.innerText = `Mejora (Upgrade): ${planName} (${planPrice})`;
    } else {
      planNameElem.innerText = `${planName} (${planPrice})`;
    }
  }
  
  const planPriceElem = document.getElementById('checkout-plan-price');
  if (planPriceElem) planPriceElem.innerText = isAnnual ? `$${amount} MXN / año` : `$${amount} MXN / mes`;
  
  const randomSuffix = Math.floor(10000 + Math.random() * 90000);
  const conceptCode = state.circle?.inviteCode ? `FS-${state.circle.inviteCode}` : `FS-${randomSuffix}`;
  const conceptElem = document.getElementById('checkout-concept');
  if (conceptElem) conceptElem.innerText = conceptCode;

  // Reset CEP form states
  const keyInput = document.getElementById('cep-tracking-key');
  if (keyInput) keyInput.value = '';
  document.getElementById('cep-loading-box')?.classList.add('hidden');
  document.getElementById('cep-success-box')?.classList.add('hidden');
  document.getElementById('cep-error-box')?.classList.add('hidden');
  document.getElementById('btn-validate-cep')?.classList.remove('hidden');
  document.getElementById('btn-proceed-registration')?.classList.add('hidden');

  const btnProceedText = document.getElementById('btn-proceed-text');
  if (btnProceedText) {
    if (mode === 'renewal') {
      btnProceedText.innerText = "Confirmar y Renovar Suscripción";
    } else if (mode === 'upgrade') {
      btnProceedText.innerText = "Activar Mejora (Upgrade) Inmediata";
    } else {
      btnProceedText.innerText = CURRENT_CIRCLE_ID ? "Activar Mi Plan en FamSafe" : "Continuar al Registro Familiar";
    }
  }

  document.getElementById('modal-checkout')?.classList.remove('hidden');
}

function closeCheckoutModal() {
  document.getElementById('modal-checkout')?.classList.add('hidden');
}

function selectPlan(planId) {
  const mode = (pricingModalContext === 'upgrade') ? 'upgrade' : (pricingModalContext === 'renewal') ? 'renewal' : (CURRENT_CIRCLE_ID && state.circle ? 'upgrade' : 'standard');
  openCheckoutModal(planId, mode);
}

function copyCheckoutClabe() {
  const clabe = document.getElementById('checkout-clabe')?.innerText.trim() || '722969010283746519';
  navigator.clipboard.writeText(clabe).then(() => {
    const btnText = document.getElementById('btn-copy-clabe-text');
    if (btnText) {
      btnText.innerText = "¡Copiada!";
      setTimeout(() => btnText.innerText = "Copiar CLABE", 2000);
    }
  });
}

function copyCheckoutConcept() {
  const concept = document.getElementById('checkout-concept')?.innerText.trim() || 'FS-PAGO';
  navigator.clipboard.writeText(concept).then(() => {
    alert(`Concepto '${concept}' copiado al portapapeles.`);
  });
}

async function handleValidateCep(e) {
  e.preventDefault();
  const trackingKey = document.getElementById('cep-tracking-key').value.trim();
  const senderBank = document.getElementById('cep-sender-bank').value;
  const fileInput = document.getElementById('cep-receipt-file');
  
  const loadingBox = document.getElementById('cep-loading-box');
  const successBox = document.getElementById('cep-success-box');
  const errorBox = document.getElementById('cep-error-box');

  loadingBox.classList.remove('hidden');
  successBox.classList.add('hidden');
  errorBox.classList.add('hidden');

  let receiptBase64 = null;
  if (fileInput && fileInput.files && fileInput.files[0]) {
    try {
      receiptBase64 = await readFileAsBase64(fileInput.files[0]);
    } catch (_) {}
  }

  // Artificial short delay to give genuine Banxico SPEI gateway feedback feel
  await new Promise(r => setTimeout(r, 1200));

  try {
    const res = await fetch(`${BACKEND_URL}/api/payments/validate-cep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackingKey,
        senderBank,
        amount: currentCheckoutPlan ? currentCheckoutPlan.amount : 79,
        planId: currentCheckoutPlan ? currentCheckoutPlan.planId : 'pro_family',
        billingPeriod: currentCheckoutPlan ? currentCheckoutPlan.billingPeriod : 'monthly',
        circleId: CURRENT_CIRCLE_ID || null,
        receiptBase64
      })
    });

    const data = await res.json();
    loadingBox.classList.add('hidden');

    if (!res.ok || !data.success) {
      errorBox.innerText = data.error || "No fue posible certificar la clave de rastreo con Banxico CEP.";
      errorBox.classList.remove('hidden');
      return;
    }

    currentValidatedPayment = data;
    document.getElementById('cep-result-folio').innerText = data.payment.banxicoFolio;
    document.getElementById('cep-result-key').innerText = data.payment.trackingKey;
    successBox.classList.remove('hidden');

    document.getElementById('btn-validate-cep').classList.add('hidden');
    document.getElementById('btn-proceed-registration').classList.remove('hidden');
  } catch (err) {
    loadingBox.classList.add('hidden');
    errorBox.innerText = "Error al conectar con el servidor de validación: " + err.message;
    errorBox.classList.remove('hidden');
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function proceedToFamilyRegistrationAfterPayment() {
  if (!currentValidatedPayment) {
    alert("Primero debes validar tu comprobante SPEI.");
    return;
  }

  if (CURRENT_CIRCLE_ID && state.circle) {
    if (currentCheckoutMode === 'renewal') {
      try {
        const res = await fetch(`${BACKEND_URL}/api/billing/renew`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            circleId: CURRENT_CIRCLE_ID,
            planId: currentCheckoutPlan.planId,
            billingPeriod: currentCheckoutPlan.billingPeriod,
            paymentToken: currentValidatedPayment.paymentToken
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Error al renovar suscripción.");
        }
        closeCheckoutModal();
        await fetchCircleData();
        const formattedDate = new Date(data.previousRenewsAt).toLocaleDateString('es-MX', {
          day: '2-digit',
          month: 'long',
          year: 'numeric'
        });
        const formattedNewDate = new Date(data.newRenewsAt).toLocaleDateString('es-MX', {
          day: '2-digit',
          month: 'long',
          year: 'numeric'
        });
        alert(`🎉 ¡Suscripción Renovada con Éxito!\n\nTu comprobante SPEI ha sido certificado ante Banxico CEP.\n\n📅 Tu nuevo periodo comenzará en la fecha ${formattedDate} (en que vence tu suscripción vigente) y vencerá el ${formattedNewDate}.\n\n¡Gracias por mantener protegida a tu familia con FamSafe!`);
      } catch (err) {
        alert("Error al renovar suscripción: " + err.message);
      }
      return;
    }

    // Upgrade mode or standard plan activation
    try {
      const res = await fetch(`${BACKEND_URL}/api/billing/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          circleId: CURRENT_CIRCLE_ID,
          planId: currentCheckoutPlan.planId,
          billingPeriod: currentCheckoutPlan.billingPeriod,
          paymentToken: currentValidatedPayment.paymentToken
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Error al activar suscripción.");
      }
      closeCheckoutModal();
      await fetchCircleData();
      alert(`🚀 ¡Plan Mejorado (Upgrade) con Éxito!\n\nTu pago ha sido certificado por Banxico CEP. Tu familia ahora cuenta con ${currentCheckoutPlan.planName} y todos sus beneficios activos.`);
    } catch (err) {
      alert("Error al activar suscripción: " + err.message);
    }
  } else {
    // New user -> Open Family Registration with pre-selected and verified plan
    closeCheckoutModal();
    openAuthModal();
    switchAuthTab('create');
    const planSelect = document.getElementById('reg-plan');
    if (planSelect) {
      planSelect.value = currentCheckoutPlan.planId;
    }
    // Store token in window for handleRegisterFamily
    window.currentValidatedPaymentToken = currentValidatedPayment.paymentToken;
    alert(`✅ Comprobante validado con éxito. Ahora completa el registro de tu familia para activar tu suscripción con tu comprobante.`);
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
  const plan = document.getElementById('reg-plan')?.value || 'pro_family';

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/register-family`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        familyName,
        parentName,
        email,
        password,
        plan,
        paymentToken: window.currentValidatedPaymentToken || undefined,
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
    if (data.member?.id) localStorage.setItem('famsafe_current_member_id', data.member.id);
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
    if (data.member?.id) localStorage.setItem('famsafe_current_member_id', data.member.id);
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
    if (data.member?.id) localStorage.setItem('famsafe_current_member_id', data.member.id);
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

// Battery Calibration and Live Device Battery Sync
async function calibrateMemberBattery(memberId, currentVal) {
  const newVal = prompt("Calibrar nivel de batería de este dispositivo (% de 1 a 100):", currentVal || 32);
  if (newVal === null) return;
  const num = parseInt(newVal);
  if (isNaN(num) || num < 1 || num > 100) {
    alert("Por favor ingresa un porcentaje válido entre 1 y 100.");
    return;
  }
  try {
    const res = await fetch(`${BACKEND_URL}/api/members/${memberId}/battery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battery: num, isCharging: false })
    });
    const data = await res.json();
    if (data.success) {
      const m = state.members.find(x => x.id === memberId);
      if (m) {
        m.battery = num;
        renderMembers();
      }
    }
  } catch (err) {
    console.error("Error al actualizar batería:", err);
  }
}

function initLiveBatterySync() {
  if ('getBattery' in navigator) {
    navigator.getBattery().then(battery => {
      const sync = () => {
        const level = Math.round(battery.level * 100);
        const isCharging = battery.charging;
        const storedMemberId = localStorage.getItem('famsafe_current_member_id');
        const myMember = (storedMemberId && state.members.find(m => m.id === storedMemberId)) || state.members.find(m => m.role === 'guardian') || state.members[0];
        if (myMember && (myMember.battery !== level || myMember.isCharging !== isCharging)) {
          myMember.battery = level;
          myMember.isCharging = isCharging;
          renderMembers();
          fetch(`${BACKEND_URL}/api/members/${myMember.id}/battery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ battery: level, isCharging })
          }).catch(() => {});
        }
      };
      sync();
      battery.addEventListener('levelchange', sync);
      battery.addEventListener('chargingchange', sync);
    }).catch(() => {});
  }
}

function checkUrlPlanParam() {
  const urlParams = new URLSearchParams(window.location.search);
  const plan = urlParams.get('plan');
  if (plan && ['basic', 'pro_family', 'guardian_plus'].includes(plan)) {
    openCheckoutModal(plan);
  }
}

// Native Web & Device Push Notifications Engine
let swRegistration = null;

async function initNotificationSystem() {
  if ('serviceWorker' in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
      console.log("FamSafe Service Worker registrado con éxito.");
    } catch (e) {
      console.warn("Service worker registro advertencia:", e);
    }
  }
  updateNotificationUiState();
}

function updateNotificationUiState() {
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  const banner = document.getElementById('notification-permission-banner');
  if (banner) {
    if (perm === 'default') {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    alert("Este navegador no tiene soporte para notificaciones web.");
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    updateNotificationUiState();
    if (perm === 'granted') {
      sendDeviceNotification(
        "🔔 FamSafe Notificaciones Activas",
        "Recibirás alertas inmediatas de emergencias SOS y salidas de zonas seguras.",
        "normal"
      );
    }
  } catch (err) {
    console.warn("Permiso de notificación:", err);
  }
}

function sendDeviceNotification(title, body, type = 'normal', url = '/') {
  // 1. Play synthesized sound effect
  playChime(type === 'emergency' ? 'emergency' : 'normal');

  // 2. Hardware vibration (Mobile browsers)
  if ('vibrate' in navigator) {
    try {
      if (type === 'emergency') {
        navigator.vibrate([300, 150, 300, 150, 500, 200, 500]);
      } else {
        navigator.vibrate([150, 80, 150]);
      }
    } catch (e) {}
  }

  // 3. Native system notification
  if ('Notification' in window && Notification.permission === 'granted') {
    const icon = '/icon-192.png';
    const tag = `famsafe-${type}-${Date.now()}`;
    const options = {
      body,
      icon,
      badge: icon,
      vibrate: type === 'emergency' ? [300, 150, 300, 150, 500] : [150, 80, 150],
      tag,
      renotify: true,
      requireInteraction: type === 'emergency',
      data: { url }
    };

    if (swRegistration && 'showNotification' in swRegistration) {
      swRegistration.showNotification(title, options).catch(() => {
        try { new Notification(title, options); } catch (e) {}
      });
    } else {
      try {
        new Notification(title, options);
      } catch (e) {}
    }
  }
}

// Bootstrapping
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  initNotificationSystem();
  fetchCircleData().then(() => {
    initLiveBatterySync();
    checkUrlPlanParam();
  });
  setupSocket();
});

