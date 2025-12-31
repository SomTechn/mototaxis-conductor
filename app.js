// APP CONDUCTOR - FINAL (OPTIMIZADO)
let mapa, usuario, conductorId, conductorData, carreraEnCurso = null, solicitudTemp = null;
let miUbicacion = null, miMarker = null, rutaLayer = null, timer = null;

function inicializarMapa() {
    if(!document.getElementById('map')) return;
    mapa = L.map('map', { zoomControl: false }).setView([15.5, -88], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapa);
    
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(pos => {
            const { latitude: lat, longitude: lng, heading } = pos.coords;
            miUbicacion = { lat, lng };
            if (!miMarker) {
                miMarker = L.marker([lat, lng], {icon: L.divIcon({className:'nav-arrow', html:`<div style="transform:rotate(${heading||0}deg);font-size:30px;color:#00E676;text-shadow:0 0 10px rgba(0,230,118,0.5)">➤</div>`, iconSize:[30,30], iconAnchor:[15,15]})}).addTo(mapa);
                mapa.setView([lat, lng], 16);
            } else {
                miMarker.setLatLng([lat, lng]);
                miMarker.setIcon(L.divIcon({className:'nav-arrow', html:`<div style="transform:rotate(${heading||0}deg);font-size:30px;color:#00E676;text-shadow:0 0 10px rgba(0,230,118,0.5)">➤</div>`, iconSize:[30,30], iconAnchor:[15,15]}));
            }
            
            // Auto-centrar solo si estoy en viaje y moviéndome
            if (carreraEnCurso && !solicitudTemp) mapa.panTo([lat, lng]);
            
            if (conductorData?.estado !== 'inactivo') {
                window.supabaseClient.from('conductores').update({ latitud: lat, longitud: lng, rumbo: heading }).eq('id', conductorId).then();
            }
        }, null, {enableHighAccuracy:true});
    }
}

function centrarMapa() { if(miUbicacion) { mapa.setView([miUbicacion.lat, miUbicacion.lng], 16); } }

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
    } catch(e) { console.error(e); }
}

async function esperarSupabase() { return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); }); }
async function cargarDatos() {
    const { data } = await window.supabaseClient.from('conductores').select('*, perfiles(nombre)').eq('perfil_id', usuario.id).single();
    conductorId = data.id; conductorData = data;
    document.getElementById('driverName').textContent = data.perfiles.nombre;
    renderStatus(data.estado);
}

// --- LOGICA VIAJES ---
async function recuperarEstado() {
    const { data } = await window.supabaseClient.from('carreras').select('*, clientes(nombre, telefono)')
        .eq('conductor_id', conductorId).in('estado', ['aceptada','en_camino','en_curso']).maybeSingle();
    if (data) { carreraEnCurso = data; mostrarViaje(); }
    else cargarSolicitudes();
}

async function cargarSolicitudes() {
    if(carreraEnCurso) return;
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('estado','buscando').is('conductor_id',null).order('fecha_solicitud',{ascending:false});
    document.getElementById('reqCount').textContent = data?.length || 0;
    const list = document.getElementById('reqList');
    if(!data || !data.length) list.innerHTML = '<p style="text-align:center;color:#555;font-size:12px">Esperando...</p>';
    else list.innerHTML = data.map(c => `<div style="background:#2C2C2C;padding:10px;border-radius:8px;margin-bottom:5px;border:1px solid #444;cursor:pointer" onclick='lanzarAlerta(${JSON.stringify(c)})'><div style="display:flex;justify-content:space-between;color:white;font-size:14px"><strong>${c.tipo.toUpperCase()}</strong><span style="color:#00E676">L ${c.precio}</span></div><div style="font-size:11px;color:#aaa">${c.origen_direccion}</div></div>`).join('');
}

async function lanzarAlerta(c) {
    if(conductorData.estado === 'inactivo') return alert('Debes estar En Línea');
    solicitudTemp = c;
    
    // UI DATOS
    document.getElementById('alertPrice').textContent = 'L ' + c.precio;
    document.getElementById('alertAddrOrigin').textContent = c.origen_direccion;
    document.getElementById('alertAddrDest').textContent = c.destino_direccion;
    document.getElementById('reqType').textContent = c.tipo === 'directo' ? 'VIAJE DIRECTO' : 'VIAJE COLECTIVO';
    
    // UI Mostrar
    document.getElementById('statsSheet').classList.add('hidden');
    document.getElementById('alertOverlay').classList.add('active');
    document.getElementById('sound').play().catch(()=>{});
    
    // Reset Slider
    document.getElementById('sliderThumb').style.transform = 'translateX(0)';
    
    // CALCULAR RUTAS (Tú -> Cliente -> Destino)
    if (miUbicacion) {
        document.getElementById('pickupDist').textContent = '...';
        
        // 1. Tú a Cliente
        const res1 = await fetch(`https://router.project-osrm.org/route/v1/driving/${miUbicacion.lng},${miUbicacion.lat};${c.origen_lng},${c.origen_lat}?overview=false`);
        const d1 = await res1.json();
        const minPickup = d1.routes?.[0] ? Math.ceil(d1.routes[0].duration / 60) : 0;
        document.getElementById('pickupDist').textContent = minPickup + ' min';
        
        // 2. Cliente a Destino (Ya viene en BD, pero calculamos total)
        const totalKm = (c.distancia_km || 0) + (d1.routes?.[0]?.distance/1000 || 0);
        document.getElementById('totalDist').textContent = totalKm.toFixed(1) + ' km';

        // 3. Dibujar en Mapa (Tú -> Cliente -> Destino)
        if(rutaLayer) mapa.removeLayer(rutaLayer);
        const resMap = await fetch(`https://router.project-osrm.org/route/v1/driving/${miUbicacion.lng},${miUbicacion.lat};${c.origen_lng},${c.origen_lat};${c.destino_lng},${c.destino_lat}?overview=full&geometries=geojson`);
        const dMap = await resMap.json();
        if(dMap.routes?.[0]) {
            rutaLayer = L.geoJSON(dMap.routes[0].geometry, {style:{color:'#2979FF', weight:6, opacity:0.8}}).addTo(mapa);
            // PADDING IMPORTANTE PARA QUE SE VEA ARRIBA
            mapa.fitBounds(rutaLayer.getBounds(), {paddingTopLeft:[20,20], paddingBottomRight:[20, 380]});
        }
    }
    
    // TIMER 30s
    let t = 30;
    const timerEl = document.getElementById('reqTimer');
    if(timer) clearInterval(timer);
    timer = setInterval(() => {
        t--; timerEl.textContent = t+'s';
        if(t<=0) rechazar();
    }, 1000);
}

function rechazar() {
    document.getElementById('alertOverlay').classList.remove('active');
    document.getElementById('statsSheet').classList.remove('hidden');
    document.getElementById('sound').pause();
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    clearInterval(timer);
    solicitudTemp = null;
    centrarMapa();
    cargarSolicitudes();
}

async function aceptar() {
    document.getElementById('sound').pause();
    clearInterval(timer);
    
    const { data, error } = await window.supabaseClient.from('carreras')
        .update({ conductor_id: conductorId, estado: 'aceptada' })
        .eq('id', solicitudTemp.id).is('conductor_id', null)
        .select('*, clientes(nombre, telefono)').single();
        
    if(error) { alert('El viaje ya no está disponible'); rechazar(); return; }
    
    carreraEnCurso = data;
    await window.supabaseClient.from('conductores').update({ estado: 'en_carrera' }).eq('id', conductorId);
    conductorData.estado = 'en_carrera';
    document.getElementById('alertOverlay').classList.remove('active');
    mostrarViaje();
}

function mostrarViaje() {
    document.getElementById('statsSheet').classList.add('hidden');
    document.getElementById('tripCard').style.display = 'block';
    document.getElementById('gpsBtn').style.bottom = '300px'; // Subir botón GPS
    
    const t = document.getElementById('tripTitle');
    const d = document.getElementById('tripDest');
    const btn = document.getElementById('tripBtn');
    const client = document.getElementById('tripClientName');
    
    client.textContent = carreraEnCurso.clientes?.nombre || 'Cliente';
    
    if (carreraEnCurso.estado === 'aceptada' || carreraEnCurso.estado === 'en_camino') {
        t.textContent = 'Yendo a Recoger';
        d.textContent = carreraEnCurso.origen_direccion;
        btn.textContent = 'Llegué por el cliente';
        btn.onclick = () => avanzar('en_curso');
        btn.className = 'btn-main btn-blue';
        dibujarRuta({lat:carreraEnCurso.origen_lat, lng:carreraEnCurso.origen_lng});
    } else {
        t.textContent = 'Llevando a Destino';
        d.textContent = carreraEnCurso.destino_direccion;
        btn.textContent = 'Finalizar Viaje';
        btn.onclick = () => avanzar('completada');
        btn.className = 'btn-main btn-green';
        dibujarRuta({lat:carreraEnCurso.destino_lat, lng:carreraEnCurso.destino_lng});
    }
}

async function avanzar(est) {
    if(est === 'completada') {
        document.getElementById('rateModal').style.display = 'flex';
    } else {
        await window.supabaseClient.from('carreras').update({ estado: est, fecha_inicio: new Date() }).eq('id', carreraEnCurso.id);
        carreraEnCurso.estado = est;
        mostrarViaje();
    }
}

async function sendRate() {
    const r = window.rating || 5;
    await window.supabaseClient.from('carreras').update({ estado: 'completada', fecha_completado: new Date(), calificacion_cliente: r }).eq('id', carreraEnCurso.id);
    reset();
}

async function reset() {
    document.getElementById('rateModal').style.display = 'none';
    document.getElementById('tripCard').style.display = 'none';
    document.getElementById('statsSheet').classList.remove('hidden');
    document.getElementById('gpsBtn').style.bottom = '140px';
    
    await window.supabaseClient.from('conductores').update({ estado: 'disponible' }).eq('id', conductorId);
    conductorData.estado = 'disponible';
    renderStatus('disponible');
    carreraEnCurso = null; solicitudTemp = null;
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    cargarStats(); cargarSolicitudes(); centrarMapa();
}

async function cancelar() {
    if(!confirm('¿Cancelar viaje?')) return;
    await window.supabaseClient.from('carreras').update({ estado: 'cancelada_conductor' }).eq('id', carreraEnCurso.id);
    reset();
}

// UTILS
function suscribirse() {
    window.supabaseClient.channel('cond').on('postgres_changes', { event: '*', schema: 'public', table: 'carreras' }, payload => {
        const n = payload.new;
        if(n.estado === 'buscando' && !n.conductor_id && !carreraEnCurso && conductorData.estado === 'disponible') {
            // Check si ya estoy mostrando esta alerta
            if(!solicitudTemp || solicitudTemp.id !== n.id) {
                // Verificar distancia (opcional)
                lanzarAlerta(n);
            }
        }
        else if(!carreraEnCurso) cargarSolicitudes();
    }).subscribe();
}

async function dibujarRuta(dest) {
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${miUbicacion.lng},${miUbicacion.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`);
    const d = await res.json();
    if(d.routes?.[0]) {
        rutaLayer = L.geoJSON(d.routes[0].geometry, {style:{color: carreraEnCurso.estado==='en_curso'?'#00E676':'#2979FF', weight:6}}).addTo(mapa);
        mapa.fitBounds(rutaLayer.getBounds(), {paddingTopLeft:[20,20], paddingBottomRight:[20, 300]});
        const min = Math.ceil(d.routes[0].duration/60);
        document.getElementById('tripETA').textContent = min + ' min';
    }
}

function inicializarSlider() {
    const s = document.getElementById('slider'), t = document.getElementById('sliderThumb');
    let d=false, sx, w;
    t.addEventListener('touchstart', e => { d=true; sx=e.touches[0].clientX; w=s.offsetWidth-t.offsetWidth; });
    window.addEventListener('touchmove', e => { if(d) t.style.transform = `translateX(${Math.min(w, Math.max(0, e.touches[0].clientX-sx))}px)`; });
    window.addEventListener('touchend', () => { d=false; if(new WebKitCSSMatrix(t.style.transform).m41 > w*0.9) aceptar(); else t.style.transform='translateX(0)'; });
}

async function cargarHistorial() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('conductor_id', conductorId).eq('estado','completada').order('fecha_completado',{ascending:false}).limit(20);
    document.getElementById('historyList').innerHTML = data.map(c => `<div style="border-bottom:1px solid #333;padding:10px 0;display:flex;justify-content:space-between"><div>${new Date(c.fecha_completado).toLocaleDateString()}</div><div style="color:#00E676">L ${c.precio}</div></div>`).join('');
}

// ... Resto de funciones (stats, toggleStatus, logout) igual que antes ...
function renderStatus(s) { document.getElementById('statusDot').className = 'dot '+(s==='disponible'?'online':'offline'); document.getElementById('statusTxt').textContent = s==='disponible'?'En Línea':'Offline'; }
function toggleStatus() { const n = conductorData.estado==='disponible'?'inactivo':'disponible'; window.supabaseClient.from('conductores').update({estado:n}).eq('id',conductorId).then(); conductorData.estado=n; renderStatus(n); }
async function cargarStats() { /* igual */ }
async function logout() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }
function navApp() { window.open(`https://waze.com/ul?ll=${carreraEnCurso.estado==='en_curso'?carreraEnCurso.destino_lat:carreraEnCurso.origen_lat},${carreraEnCurso.estado==='en_curso'?carreraEnCurso.destino_lng:carreraEnCurso.origen_lng}&navigate=yes`); }
function callClient() { window.open(`tel:${carreraEnCurso.clientes?.telefono}`); }

window.addEventListener('load', init);
