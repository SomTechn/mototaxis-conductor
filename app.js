// CONDUCTOR JS (FIXED)
let mapa, usuario, conductorId, conductorData;
let carreraEnCurso = null, solicitudTemp = null;
let miUbicacion, miMarker, rutaLayer;

// --- INICIALIZAR MAPA GLOBALMENTE ---
function inicializarMapa() {
    if(!document.getElementById('map')) return;
    mapa = L.map('map', { zoomControl: false }).setView([15.5, -88], 13);
    // Usar mapa oscuro CartoDB Dark Matter
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapa);
    
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(pos => {
            const { latitude: lat, longitude: lng } = pos.coords;
            miUbicacion = { lat, lng };
            if (!miMarker) {
                miMarker = L.marker([lat, lng], {icon: L.divIcon({className:'nav-arrow', html:'<div style="color:#00E676;font-size:24px;transform:rotate(0deg)">➤</div>'})}).addTo(mapa);
                mapa.setView([lat, lng], 16);
            } else {
                miMarker.setLatLng([lat, lng]);
            }
            
            // Actualizar DB
            if (conductorData?.estado !== 'inactivo') {
                window.supabaseClient.from('conductores').update({ latitud: lat, longitud: lng }).eq('id', conductorId).then();
            }
        }, null, {enableHighAccuracy:true});
    }
}

async function init() {
    try {
        await esperarSupabase();
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return window.location.href = 'login.html';
        usuario = session.user;

        await cargarDatos();
        inicializarMapa(); 
        inicializarSlider();
        suscribirse();
        await recuperarEstado();
        cargarStats();

        document.getElementById('loader').classList.add('hidden');
    } catch(e) { alert(e.message); }
}

async function esperarSupabase() { return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); }); }

async function cargarDatos() {
    const { data } = await window.supabaseClient.from('conductores').select('*, perfiles(nombre)').eq('perfil_id', usuario.id).maybeSingle();
    if (!data) return alert('Perfil no encontrado');
    conductorId = data.id; conductorData = data;
    document.getElementById('driverName').textContent = data.perfiles.nombre;
    renderStatus(data.estado);
}

// --- ESTADOS ---
async function recuperarEstado() {
    const { data } = await window.supabaseClient.from('carreras').select('*, clientes(nombre, telefono)')
        .eq('conductor_id', conductorId).in('estado', ['aceptada','en_camino','en_curso']).maybeSingle();
    if (data) {
        carreraEnCurso = data;
        mostrarViaje();
    }
}

function suscribirse() {
    window.supabaseClient.channel('cond').on('postgres_changes', { event: '*', schema: 'public', table: 'carreras' }, payload => {
        const nueva = payload.new;
        // Nueva Solicitud (Si estoy libre)
        if (nueva.estado === 'buscando' && !nueva.conductor_id && conductorData.estado === 'disponible' && !carreraEnCurso && !solicitudTemp) {
            mostrarAlerta(nueva);
        }
        // Cancelación
        if (carreraEnCurso && nueva.id === carreraEnCurso.id && nueva.estado.includes('cancelada')) {
            alert('Cancelado'); reset();
        }
    }).subscribe();
}

// --- ALERTA ---
function mostrarAlerta(c) {
    solicitudTemp = c;
    document.getElementById('alertPrice').textContent = 'L ' + c.precio;
    document.getElementById('alertAddr').textContent = c.origen_direccion;
    document.getElementById('distTrip').textContent = c.distancia_km + ' km';
    document.getElementById('alertOverlay').classList.add('active');
    document.getElementById('sound').play().catch(()=>{});
    
    // Reset Slider
    document.getElementById('sliderThumb').style.transform = 'translateX(0)';
    
    // OSRM Tiempo a recoger
    if (miUbicacion) {
        fetch(`https://router.project-osrm.org/route/v1/driving/${miUbicacion.lng},${miUbicacion.lat};${c.origen_lng},${c.origen_lat}?overview=false`)
            .then(r=>r.json()).then(d => {
                if(d.routes?.[0]) document.getElementById('distPick').textContent = Math.ceil(d.routes[0].duration/60) + ' min';
            });
    }
}

function rechazar() {
    document.getElementById('alertOverlay').classList.remove('active');
    document.getElementById('sound').pause();
    solicitudTemp = null;
}

async function aceptar() {
    document.getElementById('sound').pause();
    const { data, error } = await window.supabaseClient.from('carreras')
        .update({ conductor_id: conductorId, estado: 'aceptada' }).eq('id', solicitudTemp.id).is('conductor_id', null).select('*, clientes(nombre, telefono)').single();
    
    if (error) { alert('Ganado por otro'); rechazar(); return; }
    
    carreraEnCurso = data;
    await window.supabaseClient.from('conductores').update({ estado: 'en_carrera' }).eq('id', conductorId);
    conductorData.estado = 'en_carrera';
    document.getElementById('alertOverlay').classList.remove('active');
    mostrarViaje();
}

// --- VIAJE ACTIVO ---
function mostrarViaje() {
    document.getElementById('statsSheet').style.display = 'none';
    document.getElementById('tripCard').style.display = 'block';
    
    const t = document.getElementById('tripTitle');
    const d = document.getElementById('tripDest');
    const b = document.getElementById('tripBtn');
    
    if (carreraEnCurso.estado === 'en_curso') {
        t.textContent = 'En Ruta';
        d.textContent = carreraEnCurso.destino_direccion;
        b.textContent = 'Finalizar (Cobrar L '+carreraEnCurso.precio+')';
        b.className = 'btn-main btn-green';
        b.onclick = finalizar;
        dibujarRuta({lat: carreraEnCurso.destino_lat, lng: carreraEnCurso.destino_lng});
    } else {
        t.textContent = 'Recoger a ' + (carreraEnCurso.clientes?.nombre || 'Cliente');
        d.textContent = carreraEnCurso.origen_direccion;
        b.textContent = 'Ya llegué';
        b.className = 'btn-main btn-blue';
        b.onclick = empezar;
        dibujarRuta({lat: carreraEnCurso.origen_lat, lng: carreraEnCurso.origen_lng});
    }
}

async function empezar() {
    const { data } = await window.supabaseClient.from('carreras').update({ estado: 'en_curso', fecha_inicio: new Date() }).eq('id', carreraEnCurso.id).select('*, clientes(*)').single();
    carreraEnCurso = data;
    mostrarViaje();
}

async function finalizar() {
    if(!confirm('Cobrar L '+carreraEnCurso.precio)) return;
    await window.supabaseClient.from('carreras').update({ estado: 'completada', fecha_completado: new Date() }).eq('id', carreraEnCurso.id);
    reset();
}

async function reset() {
    carreraEnCurso = null; solicitudTemp = null;
    await window.supabaseClient.from('conductores').update({ estado: 'disponible' }).eq('id', conductorId);
    conductorData.estado = 'disponible';
    renderStatus('disponible');
    document.getElementById('tripCard').style.display = 'none';
    document.getElementById('statsSheet').style.display = 'block';
    cargarStats();
    if(rutaLayer) mapa.removeLayer(rutaLayer);
}

// --- UTILS ---
function toggleStatus() {
    const n = conductorData.estado === 'disponible' ? 'inactivo' : 'disponible';
    window.supabaseClient.from('conductores').update({ estado: n }).eq('id', conductorId).then();
    conductorData.estado = n;
    renderStatus(n);
}

function renderStatus(s) {
    const d = document.getElementById('statusDot'), t = document.getElementById('statusTxt');
    d.className = 'dot '+(s==='disponible'?'online':'offline');
    t.textContent = s==='disponible'?'En Línea':'Offline';
}

async function dibujarRuta(dest) {
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${miUbicacion.lng},${miUbicacion.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`);
    const d = await res.json();
    if(d.routes?.[0]) {
        rutaLayer = L.geoJSON(d.routes[0].geometry, {style:{color:'#00E676', weight:6}}).addTo(mapa);
        mapa.fitBounds(rutaLayer.getBounds(), {padding:[50,200]});
    }
}

function inicializarSlider() {
    const s = document.getElementById('slider'), t = document.getElementById('sliderThumb');
    let drag=false, sx, w;
    t.addEventListener('touchstart', e => { drag=true; sx=e.touches[0].clientX; w=s.offsetWidth-t.offsetWidth; });
    window.addEventListener('touchmove', e => {
        if(!drag) return;
        let x = Math.min(w, Math.max(0, e.touches[0].clientX - sx));
        t.style.transform = `translateX(${x}px)`;
    });
    window.addEventListener('touchend', () => {
        drag=false;
        let x = new WebKitCSSMatrix(window.getComputedStyle(t).transform).m41;
        if(x > w*0.9) aceptar(); else t.style.transform='translateX(0)';
    });
}

async function cargarStats() {
    const hoy = new Date().toISOString().split('T')[0];
    const { data } = await window.supabaseClient.from('carreras').select('precio').eq('conductor_id', conductorId).eq('estado','completada').gte('fecha_completado', hoy);
    document.getElementById('earnToday').textContent = 'L ' + (data?.reduce((a,b)=>a+b.precio,0)||0);
    document.getElementById('tripsToday').textContent = data?.length||0;
}

async function logout() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }
window.addEventListener('load', init);
