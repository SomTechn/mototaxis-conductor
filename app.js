// ============================================
// APP CONDUCTOR - FINAL (PERSISTENCIA)
// ============================================

let mapa, usuario, conductorId, conductorData, carreraActual = null;
let miUbicacion = null, miMarker = null, rutaLayer = null;
let solicitudTemp = null, watchId = null;

async function init() {
    try {
        await esperarSupabase();
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return window.location.href = 'login.html';
        usuario = session.user;

        await cargarDatosConductor();
        inicializarMapa();
        if(navigator.geolocation) watchId = navigator.geolocation.watchPosition(updatePos, console.error, {enableHighAccuracy:true});
        
        inicializarSlider();
        suscribirse();
        await recuperarSesionViaje(); // CLAVE PARA PERSISTENCIA
        cargarHistorial();

        document.getElementById('loader').classList.add('hidden');
    } catch (e) { alert(e.message); }
}

async function esperarSupabase() {
    return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); });
}

async function cargarDatosConductor() {
    const { data } = await window.supabaseClient.from('conductores').select('*, perfiles(nombre)').eq('perfil_id', usuario.id).maybeSingle();
    conductorData = data; conductorId = data.id;
    document.getElementById('driverName').textContent = data.perfiles.nombre;
    updateStatusUI(data.estado);
}

function updatePos(pos) {
    const { latitude: lat, longitude: lng, heading } = pos.coords;
    miUbicacion = { lat, lng };
    
    if (!miMarker) {
        miMarker = L.marker([lat, lng], { icon: L.divIcon({className:'moto-marker', html:'🏍️', iconSize:[30,30]}) }).addTo(mapa);
        mapa.setView([lat, lng], 16);
    } else {
        miMarker.setLatLng([lat, lng]);
    }

    if (conductorData.estado === 'disponible' || conductorData.estado === 'en_carrera') {
        window.supabaseClient.from('conductores').update({ latitud: lat, longitud: lng, rumbo: heading }).eq('id', conductorId).then();
    }
}

// --- GESTIÓN DE ESTADOS Y VIAJES ---

async function recuperarSesionViaje() {
    // Busca si hay un viaje activo para mí
    const { data } = await window.supabaseClient.from('carreras')
        .select('*, clientes(nombre, telefono)')
        .eq('conductor_id', conductorId)
        .in('estado', ['aceptada', 'en_camino', 'en_curso'])
        .maybeSingle();

    if (data) {
        carreraActual = data;
        mostrarPantallaViaje();
    }
}

function suscribirse() {
    window.supabaseClient.channel('conductor')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'carreras' }, payload => {
            const nueva = payload.new;
            // Nueva Solicitud
            if (nueva.estado === 'buscando' && !nueva.conductor_id && conductorData.estado === 'disponible' && !carreraActual) {
                mostrarAlerta(nueva);
            }
            // Cancelación
            if (carreraActual && nueva.id === carreraActual.id && nueva.estado.includes('cancelada')) {
                alert('Viaje cancelado por el cliente');
                resetApp();
            }
        }).subscribe();
}

// --- ALERTA Y ACEPTACIÓN ---

function mostrarAlerta(carrera) {
    solicitudTemp = carrera;
    document.getElementById('reqPrice').textContent = 'L ' + carrera.precio;
    document.getElementById('reqDist').textContent = '2 km'; // Calcular real si se desea
    document.getElementById('reqTotalDist').textContent = carrera.distancia_km + ' km';
    document.getElementById('reqAddress').textContent = carrera.origen_direccion;
    
    document.getElementById('requestOverlay').classList.add('active');
    document.getElementById('alertSound').play().catch(()=>{});
}

function rechazarSolicitud() {
    document.getElementById('requestOverlay').classList.remove('active');
    document.getElementById('alertSound').pause();
    solicitudTemp = null;
    resetSlider();
}

async function aceptarViaje() {
    document.getElementById('alertSound').pause();
    try {
        // Intento atómico de asignar
        const { data, error } = await window.supabaseClient.from('carreras')
            .update({ conductor_id: conductorId, estado: 'aceptada', fecha_aceptacion: new Date() })
            .eq('id', solicitudTemp.id).is('conductor_id', null)
            .select('*, clientes(nombre, telefono)').single();

        if (error || !data) throw new Error('Ya fue tomado');

        carreraActual = data;
        // Actualizar mi estado
        await window.supabaseClient.from('conductores').update({ estado: 'en_carrera' }).eq('id', conductorId);
        conductorData.estado = 'en_carrera';
        updateStatusUI('en_carrera');
        
        document.getElementById('requestOverlay').classList.remove('active');
        mostrarPantallaViaje();

    } catch (e) {
        alert('Error: ' + e.message);
        rechazarSolicitud();
    }
}

// --- PANTALLA DE VIAJE ---

function mostrarPantallaViaje() {
    const p = document.getElementById('tripPanel');
    const btn = document.getElementById('tripActionBtn');
    const title = document.getElementById('tripTitle');
    
    p.classList.add('active');
    document.getElementById('tripClient').textContent = carreraActual.clientes?.nombre || 'Cliente';
    document.getElementById('btnCall').href = `tel:${carreraActual.clientes?.telefono}`;
    
    if (carreraActual.estado === 'aceptada' || carreraActual.estado === 'en_camino') {
        title.textContent = 'Yendo a Recoger';
        document.getElementById('tripDest').textContent = carreraActual.origen_direccion;
        btn.textContent = '📍 Llegué por el cliente';
        btn.onclick = () => actualizarEstadoViaje('en_curso');
        btn.className = 'action-btn btn-blue';
        dibujarRuta({lat:carreraActual.origen_lat, lng:carreraActual.origen_lng});
    } else {
        title.textContent = 'Llevando a Destino';
        document.getElementById('tripDest').textContent = carreraActual.destino_direccion;
        btn.textContent = `🏁 Finalizar (Cobrar L ${carreraActual.precio})`;
        btn.onclick = () => actualizarEstadoViaje('completada');
        btn.className = 'action-btn btn-green';
        dibujarRuta({lat:carreraActual.destino_lat, lng:carreraActual.destino_lng});
    }
}

async function actualizarEstadoViaje(nuevoEstado) {
    if (nuevoEstado === 'completada') {
        if(!confirm(`Cobrar L ${carreraActual.precio}?`)) return;
    }

    const { data } = await window.supabaseClient.from('carreras')
        .update({ estado: nuevoEstado, [nuevoEstado==='completada'?'fecha_completado':'fecha_inicio']: new Date() })
        .eq('id', carreraActual.id)
        .select('*, clientes(nombre, telefono)').single();
    
    if (nuevoEstado === 'completada') {
        alert('Viaje finalizado. ¡Buen trabajo!');
        resetApp();
        cargarHistorial(); // Actualizar ganancias
    } else {
        carreraActual = data;
        mostrarPantallaViaje();
    }
}

async function resetApp() {
    carreraActual = null;
    document.getElementById('tripPanel').classList.remove('active');
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    
    await window.supabaseClient.from('conductores').update({ estado: 'disponible' }).eq('id', conductorId);
    conductorData.estado = 'disponible';
    updateStatusUI('disponible');
}

// --- UTILS ---

async function toggleEstado() {
    const nuevo = conductorData.estado === 'disponible' ? 'inactivo' : 'disponible';
    await window.supabaseClient.from('conductores').update({ estado: nuevo }).eq('id', conductorId);
    conductorData.estado = nuevo;
    updateStatusUI(nuevo);
}

function updateStatusUI(estado) {
    const d = document.getElementById('statusDot');
    const t = document.getElementById('statusText');
    d.className = 'dot ' + (estado==='disponible'?'online':(estado==='en_carrera'?'busy':'offline'));
    t.textContent = estado==='disponible'?'En Línea':(estado==='en_carrera'?'Ocupado':'Offline');
}

async function cargarHistorial() {
    // Ganancias de hoy
    const hoy = new Date().toISOString().split('T')[0];
    const { data } = await window.supabaseClient.from('carreras')
        .select('precio, fecha_completado, destino_direccion')
        .eq('conductor_id', conductorId)
        .eq('estado', 'completada')
        .gte('fecha_completado', hoy);
    
    if(data) {
        const total = data.reduce((sum, c) => sum + (c.precio||0), 0);
        document.getElementById('gananciasHoy').textContent = 'L ' + total.toFixed(2);
        
        const list = document.getElementById('historialLista');
        list.innerHTML = data.map(c => `
            <div class="history-item">
                <div style="font-weight:bold">L ${c.precio}</div>
                <div style="font-size:0.8rem;color:#6b7280">${c.destino_direccion.substring(0,20)}...</div>
            </div>
        `).join('');
    }
}

async function dibujarRuta(dest) {
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    if(miUbicacion) {
        const url = `https://router.project-osrm.org/route/v1/driving/${miUbicacion.lng},${miUbicacion.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        if(data.routes?.[0]) {
            rutaLayer = L.geoJSON(data.routes[0].geometry).addTo(mapa);
            mapa.fitBounds(rutaLayer.getBounds(), {padding:[50,50]});
        }
    }
}

// SLIDER LOGIC
function inicializarSlider() {
    const slider = document.getElementById('slider');
    const thumb = document.getElementById('sliderThumb');
    let isDragging = false, startX, w;

    const start = e => { isDragging=true; startX=(e.touches?e.touches[0].clientX:e.clientX); w=slider.offsetWidth-thumb.offsetWidth; };
    const move = e => {
        if(!isDragging) return;
        let x = (e.touches?e.touches[0].clientX:e.clientX) - startX;
        if(x<0) x=0; if(x>w) x=w;
        thumb.style.transform = `translateX(${x}px)`;
    };
    const end = () => {
        if(!isDragging) return; isDragging=false;
        const x = new WebKitCSSMatrix(window.getComputedStyle(thumb).transform).m41;
        if(x > w*0.9) aceptarViaje();
        else thumb.style.transform = `translateX(0px)`;
    };

    thumb.addEventListener('mousedown', start); thumb.addEventListener('touchstart', start);
    window.addEventListener('mousemove', move); window.addEventListener('touchmove', move);
    window.addEventListener('mouseup', end); window.addEventListener('touchend', end);
}

function resetSlider() { document.getElementById('sliderThumb').style.transform = `translateX(0px)`; }
function cerrarSesion() { window.supabaseClient.auth.signOut(); window.location.href='login.html'; }
function inicializarMapa() { mapa = L.map('map', {zoomControl:false}).setView([15.5,-88], 13); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa); }

window.addEventListener('load', init);
