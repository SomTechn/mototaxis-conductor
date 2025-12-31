// ============================================
// APP CONDUCTOR - FINAL FIX (INFO & ZOOM)
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
    return new Promise((resolve) => {
        const i = setInterval(() => {
            if (window.supabaseClient) { clearInterval(i); resolve(); }
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

    if (error || !data) { alert('Perfil no encontrado'); return; }
    conductorId = data.id;
    conductorData = data;
    const el = document.getElementById('driverName');
    if (el && data.perfiles) el.textContent = data.perfiles.nombre;
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
            
            if (conductorData && conductorData.estado !== 'inactivo') {
                window.supabaseClient.from('conductores')
                    .update({ latitud: latitude, longitud: longitude, rumbo: heading, ultima_actualizacion: new Date() })
                    .eq('id', conductorId).then();
            }
            if (!solicitudActual && !carreraEnCurso) {
                 mapa.setView([latitude, longitude], 16, { animate: true });
            }
        },
        (e) => console.warn(e), { enableHighAccuracy: true }
    );
}

function actualizarMiMarcador() {
    if (!miUbicacion || !mapa) return;
    const iconHtml = `<div style="transform: rotate(${miUbicacion.heading}deg); transition: transform 0.5s;"><svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="#2563eb" stroke="white" stroke-width="2"/><path d="M20 5 L28 25 L20 20 L12 25 Z" fill="white"/></svg></div>`;
    const icon = L.divIcon({ html: iconHtml, className: 'rotating-marker', iconSize: [40,40], iconAnchor: [20,20] });
    if (miMarker) { miMarker.setLatLng([miUbicacion.lat, miUbicacion.lng]); miMarker.setIcon(icon); }
    else { miMarker = L.marker([miUbicacion.lat, miUbicacion.lng], { icon: icon }).addTo(mapa); }
}

// ============================================
// 3. ESTADOS Y REALTIME
// ============================================

async function cargarEstadoActual() {
    // CORRECCIÓN: Traer datos del cliente al cargar estado
    const { data } = await window.supabaseClient.from('carreras')
        .select('*, clientes(nombre, telefono)') // JOIN CLIENTES
        .eq('conductor_id', conductorId)
        .in('estado', ['asignada', 'aceptada', 'en_camino', 'en_curso']).maybeSingle();

    if (data) { carreraEnCurso = data; mostrarPantallaViaje(data); }
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
    if (!badge) return;
    badge.className = 'status-header ' + (estado === 'disponible' ? 'status-online' : 'status-busy');
    text.textContent = estado === 'disponible' ? 'En Línea' : 'Desconectado';
    if (estado === 'en_carrera') { text.textContent = 'En Viaje'; badge.className = 'status-header status-busy'; }
}

function suscribirseACambios() {
    window.supabaseClient.channel('conductor-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'carreras' }, (payload) => {
            const nueva = payload.new;
            if ((payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') && 
                nueva.estado === 'buscando' && !nueva.conductor_id) {
                recibirNuevaSolicitud(nueva);
                cargarDisponibles();
            }
            if (payload.eventType === 'UPDATE' && nueva.id === solicitudActual?.id) {
                if (nueva.estado !== 'buscando' && nueva.conductor_id !== conductorId) {
                    limpiarAlerta();
                    alert('La solicitud ya no está disponible');
                }
            }
        }).subscribe();
}

// ============================================
// 4. SOLICITUDES & ALERTA
// ============================================

async function recibirNuevaSolicitud(carrera) {
    if (conductorData.estado !== 'disponible' || carreraEnCurso) return;
    if (solicitudActual && solicitudActual.id === carrera.id) return;

    solicitudActual = carrera;
    const audio = document.getElementById('alertSound');
    if (audio) { audio.currentTime = 0; audio.play().catch(e=>{}); }
    if (navigator.vibrate) navigator.vibrate([500, 200, 500]);

    const precio = parseFloat(carrera.precio || 0).toFixed(2);
    safeText('reqType', carrera.tipo === 'directo' ? 'Viaje Directo' : 'Viaje Colectivo');
    safeText('reqAddressOrigin', carrera.origen_direccion);
    safeText('reqAddressDest', carrera.destino_direccion);
    safeText('reqPrice', 'L ' + precio);
    safeText('reqTripDist', (carrera.distancia_km||0) + ' km');
    safeText('reqTripTime', (carrera.tiempo_estimado_min||0));
    safeText('reqPickupTime', '--'); safeText('reqPickupDist', '--');
    
    if (miUbicacion && carrera.origen_lat && carrera.origen_lng) {
        const rutaPickup = await obtenerRutaOSRM(miUbicacion, { lat: carrera.origen_lat, lng: carrera.origen_lng });
        if (rutaPickup) {
            const min = Math.round(rutaPickup.duration / 60);
            const km = (rutaPickup.distance / 1000).toFixed(1);
            safeText('reqPickupTime', min);
            safeText('reqPickupDist', km + ' km');
        }
    }

    document.getElementById('requestOverlay').classList.add('active');
    
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

async function obtenerRutaOSRM(start, end) {
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=false`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.routes && data.routes[0]) return data.routes[0];
    } catch(e) { console.error(e); }
    return null;
}

function inicializarSlider() {
    const slider = document.getElementById('sliderContainer');
    const knob = document.getElementById('sliderKnob');
    let isDragging = false, startX = 0, cw = 0;

    const start = (e) => { isDragging = true; startX = e.touches ? e.touches[0].clientX : e.clientX; cw = slider.offsetWidth - knob.offsetWidth; };
    const move = (e) => {
        if (!isDragging) return;
        let cx = e.touches ? e.touches[0].clientX : e.clientX;
        let x = cx - startX;
        if (x < 0) x = 0; else if (x > cw) x = cw;
        knob.style.transform = `translateX(${x}px)`;
        document.querySelector('.slider-text').style.opacity = 1 - (x/cw);
    };
    const end = () => {
        if (!isDragging) return;
        isDragging = false;
        let x = new WebKitCSSMatrix(window.getComputedStyle(knob).transform).m41;
        if (x > cw * 0.9) aceptarSolicitudActual();
        else { knob.style.transform = 'translateX(0px)'; document.querySelector('.slider-text').style.opacity = 1; }
    };

    knob.addEventListener('mousedown', start); knob.addEventListener('touchstart', start);
    window.addEventListener('mousemove', move); window.addEventListener('touchmove', move);
    window.addEventListener('mouseup', end); window.addEventListener('touchend', end);
}

function resetSlider() {
    const k = document.getElementById('sliderKnob');
    if(k) k.style.transform = 'translateX(0px)';
    const t = document.querySelector('.slider-text');
    if(t) t.style.opacity = 1;
}

// ACEPTAR
async function aceptarSolicitudActual() {
    if (!solicitudActual) return;
    const id = solicitudActual.id;
    limpiarAlerta();

    try {
        // CORRECCIÓN: Traer datos del cliente al aceptar
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .update({ conductor_id: conductorId, estado: 'aceptada', fecha_aceptacion: new Date() })
            .eq('id', id)
            .is('conductor_id', null)
            .select('*, clientes(nombre, telefono)') // JOIN CLIENTES
            .maybeSingle();

        if (error || !data) {
            alert('Error: Otro conductor tomó el viaje.');
            cargarDisponibles();
        } else {
            carreraEnCurso = data;
            await window.supabaseClient.from('conductores').update({ estado: 'en_carrera' }).eq('id', conductorId);
            conductorData.estado = 'en_carrera';
            mostrarPantallaViaje(data);
        }
    } catch (e) { alert('Error red'); }
}

function rechazarSolicitudActual() { limpiarAlerta(); cargarDisponibles(); }

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
    
    // Obtener datos del cliente (Seguro contra nulls)
    const nombreCliente = carrera.clientes?.nombre || 'Cliente';
    const telCliente = carrera.clientes?.telefono || '';

    // ETA
    let dest = (carrera.estado === 'aceptada' || carrera.estado === 'en_camino') 
        ? { lat: carrera.origen_lat, lng: carrera.origen_lng }
        : { lat: carrera.destino_lat, lng: carrera.destino_lng };
    
    let etaText = '--:--';
    if (miUbicacion) {
        const route = await obtenerRutaOSRM(miUbicacion, dest);
        if (route) {
            const min = Math.round(route.duration / 60);
            etaText = new Date(Date.now() + min*60000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        }
    }

    let titulo = 'Yendo a Recoger', btn = '', color = '#f59e0b';
    if (carrera.estado === 'aceptada' || carrera.estado === 'en_camino') {
        btn = `<button class="swipe-btn btn-accept" onclick="reportarLlegada()">LLEGUÉ AL PUNTO</button>`;
        if (miUbicacion) dibujarRuta(miUbicacion, dest, '#f59e0b');
    } else {
        titulo = 'Llevando al Destino'; color = '#10b981';
        btn = `<button class="swipe-btn btn-accept" onclick="completarViaje()">FINALIZAR VIAJE</button>`;
        if (miUbicacion) dibujarRuta(miUbicacion, dest, '#10b981');
    }

    // HTML INCRUSTADO CON DATOS
    container.innerHTML = `
        <div class="active-trip-card" style="border-left: 5px solid ${color}">
            
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem">
                <div>
                    <h3 style="margin:0; color:${color}">${titulo}</h3>
                    <div style="font-size:1.1rem; font-weight:bold; margin-top:5px">👤 ${nombreCliente}</div>
                </div>
                <div class="eta-display" style="margin:0; padding:5px 10px">
                    <div class="eta-label">LLEGADA</div>
                    <div class="eta-time" style="font-size:1.2rem">${etaText}</div>
                </div>
            </div>

            <div class="step-indicator"><div class="step-circle">1</div><div><small>Recoger:</small><br><strong>${carrera.origen_direccion}</strong></div></div>
            <div class="step-indicator"><div class="step-circle">2</div><div><small>Destino:</small><br><strong>${carrera.destino_direccion}</strong></div></div>
            
            <div style="background:#e0f2fe; padding:10px; border-radius:8px; margin-bottom:1rem; display:flex; justify-content:space-between">
                <div><strong>L ${carrera.precio}</strong></div>
                <div>${carrera.distancia_km} km</div>
            </div>

            <div style="display:flex; gap:10px; margin: 1rem 0">
                <button class="btn-reject" style="background:#f3f4f6; color:#000; border:none" onclick="window.open('https://waze.com/ul?ll=${dest.lat},${dest.lng}&navigate=yes')">🗺️ Waze</button>
                <button class="btn-reject" style="background:#f3f4f6; color:#000; border:none" onclick="window.open('tel:${telCliente}')">📞 Llamar</button>
            </div>
            ${btn}
            <button class="btn-reject" onclick="cancelarViaje()">Cancelar Viaje</button>
        </div>`;
}

async function reportarLlegada() {
    if(!confirm('¿Pasajero abordó?')) return;
    const { data } = await window.supabaseClient.from('carreras')
        .update({ estado: 'en_curso', fecha_abordaje: new Date() })
        .eq('id', carreraEnCurso.id)
        .select('*, clientes(nombre, telefono)') // JOIN CLIENTES
        .single();
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
        <div class="req-card" style="padding:1rem; margin-bottom:0.5rem; animation:none; border:1px solid #374151" onclick='recibirNuevaSolicitud(${JSON.stringify(c)})'>
            <div style="display:flex; justify-content:space-between">
                <strong style="color:white">${c.tipo === 'directo' ? '⚡ Directo' : '👥 Colectivo'}</strong>
                <span style="color:#10b981; font-weight:bold">L ${c.precio}</span>
            </div>
            <p style="font-size:0.9em; margin:5px 0; color:#9ca3af">${c.origen_direccion}</p>
            <small style="color:#3b82f6">Toca para ver detalles</small>
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
            // AJUSTE ZOOM: Padding inferior grande para el bottom sheet
            mapa.fitBounds(ruta.getBounds(), { paddingBottomRight: [20, 350], paddingTopLeft: [20, 50] });
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

function toggleMenu() { document.getElementById('sideMenu').style.left = document.getElementById('sideMenu').style.left === '0px' ? '-100%' : '0px'; }
function switchTab(t) {
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('tab-disponibles').classList.add('hidden');
    document.getElementById('tab-curso').classList.add('hidden');
    document.getElementById('tab-'+t).classList.remove('hidden');
}

window.addEventListener('load', init);
