// ============================================
// APP CONDUCTOR - FINAL
// ============================================

let mapa, usuario, conductorId, conductorData, carreraEnCurso = null, solicitudTemp = null;
let miUbicacion = null, miMarker = null, watchId = null;
let marcadoresRuta = [];

async function init() {
    try {
        await esperarSupabase();
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return window.location.href = 'login.html';
        usuario = session.user;

        await cargarDatosConductor();
        inicializarMapa();
        
        if (navigator.geolocation) {
            watchId = navigator.geolocation.watchPosition(pos => {
                const { latitude, longitude, heading } = pos.coords;
                miUbicacion = { lat: latitude, lng: longitude };
                
                // Actualizar marcador
                if (!miMarker) {
                    miMarker = L.marker([latitude, longitude], { icon: L.divIcon({className:'moto-marker', html:'🏍️'}) }).addTo(mapa);
                    mapa.setView([latitude, longitude], 16);
                } else {
                    miMarker.setLatLng([latitude, longitude]);
                }

                // CENTRADO INTELIGENTE: Solo si está disponible o en carrera
                if (conductorData.estado !== 'inactivo' && !solicitudTemp) {
                    mapa.panTo([latitude, longitude]);
                    window.supabaseClient.from('conductores').update({ latitud: latitude, longitud: longitude, rumbo: heading }).eq('id', conductorId).then();
                }
            }, console.error, { enableHighAccuracy: true });
        }

        inicializarSlider();
        suscribirse();
        await recuperarSesion(); // Persistencia
        cargarStats();
        cargarHistorialCompleto();

    } catch (e) { alert(e.message); }
}

// ... (Funciones soporte iguales) ...
async function esperarSupabase() { return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); }); }
async function cargarDatosConductor() {
    const { data } = await window.supabaseClient.from('conductores').select('*').eq('perfil_id', usuario.id).single();
    conductorId = data.id; conductorData = data;
    updateStatusUI(data.estado);
}

// --- LÓGICA PRINCIPAL ---

async function recuperarSesion() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('conductor_id', conductorId)
        .in('estado', ['aceptada','en_camino','en_curso']).maybeSingle();
    
    if (data) {
        carreraEnCurso = data;
        mostrarPantallaViaje();
    } else {
        cargarSolicitudes();
    }
}

async function cargarSolicitudes() {
    if (carreraEnCurso) return; // No cargar lista si estoy ocupado
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('estado', 'buscando').is('conductor_id', null);
    const div = document.getElementById('requestsList');
    
    if (!data || !data.length) { div.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:2rem">Esperando viajes...</p>'; return; }
    
    div.innerHTML = data.map(c => `
        <div class="req-item" onclick='lanzarAlerta(${JSON.stringify(c)})'>
            <div class="req-header"><span class="tag">${c.tipo}</span><span class="price">L ${c.precio}</span></div>
            <div>📍 ${c.origen_direccion}</div>
        </div>`).join('');
}

function lanzarAlerta(carrera) {
    if (conductorData.estado === 'inactivo') return alert('Ponte en línea primero');
    solicitudTemp = carrera;
    document.getElementById('alertPrice').textContent = 'L ' + carrera.precio;
    document.getElementById('alertAddress').textContent = carrera.origen_direccion;
    document.getElementById('alertOverlay').classList.add('active');
    document.getElementById('sound').play().catch(()=>{});
    resetSlider();
    
    // Calcular distancia real
    if (miUbicacion) {
        // OSRM fetch... (simplificado)
        document.getElementById('alertDist').textContent = 'Calculando...';
    }
}

function rechazar() {
    document.getElementById('alertOverlay').classList.remove('active');
    document.getElementById('sound').pause();
    solicitudTemp = null;
    cargarSolicitudes();
}

async function aceptarViaje() {
    document.getElementById('sound').pause();
    try {
        const { data, error } = await window.supabaseClient.from('carreras')
            .update({ conductor_id: conductorId, estado: 'aceptada', fecha_aceptacion: new Date() })
            .eq('id', solicitudTemp.id).is('conductor_id', null).select().single();

        if (error) throw new Error('Ya fue tomado');
        
        carreraEnCurso = data;
        await window.supabaseClient.from('conductores').update({ estado: 'en_carrera' }).eq('id', conductorId);
        conductorData.estado = 'en_carrera';
        updateStatusUI('en_carrera');
        
        document.getElementById('alertOverlay').classList.remove('active');
        mostrarPantallaViaje();

    } catch (e) { alert(e.message); rechazar(); }
}

function mostrarPantallaViaje() {
    document.getElementById('requestsList').classList.add('hidden');
    document.getElementById('activeTripCard').classList.remove('hidden');
    
    const title = document.getElementById('tripStatusTitle');
    const dest = document.getElementById('tripDest');
    const btn = document.getElementById('tripBtn');
    
    if (carreraEnCurso.estado === 'aceptada' || carreraEnCurso.estado === 'en_camino') {
        title.textContent = 'Yendo a Recoger';
        dest.textContent = carreraEnCurso.origen_direccion;
        btn.textContent = '📍 Llegué';
        btn.onclick = () => avanzarEstado('en_curso');
        dibujarRuta({lat: carreraEnCurso.origen_lat, lng: carreraEnCurso.origen_lng});
    } else {
        title.textContent = 'En Curso';
        dest.textContent = carreraEnCurso.destino_direccion;
        btn.textContent = '🏁 Finalizar';
        btn.onclick = () => avanzarEstado('completada');
        dibujarRuta({lat: carreraEnCurso.destino_lat, lng: carreraEnCurso.destino_lng});
    }
}

async function avanzarEstado(nuevo) {
    if (nuevo === 'completada') {
        document.getElementById('rateModal').style.display = 'flex';
        // La actualización DB se hace al enviar calificación
    } else {
        await window.supabaseClient.from('carreras').update({ estado: nuevo, fecha_inicio: new Date() }).eq('id', carreraEnCurso.id);
        carreraEnCurso.estado = nuevo;
        mostrarPantallaViaje();
    }
}

window.enviarRating = async function() {
    // Finalizar viaje DB
    await window.supabaseClient.from('carreras').update({ 
        estado: 'completada', 
        fecha_completado: new Date(),
        calificacion_cliente: window.currentRating || 5
    }).eq('id', carreraEnCurso.id);

    await window.supabaseClient.from('conductores').update({ estado: 'disponible' }).eq('id', conductorId);
    conductorData.estado = 'disponible';
    updateStatusUI('disponible');
    
    document.getElementById('rateModal').style.display = 'none';
    carreraEnCurso = null;
    document.getElementById('activeTripCard').classList.add('hidden');
    document.getElementById('requestsList').classList.remove('hidden');
    
    if (rutaLayer) mapa.removeLayer(rutaLayer);
    cargarStats();
    cargarSolicitudes();
}

// --- UTILS ---
function suscribirse() {
    window.supabaseClient.channel('conductor').on('postgres_changes', { event: '*', schema: 'public', table: 'carreras' }, payload => {
        if (!carreraEnCurso) cargarSolicitudes();
    }).subscribe();
}

async function cargarStats() {
    const hoy = new Date().toISOString().split('T')[0];
    const { data } = await window.supabaseClient.from('carreras').select('precio').eq('conductor_id', conductorId).eq('estado', 'completada').gte('fecha_completado', hoy);
    if(data) {
        document.getElementById('todayTrips').textContent = data.length;
        document.getElementById('todayEarnings').textContent = 'L ' + data.reduce((a,b)=>a+(b.precio||0),0).toFixed(0);
    }
}

async function cargarHistorialCompleto() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('conductor_id', conductorId).eq('estado', 'completada').order('fecha_completado', {ascending:false}).limit(20);
    const div = document.getElementById('fullHistory');
    div.innerHTML = data.map(c => `<div class="hist-item"><div>${new Date(c.fecha_completado).toLocaleDateString()}</div><div style="font-weight:bold;color:#10b981">L ${c.precio}</div></div>`).join('');
}

function inicializarSlider() {
    const slider = document.getElementById('slider');
    const thumb = document.getElementById('sliderThumb');
    let isDragging = false, startX, w;
    
    const start = e => { isDragging=true; startX=(e.touches?e.touches[0].clientX:e.clientX); w=slider.offsetWidth-thumb.offsetWidth; };
    const move = e => {
        if(!isDragging) return;
        let x = (e.touches?e.touches[0].clientX:e.clientX) - startX;
        if(x<0)x=0; if(x>w)x=w;
        thumb.style.transform = `translateX(${x}px)`;
    };
    const end = () => {
        if(!isDragging) return; isDragging=false;
        const x = new WebKitCSSMatrix(window.getComputedStyle(thumb).transform).m41;
        if(x > w*0.9) aceptarViaje(); else thumb.style.transform = `translateX(0px)`;
    };
    thumb.addEventListener('touchstart', start); window.addEventListener('touchmove', move); window.addEventListener('touchend', end);
}

function resetSlider() { document.getElementById('sliderThumb').style.transform = `translateX(0px)`; }
function updateStatusUI(s) {
    const d = document.getElementById('statusDot'), t = document.getElementById('statusText');
    d.className = 'dot ' + (s==='disponible'?'online':(s==='en_carrera'?'busy':'offline'));
    t.textContent = s==='disponible'?'En Línea':(s==='en_carrera'?'Ocupado':'Offline');
}
async function cerrarSesion() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }
async function dibujarRuta(dest) {
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${miUbicacion.lng},${miUbicacion.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`);
    const data = await res.json();
    if(data.routes?.[0]) rutaLayer = L.geoJSON(data.routes[0].geometry).addTo(mapa);
}

window.addEventListener('load', init);
