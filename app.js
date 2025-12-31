// ============================================
// APP CONDUCTOR (FIX FINAL: REALTIME & ACCEPT)
// ============================================

console.log('=== INICIANDO APP CONDUCTOR ===');

let mapa, usuario, conductorId, conductorData;
let miUbicacion = null;
let miMarker = null;
let gpsWatchId = null;
let trackingInterval = null;
let solicitudActual = null;
let timerSolicitud = null;
let carreraEnCurso = null;
let marcadoresRuta = [];

// ============================================
// 1. INICIALIZACIÓN
// ============================================

async function init() {
    try {
        await esperarSupabase();
        const sesionValida = await verificarSesion();
        if (!sesionValida) return;
        
        await cargarDatosConductor();
        
        inicializarMapa();
        iniciarGPS();
        inicializarSlider();
        
        await cargarEstadoActual();
        suscribirseACambios();
        
        safeHide('loader');
        console.log('=== ✅ APP CONDUCTOR LISTA ===');
        
    } catch (error) {
        console.error('Error init:', error);
        safeHide('loader');
        if (error.code !== 1) alert('Error: ' + error.message);
    }
}

async function esperarSupabase() {
    return new Promise((resolve, reject) => {
        if (window.supabaseClient) { resolve(); return; }
        let i = 0;
        const interval = setInterval(() => {
            i++;
            if (window.supabaseClient) { clearInterval(interval); resolve(); }
            else if (i > 50) { clearInterval(interval); reject(new Error('Timeout DB')); }
        }, 100);
    });
}

async function verificarSesion() {
    const { data: { session }, error } = await window.supabaseClient.auth.getSession();
    if (!session || error) { window.location.href = 'login.html'; return false; }
    usuario = session.user;
    return true;
}

async function cargarDatosConductor() {
    const { data, error } = await window.supabaseClient
        .from('conductores').select('*, perfiles(nombre)').eq('perfil_id', usuario.id).maybeSingle();

    if (error || !data) { alert('No se encontró perfil de conductor.'); return; }
    conductorId = data.id;
    conductorData = data;
    
    const elNombre = document.getElementById('driverName');
    if (elNombre && data.perfiles) elNombre.textContent = data.perfiles.nombre;
    actualizarUIEstado(data.estado);
}

function safeHide(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
function safeText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }

// ============================================
// 2. MAPA & GPS
// ============================================

function inicializarMapa() {
    if (!document.getElementById('map')) return;
    mapa = L.map('map', { zoomControl: false }).setView([15.5048, -88.0250], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapa);
}

function iniciarGPS() {
    if (!navigator.geolocation) return;
    gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude, longitude, heading } = pos.coords;
            miUbicacion = { lat: latitude, lng: longitude, heading: heading || 0 };
            actualizarMiMarcador();
            
            // Actualizar DB (Throttle simple)
            if (conductorData && conductorData.estado !== 'inactivo') {
                window.supabaseClient.from('conductores')
                    .update({ latitud: latitude, longitud: longitude, rumbo: heading, ultima_actualizacion: new Date() })
                    .eq('id', conductorId).then();
            }
            
            // Si no hay solicitud activa ni carrera, centrar en mí
            if (!solicitudActual && !carreraEnCurso) {
                 mapa.setView([latitude, longitude], 16, { animate: true });
            }
        },
        (err) => console.warn('GPS:', err), { enableHighAccuracy: true }
    );
}

function actualizarMiMarcador() {
    if (!miUbicacion || !mapa) return;
    const iconHtml = `<div style="transform: rotate(${miUbicacion.heading}deg); transition: transform 0.5s;">
        <svg width="40" height="40" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="15" fill="#2563eb" stroke="white" stroke-width="2" />
            <path d="M20 5 L28 25 L20 20 L12 25 Z" fill="white" />
        </svg></div>`;
    const icon = L.divIcon({ html: iconHtml, className: 'rotating-marker', iconSize: [40,40], iconAnchor: [20,20] });
    
    if (miMarker) { miMarker.setLatLng([miUbicacion.lat, miUbicacion.lng]); miMarker.setIcon(icon); }
    else { miMarker = L.marker([miUbicacion.lat, miUbicacion.lng], { icon: icon }).addTo(mapa); }
}

// ============================================
// 3. LOGICA Y REALTIME
// ============================================

async function cargarEstadoActual() {
    const { data: carrera } = await window.supabaseClient.from('carreras').select('*')
        .eq('conductor_id', conductorId)
        .in('estado', ['asignada', 'aceptada', 'en_camino', 'en_curso']).maybeSingle();

    if (carrera) { carreraEnCurso = carrera; mostrarPantallaViaje(carrera); }
    else { cargarDisponibles(); }
}

async function toggleEstado() {
    const nuevo = conductorData.estado === 'disponible' ? 'inactivo' : 'disponible';
    await window.supabaseClient.from('conductores').update({ estado: nuevo }).eq('id', conductorId);
    conductorData.estado = nuevo;
    actualizarUIEstado(nuevo);
    if (nuevo === 'disponible') cargarDisponibles();
}

function actualizarUIEstado(estado) {
    const badge = document.getElementById('statusBadge');
    const text = document.getElementById('statusText');
    if (!badge || !text) return;
    badge.className = 'status-header ' + (estado === 'disponible' ? 'status-online' : 'status-busy');
    text.textContent = estado === 'disponible' ? 'En Línea' : 'Desconectado';
    if (estado === 'en_carrera') { text.textContent = 'En Viaje'; badge.className = 'status-header status-busy'; }
}

function suscribirseACambios() {
    window.supabaseClient.channel('conductor-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'carreras' }, (payload) => {
            const nueva = payload.new;
            // Nueva carrera disponible
            if ((payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') && 
                nueva.estado === 'buscando' && !nueva.conductor_id) {
                recibirNuevaSolicitud(nueva);
                cargarDisponibles();
            }
            // Carrera tomada por otro o cancelada
            if (payload.eventType === 'UPDATE' && nueva.id === solicitudActual?.id) {
                if (nueva.estado !== 'buscando' && nueva.conductor_id !== conductorId) {
                    limpiarAlerta();
                    alert('La solicitud ya no está disponible');
                }
            }
        }).subscribe();
}

// ============================================
// 4. ALERTA DE SOLICITUD & SLIDER
// ============================================

async function recibirNuevaSolicitud(carrera) {
    if (conductorData.estado !== 'disponible' || carreraEnCurso) return;
    if (solicitudActual && solicitudActual.id === carrera.id) return;

    solicitudActual = carrera;
    
    // UI Básica
    safeText('reqPrice', 'L ' + carrera.precio);
    safeText('reqAddressOrigin', carrera.origen_direccion);
    safeText('reqAddressDest', carrera.destino_direccion);
    safeText('reqTripDist', carrera.distancia_km + ' km');
    safeText('reqTripTime', carrera.tiempo_estimado_min);

    // Calcular ruta hacia el cliente (Pickup)
    safeText('reqPickupTime', 'Calculando...');
    safeText('reqPickupDist', '...');
    
    if (miUbicacion) {
        // Cálculo OSRM: Conductor -> Origen Pasajero
        const routePickup = await obtenerRutaOSRM(miUbicacion, { lat: carrera.origen_lat, lng: carrera.origen_lng });
        if (routePickup) {
            const min = Math.round(routePickup.duration / 60);
            const km = (routePickup.distance / 1000).toFixed(1);
            safeText('reqPickupTime', min);
            safeText('reqPickupDist', km + ' km');
        }
    }

    // Audio y Vibración
    const audio = document.getElementById('alertSound');
    if (audio) { audio.currentTime = 0; audio.play().catch(e=>{}); }
    if (navigator.vibrate) navigator.vibrate([500, 200, 500]);

    document.getElementById('requestOverlay').classList.add('active');
    
    // Timer
    let timeLeft = 30;
    const timerEl = document.getElementById('reqTimer');
    if(timerSolicitud) clearInterval(timerSolicitud);
    timerSolicitud = setInterval(() => {
        timeLeft--;
        if (timerEl) timerEl.textContent = timeLeft + 's';
        if (timeLeft <= 0) rechazarSolicitudActual(true);
    }, 1000);

    resetSlider();
    mostrarRutaPreview(carrera);
}

// OSRM Helper
async function obtenerRutaOSRM(start, end) {
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=false`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.routes && data.routes[0]) return data.routes[0];
    } catch(e) { console.error(e); }
    return null;
}

// SLIDER LOGIC
function inicializarSlider() {
    const slider = document.getElementById('sliderContainer');
    const knob = document.getElementById('sliderKnob');
    let isDragging = false, startX = 0, containerWidth = 0;

    const start = (e) => {
        isDragging = true;
        startX = e.touches ? e.touches[0].clientX : e.clientX;
        containerWidth = slider.offsetWidth - knob.offsetWidth;
    };
    const move = (e) => {
        if (!isDragging) return;
        let clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let x = clientX - startX;
        if (x < 0) x = 0; else if (x > containerWidth) x = containerWidth;
        knob.style.transform = `translateX(${x}px)`;
        document.querySelector('.slider-text').style.opacity = 1 - (x/containerWidth);
    };
    const end = (e) => {
        if (!isDragging) return;
        isDragging = false;
        let x = new WebKitCSSMatrix(window.getComputedStyle(knob).transform).m41;
        if (x > containerWidth * 0.9) aceptarSolicitudActual();
        else {
            knob.style.transform = 'translateX(0px)';
            document.querySelector('.slider-text').style.opacity = 1;
        }
    };

    knob.addEventListener('mousedown', start);
    knob.addEventListener('touchstart', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move);
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
}

function resetSlider() {
    const knob = document.getElementById('sliderKnob');
    if(knob) knob.style.transform = 'translateX(0px)';
    const txt = document.querySelector('.slider-text');
    if(txt) txt.style.opacity = 1;
}

async function aceptarSolicitudActual() {
    if (!solicitudActual) return;
    const id = solicitudActual.id;
    limpiarAlerta();

    try {
        // CORRECCIÓN ERROR 406: Usar maybeSingle()
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .update({ conductor_id: conductorId, estado: 'aceptada', fecha_aceptacion: new Date() })
            .eq('id', id)
            .is('conductor_id', null)
            .select()
            .maybeSingle();

        if (error || !data) {
            alert('Error: Otro conductor tomó el viaje o expiró.');
            cargarDisponibles();
        } else {
            carreraEnCurso = data;
            await window.supabaseClient.from('conductores').update({ estado: 'en_carrera' }).eq('id', conductorId);
            conductorData.estado = 'en_carrera';
            mostrarPantallaViaje(data);
        }
    } catch (e) { 
        console.error(e); 
        alert('Error de conexión'); 
    }
}

function rechazarSolicitudActual(auto = false) {
    limpiarAlerta();
    cargarDisponibles();
}

function limpiarAlerta() {
    document.getElementById('requestOverlay').classList.remove('active');
    const audio = document.getElementById('alertSound');
    if (audio) audio.pause();
    clearInterval(timerSolicitud);
    solicitudActual = null;
    limpiarMapa();
}

// ============================================
// 5. GESTIÓN VIAJE ACTIVO
// ============================================

async function mostrarPantallaViaje(carrera) {
    switchTab('curso');
    actualizarUIEstado('en_carrera');
    const container = document.getElementById('viajeActivoContainer');
    if (!container) return;
    
    // Calcular ETA
    let destinoCoords = (carrera.estado === 'aceptada' || carrera.estado === 'en_camino') 
        ? { lat: carrera.origen_lat, lng: carrera.origen_lng }
        : { lat: carrera.destino_lat, lng: carrera.destino_lng };
    
    let etaText = '--:--';
    if (miUbicacion) {
        const route = await obtenerRutaOSRM(miUbicacion, destinoCoords);
        if (route) {
            const min = Math.round(route.duration / 60);
            const arrival = new Date(new Date().getTime() + min*60000);
            etaText = arrival.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }
    }

    let titulo = 'Yendo a Recoger', btnMain = '', color = '#f59e0b';
    
    if (carrera.estado === 'aceptada' || carrera.estado === 'en_camino') {
        btnMain = `<button class="btn btn-primary btn-block" onclick="reportarLlegada()">📍 ¡Ya llegué!</button>`;
        if (miUbicacion) dibujarRuta(miUbicacion, destinoCoords, '#f59e0b');
    } else {
        titulo = 'Llevando al Destino'; color = '#10b981';
        btnMain = `<button class="btn btn-success btn-block" onclick="completarViaje()">🏁 Finalizar (Cobrar L ${carrera.precio})</button>`;
        if (miUbicacion) dibujarRuta(miUbicacion, destinoCoords, '#10b981');
    }

    container.innerHTML = `
        <div class="active-trip-card" style="border-left: 5px solid ${color}">
            <div class="eta-display">
                <div class="eta-label">LLEGADA ESTIMADA</div>
                <div class="eta-time">${etaText}</div>
            </div>
            <h3 style="margin:0 0 1rem 0; color:${color}">${titulo}</h3>
            <div class="step-indicator"><div class="step-circle">1</div><div><small>Recoger:</small><br><strong>${carrera.origen_direccion}</strong></div></div>
            <div class="step-indicator"><div class="step-circle">2</div><div><small>Destino:</small><br><strong>${carrera.destino_direccion}</strong></div></div>
            <div style="display:flex; gap:10px; margin: 1rem 0">
                <button class="btn btn-secondary" style="flex:1" onclick="window.open('https://waze.com/ul?ll=${destinoCoords.lat},${destinoCoords.lng}&navigate=yes')">🗺️ Waze</button>
                <button class="btn btn-secondary" style="flex:1" onclick="window.open('tel:+50400000000')">📞 Llamar</button>
            </div>
            ${btnMain}
            <button class="btn btn-danger btn-block mt-2" onclick="cancelarViaje()">⚠ Cancelar</button>
        </div>`;
}

async function reportarLlegada() {
    if(!confirm('¿Pasajero abordó?')) return;
    const { data } = await window.supabaseClient.from('carreras').update({ estado: 'en_curso', fecha_abordaje: new Date() }).eq('id', carreraEnCurso.id).select().single();
    carreraEnCurso = data;
    mostrarPantallaViaje(data);
}

async function completarViaje() {
    if(!confirm(`¿Finalizar? Cobrar L ${carreraEnCurso.precio}`)) return;
    await window.supabaseClient.from('carreras').update({ estado: 'completada', fecha_completado: new Date() }).eq('id', carreraEnCurso.id);
    await window.supabaseClient.from('conductores').update({ estado: 'disponible' }).eq('id', conductorId);
    conductorData.estado = 'disponible';
    alert(`Ganaste L ${carreraEnCurso.precio}`);
    carreraEnCurso = null; limpiarMapa(); actualizarUIEstado('disponible'); cargarDisponibles(); switchTab('disponibles');
}

async function cancelarViaje() {
    if(!confirm('¿Cancelar?')) return;
    await window.supabaseClient.from('carreras').update({ estado: 'cancelada_conductor' }).eq('id', carreraEnCurso.id);
    await window.supabaseClient.from('conductores').update({ estado: 'disponible' }).eq('id', conductorId);
    conductorData.estado = 'disponible';
    carreraEnCurso = null; limpiarMapa(); cargarDisponibles(); switchTab('disponibles');
}

// ============================================
// 6. UTILIDADES
// ============================================

async function cargarDisponibles() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('estado', 'buscando').is('conductor_id', null).order('fecha_solicitud', { ascending: false });
    const div = document.getElementById('listaDisponibles');
    const count = document.getElementById('countDisp');
    if (count) count.textContent = data ? data.length : 0;
    
    if (!data || data.length === 0) {
        if(div) div.innerHTML = '<p class="text-center" style="margin-top:2rem; color:#888">Esperando solicitudes...</p>';
        return;
    }
    
    div.innerHTML = data.map(c => `
        <div class="card mb-2" onclick='recibirNuevaSolicitud(${JSON.stringify(c)})' style="background:white; border:1px solid #eee; padding:1rem; border-radius:0.5rem; margin-bottom:0.5rem">
            <div style="display:flex; justify-content:space-between">
                <strong>${c.tipo === 'directo' ? '⚡ Directo' : '👥 Colectivo'}</strong>
                <span style="color:#10b981; font-weight:bold">L ${c.precio}</span>
            </div>
            <p style="font-size:0.9em; margin:5px 0">${c.origen_direccion}</p>
            <small style="color:#2563eb">Toca para ver detalles</small>
        </div>`).join('');
}

async function dibujarRuta(p1, p2, color) {
    limpiarMapa();
    const m1 = L.marker([p1.lat, p1.lng]).addTo(mapa);
    const m2 = L.marker([p2.lat, p2.lng]).addTo(mapa);
    marcadoresRuta.push(m1, m2);
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${p1.lng},${p1.lat};${p2.lng},${p2.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.routes && json.routes[0]) {
            const ruta = L.geoJSON(json.routes[0].geometry, { style: { color: color, weight: 5 } }).addTo(mapa);
            marcadoresRuta.push(ruta);
            mapa.fitBounds(ruta.getBounds(), { padding: [50,50] });
        }
    } catch(e) {}
}

function mostrarRutaPreview(carrera) {
    limpiarMapa();
    const m1 = L.marker([carrera.origen_lat, carrera.origen_lng]).addTo(mapa);
    const m2 = L.marker([carrera.destino_lat, carrera.destino_lng]).addTo(mapa);
    marcadoresRuta.push(m1, m2);
    const group = new L.featureGroup([m1, m2]);
    mapa.fitBounds(group.getBounds(), { padding: [100,50] });
}

function limpiarMapa() { marcadoresRuta.forEach(l => mapa.removeLayer(l)); marcadoresRuta = []; }

async function cerrarSesion() {
    if(!confirm('¿Salir?')) return;
    await window.supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

// Helpers globales
window.toggleMenu = function() { const m = document.getElementById('sideMenu'); if(m) m.style.left = m.style.left === '0px' ? '-100%' : '0px'; };
window.switchTab = function(t) {
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('tab-disponibles').classList.add('hidden');
    document.getElementById('tab-curso').classList.add('hidden');
    document.getElementById('tab-'+t).classList.remove('hidden');
};

window.addEventListener('load', init);
