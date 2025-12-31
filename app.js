// ============================================
// APP CONDUCTOR - UBER STYLE V2
// ============================================

console.log('=== INICIANDO MODO CONDUCTOR ===');

let mapa, usuario, conductorId, conductorData;
let miUbicacion = null;
let miMarker = null;
let gpsWatchId = null;
let trackingInterval = null;
let solicitudActual = null; // Para guardar la solicitud entrante temporalmente
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
        
        // Cargar estado inicial
        await cargarEstadoActual();
        suscribirseACambios();
        
        document.getElementById('loader').classList.add('hidden');
        console.log('=== ✅ APP CONDUCTOR LISTA ===');
        
    } catch (error) {
        console.error('Error init:', error);
        alert('Error: ' + error.message);
    }
}

async function esperarSupabase() {
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            if (window.supabaseClient) { clearInterval(interval); resolve(); }
        }, 100);
    });
}

async function verificarSesion() {
    const { data: { session }, error } = await window.supabaseClient.auth.getSession();
    if (!session || error) { window.location.href = 'conductor-login.html'; return false; }
    usuario = session.user;
    return true;
}

async function cargarDatosConductor() {
    const { data, error } = await window.supabaseClient
        .from('conductores')
        .select('*, perfiles(nombre)')
        .eq('perfil_id', usuario.id)
        .maybeSingle();

    if (error || !data) { alert('No se encontró perfil de conductor'); return; }
    
    conductorId = data.id;
    conductorData = data;
    document.getElementById('driverName').textContent = data.perfiles.nombre;
    actualizarUIEstado(data.estado);
}

// ============================================
// 2. MAPA Y GPS
// ============================================

function inicializarMapa() {
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
            
            // Si estoy "Disponible" o "En Carrera", actualizo DB
            if (conductorData && conductorData.estado !== 'inactivo') {
                actualizarUbicacionDB(latitude, longitude, heading);
            }
            
            // Si no tengo viaje y entra una solicitud, no muevo el mapa (para que vea la ruta)
            // Si tengo viaje, centro en mí
            if (carreraEnCurso) {
                 mapa.setView([latitude, longitude], 17, { animate: true });
            } else if (!solicitudActual && conductorData.estado === 'disponible') {
                 mapa.setView([latitude, longitude], 16, { animate: true });
            }
        },
        (err) => console.warn(err),
        { enableHighAccuracy: true, maximumAge: 0 }
    );
}

function actualizarMiMarcador() {
    if (!miUbicacion) return;
    
    // Icono flecha rotada
    const iconHtml = `
        <div style="transform: rotate(${miUbicacion.heading}deg); transition: transform 0.5s;">
            <svg width="40" height="40" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="15" fill="#2563eb" stroke="white" stroke-width="2" />
                <path d="M20 5 L28 25 L20 20 L12 25 Z" fill="white" />
            </svg>
        </div>
    `;
    
    const icon = L.divIcon({ html: iconHtml, className: 'rotating-marker', iconSize: [40,40], iconAnchor: [20,20] });
    
    if (miMarker) {
        miMarker.setLatLng([miUbicacion.lat, miUbicacion.lng]);
        miMarker.setIcon(icon);
    } else {
        miMarker = L.marker([miUbicacion.lat, miUbicacion.lng], { icon: icon }).addTo(mapa);
    }
}

async function actualizarUbicacionDB(lat, lng, heading) {
    // Throttle básico: actualizar cada 5s máx se podría implementar aquí
    await window.supabaseClient.from('conductores')
        .update({ latitud: lat, longitud: lng, rumbo: heading, ultima_actualizacion: new Date() })
        .eq('id', conductorId);
}

// ============================================
// 3. GESTIÓN DE ESTADOS Y CARRERAS
// ============================================

async function cargarEstadoActual() {
    // 1. Buscar si tengo carrera activa
    const { data: carrera } = await window.supabaseClient
        .from('carreras')
        .select('*')
        .eq('conductor_id', conductorId)
        .in('estado', ['asignada', 'aceptada', 'en_camino', 'en_curso'])
        .maybeSingle();

    if (carrera) {
        // Recuperar sesión
        console.log('Recuperando carrera:', carrera.id);
        carreraEnCurso = carrera;
        mostrarPantallaViaje(carrera);
    } else {
        // Estoy libre, buscar solicitudes pendientes en lista
        cargarDisponibles();
    }
}

async function toggleEstado() {
    const nuevo = conductorData.estado === 'disponible' ? 'inactivo' : 'disponible';
    
    // Update DB
    await window.supabaseClient.from('conductores').update({ estado: nuevo }).eq('id', conductorId);
    conductorData.estado = nuevo;
    actualizarUIEstado(nuevo);
    
    if (nuevo === 'disponible') cargarDisponibles();
}

function actualizarUIEstado(estado) {
    const badge = document.getElementById('statusBadge');
    const dot = badge.querySelector('.status-dot');
    const text = document.getElementById('statusText');
    
    badge.className = 'status-header ' + (estado === 'disponible' ? 'status-online' : 'status-busy');
    text.textContent = estado === 'disponible' ? 'En Línea' : 'Desconectado';
    
    if (estado === 'en_carrera') {
        text.textContent = 'En Viaje';
        badge.className = 'status-header status-busy';
    }
}

// ============================================
// 4. FLUJO DE NUEVA SOLICITUD (MODO ALERTA)
// ============================================

function recibirNuevaSolicitud(carrera) {
    if (conductorData.estado !== 'disponible') return;
    if (carreraEnCurso) return; // Ya estoy ocupado

    console.log('🔔 SOLICITUD RECIBIDA:', carrera.id);
    solicitudActual = carrera;
    
    // 1. Sonido y Vibración
    const audio = document.getElementById('alertSound');
    audio.currentTime = 0;
    audio.play().catch(e => console.log('Interactuar para audio'));
    if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 1000]);

    // 2. Llenar Datos Overlay
    document.getElementById('reqType').textContent = carrera.tipo === 'directo' ? 'Viaje Directo' : 'Viaje Colectivo';
    document.getElementById('reqAddress').textContent = carrera.origen_direccion;
    document.getElementById('reqPrice').textContent = 'L ' + carrera.precio;
    
    // Calcular distancia a recoger (simple lineal por ahora para velocidad)
    if (miUbicacion) {
        const d = UTILS.calcularDistancia(miUbicacion.lat, miUbicacion.lng, carrera.origen_lat, carrera.origen_lng);
        document.getElementById('reqDist').textContent = d.toFixed(1) + ' km';
    }

    // 3. Mostrar Overlay
    document.getElementById('requestOverlay').classList.add('active');
    
    // 4. Timer 30s
    let timeLeft = 30;
    const timerEl = document.getElementById('reqTimer');
    clearInterval(timerSolicitud);
    timerSolicitud = setInterval(() => {
        timeLeft--;
        timerEl.textContent = timeLeft + 's';
        if (timeLeft <= 0) {
            rechazarSolicitudActual(true); // Rechazo automático
        }
    }, 1000);

    // 5. Mostrar ruta en mapa (zoom out)
    mostrarRutaPreview(carrera);
}

async function aceptarSolicitudActual() {
    if (!solicitudActual) return;
    const id = solicitudActual.id;
    limpiarAlerta();

    try {
        // Intentar asignar (concurrencia optimista)
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .update({ 
                conductor_id: conductorId,
                estado: 'aceptada', // O 'en_camino' directamente
                fecha_aceptacion: new Date()
            })
            .eq('id', id)
            .is('conductor_id', null) // Asegurar que nadie más la tomó
            .select()
            .single();

        if (error || !data) {
            alert('Otro conductor tomó el viaje 😞');
            cargarDisponibles();
        } else {
            // ÉXITO
            carreraEnCurso = data;
            // Cambiar mi estado a ocupado
            await window.supabaseClient.from('conductores').update({ estado: 'en_carrera' }).eq('id', conductorId);
            conductorData.estado = 'en_carrera';
            
            mostrarPantallaViaje(data);
        }

    } catch (e) {
        console.error(e);
        alert('Error al aceptar');
    }
}

function rechazarSolicitudActual(auto = false) {
    limpiarAlerta();
    if (!auto) {
        // Opcional: Registrar rechazo en DB
    }
    cargarDisponibles(); // Volver a lista normal
}

function limpiarAlerta() {
    document.getElementById('requestOverlay').classList.remove('active');
    document.getElementById('alertSound').pause();
    clearInterval(timerSolicitud);
    solicitudActual = null;
    limpiarMapa();
}

// ============================================
// 5. GESTIÓN DE VIAJE EN CURSO
// ============================================

function mostrarPantallaViaje(carrera) {
    // 1. UI Tabs
    switchTab('curso');
    actualizarUIEstado('en_carrera');

    // 2. Renderizar Tarjeta de Acción
    const container = document.getElementById('viajeActivoContainer');
    
    // Determinar paso
    let titulo = '', accionBtn = '', color = '';
    
    if (carrera.estado === 'aceptada' || carrera.estado === 'en_camino') {
        titulo = 'Yendo a Recoger';
        accionBtn = `<button class="btn btn-primary btn-block" onclick="reportarLlegada()">📍 ¡Ya llegué!</button>`;
        color = '#f59e0b';
        // Dibujar ruta: Yo -> Origen
        dibujarRuta(miUbicacion, {lat: carrera.origen_lat, lng: carrera.origen_lng}, '#f59e0b');
    } else if (carrera.estado === 'en_curso') {
        titulo = 'En Ruta al Destino';
        accionBtn = `<button class="btn btn-success btn-block" onclick="completarViaje()">🏁 Completar Viaje (Cobrar L ${carrera.precio})</button>`;
        color = '#10b981';
        // Dibujar ruta: Origen -> Destino (o Yo -> Destino)
        dibujarRuta(miUbicacion, {lat: carrera.destino_lat, lng: carrera.destino_lng}, '#10b981');
    }

    container.innerHTML = `
        <div class="active-trip-card" style="border-left: 5px solid ${color}">
            <h2 style="margin:0 0 1rem 0; color:${color}">${titulo}</h2>
            
            <div class="step-indicator">
                <div class="step-circle">1</div>
                <div>
                    <small>Recoger en:</small><br>
                    <strong>${carrera.origen_direccion}</strong>
                </div>
            </div>
             <div class="step-indicator">
                <div class="step-circle" style="background:${carrera.estado === 'en_curso' ? '#2563eb' : '#ccc'}">2</div>
                <div>
                    <small>Destino:</small><br>
                    <strong>${carrera.destino_direccion}</strong>
                </div>
            </div>

            <div style="display:flex; gap:10px; margin: 1rem 0">
                <button class="btn btn-secondary" style="flex:1" onclick="window.open('waze://?ll=${carrera.origen_lat},${carrera.origen_lng}&navigate=yes')">🗺️ Waze</button>
                <button class="btn btn-secondary" style="flex:1" onclick="window.open('tel:+50400000000')">📞 Llamar</button>
            </div>

            ${accionBtn}
            <button class="btn btn-danger btn-block mt-2" onclick="cancelarViaje()">⚠ Cancelar</button>
        </div>
    `;
}

// Acciones del Flujo
async function reportarLlegada() {
    // Cambiamos estado a 'en_curso' (asumiendo que sube el pasajero)
    // En una app real hay un paso intermedio "Llegué" y luego "Iniciar Viaje"
    if(!confirm('¿El pasajero ya subió?')) return;
    
    await window.supabaseClient.from('carreras')
        .update({ estado: 'en_curso', fecha_abordaje: new Date() })
        .eq('id', carreraEnCurso.id);
        
    carreraEnCurso.estado = 'en_curso';
    mostrarPantallaViaje(carreraEnCurso);
}

async function completarViaje() {
    if(!confirm(`¿Cobrar L ${carreraEnCurso.precio} y finalizar?`)) return;
    
    await window.supabaseClient.from('carreras')
        .update({ estado: 'completada', fecha_completado: new Date() })
        .eq('id', carreraEnCurso.id);
        
    // Volver a estar disponible
    await window.supabaseClient.from('conductores').update({ estado: 'disponible' }).eq('id', conductorId);
    conductorData.estado = 'disponible';
    
    alert(`Viaje Finalizado. Ganaste L ${carreraEnCurso.precio}`);
    
    carreraEnCurso = null;
    limpiarMapa();
    actualizarUIEstado('disponible');
    cargarDisponibles();
    switchTab('disponibles');
}

async function cancelarViaje() {
    if(!confirm('¿Cancelar viaje actual? Esto afectará tu calificación.')) return;
    
    await window.supabaseClient.from('carreras')
        .update({ estado: 'cancelada_conductor' })
        .eq('id', carreraEnCurso.id);
        
    await window.supabaseClient.from('conductores').update({ estado: 'disponible' }).eq('id', conductorId);
    conductorData.estado = 'disponible';
    
    carreraEnCurso = null;
    limpiarMapa();
    cargarDisponibles();
    switchTab('disponibles');
}


// ============================================
// 6. UTILIDADES Y CARGA DE LISTAS
// ============================================

async function cargarDisponibles() {
    const { data } = await window.supabaseClient
        .from('carreras')
        .select('*')
        .eq('estado', 'buscando') // Solo las que nadie tiene
        .is('conductor_id', null)
        .order('fecha_solicitud', { ascending: false });
        
    const div = document.getElementById('listaDisponibles');
    document.getElementById('countDisp').textContent = data ? data.length : 0;
    
    if (!data || data.length === 0) {
        div.innerHTML = '<p class="text-center" style="margin-top:2rem; color:#888">Buscando viajes cercanos...</p>';
        return;
    }
    
    div.innerHTML = data.map(c => `
        <div class="card mb-2" onclick="recibirNuevaSolicitud({id:'${c.id}', tipo:'${c.tipo}', precio:${c.precio}, origen_direccion:'${c.origen_direccion}', origen_lat:${c.origen_lat}, origen_lng:${c.origen_lng}, destino_lat:${c.destino_lat}, destino_lng:${c.destino_lng}})">
            <div style="display:flex; justify-content:space-between">
                <strong>${c.tipo === 'directo' ? '⚡ Directo' : '👥 Colectivo'}</strong>
                <span style="color:#10b981; font-weight:bold">L ${c.precio}</span>
            </div>
            <p style="font-size:0.9em; margin:5px 0">${c.origen_direccion}</p>
            <small style="color:#2563eb">Tocame para aceptar</small>
        </div>
    `).join('');
}

function suscribirseACambios() {
    window.supabaseClient
        .channel('conductor-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'carreras', filter: 'estado=eq.buscando' }, 
        (payload) => {
            // NUEVO VIAJE ENTRANTE
            recibirNuevaSolicitud(payload.new);
            cargarDisponibles(); // Actualizar lista fondo
        })
        .subscribe();
}

// MAPA HELPERS
async function dibujarRuta(p1, p2, color) {
    limpiarMapa();
    // Marcadores
    const m1 = L.marker([p1.lat, p1.lng]).addTo(mapa); // Yo
    const m2 = L.marker([p2.lat, p2.lng]).addTo(mapa); // Destino
    marcadoresRuta.push(m1, m2);
    
    // OSRM
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${p1.lng},${p1.lat};${p2.lng},${p2.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.routes && json.routes[0]) {
            const ruta = L.geoJSON(json.routes[0].geometry, { style: { color: color, weight: 5 } }).addTo(mapa);
            marcadoresRuta.push(ruta);
            mapa.fitBounds(ruta.getBounds(), { padding: [50,50] });
        }
    } catch(e) { console.error('Error ruta', e); }
}

function mostrarRutaPreview(carrera) {
    limpiarMapa();
    // Mostrar Origen y Destino del cliente
    const m1 = L.marker([carrera.origen_lat, carrera.origen_lng]).addTo(mapa).bindPopup('Recoger');
    const m2 = L.marker([carrera.destino_lat, carrera.destino_lng]).addTo(mapa).bindPopup('Destino');
    marcadoresRuta.push(m1, m2);
    
    // Ajustar vista para ver todo el viaje
    const group = new L.featureGroup([m1, m2]);
    mapa.fitBounds(group.getBounds(), { padding: [50,50] });
}

function limpiarMapa() {
    marcadoresRuta.forEach(l => mapa.removeLayer(l));
    marcadoresRuta = [];
}

async function cerrarSesion() {
    if(!confirm('¿Salir?')) return;
    await window.supabaseClient.auth.signOut();
    window.location.href = 'conductor-login.html';
}

window.addEventListener('load', init);
