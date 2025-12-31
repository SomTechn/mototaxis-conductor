// CONDUCTOR JS (FINAL)
let mapa, usuario, conductorId, conductorData, carreraEnCurso = null, solicitudTemp = null;
let miUbicacion, miMarker, rutaLayer, watchId;

// DEFINIDA GLOBALMENTE
function inicializarMapa() {
    if(!document.getElementById('map')) return;
    mapa = L.map('map', { zoomControl: false }).setView([15.5, -88], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapa);
    
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(pos => {
            const { latitude: lat, longitude: lng } = pos.coords;
            miUbicacion = { lat, lng };
            if (!miMarker) {
                miMarker = L.marker([lat, lng], {icon: L.divIcon({className:'nav-arrow', html:'<div style="color:#00E676;font-size:24px">➤</div>'})}).addTo(mapa);
                mapa.setView([lat, lng], 16);
            } else {
                miMarker.setLatLng([lat, lng]);
            }
            if (conductorData?.estado !== 'inactivo') window.supabaseClient.from('conductores').update({ latitud: lat, longitud: lng }).eq('id', conductorId).then();
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
        inicializarMapa(); // Llama a la función global
        inicializarSlider();
        suscribirse();
        await recuperarEstado();
        cargarStats();

        document.getElementById('loader').classList.add('hidden');
    } catch(e) { alert(e.message); }
}

// ... Resto de funciones iguales ...
async function esperarSupabase() { return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); }); }
async function cargarDatos() {
    const { data } = await window.supabaseClient.from('conductores').select('*, perfiles(nombre)').eq('perfil_id', usuario.id).single();
    conductorId = data.id; conductorData = data;
    document.getElementById('driverName').textContent = data.perfiles.nombre;
    renderStatus(data.estado);
}

async function recuperarEstado() {
    const { data } = await window.supabaseClient.from('carreras').select('*, clientes(nombre, telefono)').eq('conductor_id', conductorId).in('estado',['aceptada','en_camino','en_curso']).maybeSingle();
    if(data) { carreraEnCurso = data; mostrarViaje(); }
}

function suscribirse() {
    window.supabaseClient.channel('driver').on('postgres_changes', {event:'*', schema:'public', table:'carreras'}, payload => {
        if (payload.eventType === 'INSERT' && payload.new.estado === 'buscando' && !carreraEnCurso) mostrarAlerta(payload.new);
    }).subscribe();
}

function mostrarAlerta(c) {
    solicitudTemp = c;
    document.getElementById('alertPrice').textContent = 'L ' + c.precio;
    document.getElementById('alertAddr').textContent = c.origen_direccion;
    document.getElementById('distTotal').textContent = c.distancia_km + ' km';
    document.getElementById('alertOverlay').classList.add('active');
    document.getElementById('sound').play().catch(()=>{});
    document.getElementById('sliderThumb').style.transform = 'translateX(0)';
}

async function aceptar() {
    document.getElementById('sound').pause();
    const { data, error } = await window.supabaseClient.from('carreras').update({ conductor_id: conductorId, estado: 'aceptada', fecha_aceptacion: new Date() }).eq('id', solicitudTemp.id).is('conductor_id', null).select('*, clientes(nombre, telefono)').single();
    if(error) { alert('Ganado por otro'); rechazar(); return; }
    carreraEnCurso = data;
    await window.supabaseClient.from('conductores').update({ estado: 'en_carrera' }).eq('id', conductorId);
    conductorData.estado = 'en_carrera';
    document.getElementById('alertOverlay').classList.remove('active');
    mostrarViaje();
}

function rechazar() {
    document.getElementById('alertOverlay').classList.remove('active');
    document.getElementById('sound').pause();
    solicitudTemp = null;
}

function mostrarViaje() {
    document.getElementById('tripCard').style.display = 'block';
    const t = document.getElementById('tripTitle');
    const d = document.getElementById('tripDest');
    const b = document.getElementById('tripBtn');
    
    if(carreraEnCurso.estado === 'aceptada' || carreraEnCurso.estado === 'en_camino') {
        t.textContent = 'Recoger Pasajero';
        d.textContent = carreraEnCurso.origen_direccion;
        b.textContent = 'Llegué'; b.className = 'btn-main btn-blue';
        b.onclick = () => avanzar('en_curso');
        dibujarRuta({lat: carreraEnCurso.origen_lat, lng: carreraEnCurso.origen_lng});
    } else {
        t.textContent = 'En Ruta';
        d.textContent = carreraEnCurso.destino_direccion;
        b.textContent = 'Finalizar Viaje'; b.className = 'btn-main btn-green';
        b.onclick = finalizar;
        dibujarRuta({lat: carreraEnCurso.destino_lat, lng: carreraEnCurso.destino_lng});
    }
}

async function avanzar(est) {
    const { data } = await window.supabaseClient.from('carreras').update({ estado: est, fecha_inicio: new Date() }).eq('id', carreraEnCurso.id).select('*, clientes(nombre, telefono)').single();
    carreraEnCurso = data;
    mostrarViaje();
}

async function finalizar() {
    document.getElementById('rateModal').style.display = 'flex';
}

async function sendRate() {
    await window.supabaseClient.from('carreras').update({ estado: 'completada', fecha_completado: new Date() }).eq('id', carreraEnCurso.id);
    await window.supabaseClient.from('conductores').update({ estado: 'disponible' }).eq('id', conductorId);
    conductorData.estado = 'disponible';
    renderStatus('disponible');
    document.getElementById('rateModal').style.display = 'none';
    document.getElementById('tripCard').style.display = 'none';
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    carreraEnCurso = null;
    cargarStats();
}

function inicializarSlider() {
    const s = document.getElementById('slider'), t = document.getElementById('sliderThumb');
    let drag=false, sx, w;
    t.addEventListener('touchstart', e => { drag=true; sx=e.touches[0].clientX; w=document.getElementById('slider').offsetWidth-50; });
    window.addEventListener('touchmove', e => { 
        let x = Math.min(w, Math.max(0, e.touches[0].clientX-sx));
        t.style.transform = `translateX(${x}px)`;
    });
    window.addEventListener('touchend', () => { 
        if(new WebKitCSSMatrix(t.style.transform).m41 > w*0.9) aceptar(); 
        else t.style.transform = 'translateX(0)';
    });
}

function renderStatus(s) {
    document.getElementById('statusDot').className = 'dot '+(s==='disponible'?'online':'offline');
    document.getElementById('statusTxt').textContent = s==='disponible'?'En Línea':'Offline';
}
function toggleStatus() {
    const n = conductorData.estado === 'disponible' ? 'inactivo' : 'disponible';
    window.supabaseClient.from('conductores').update({ estado: n }).eq('id', conductorId).then();
    conductorData.estado = n; renderStatus(n);
}
async function cargarStats() {
    const hoy = new Date().toISOString().split('T')[0];
    const { data } = await window.supabaseClient.from('carreras').select('precio').eq('conductor_id', conductorId).eq('estado','completada').gte('fecha_completado', hoy);
    document.getElementById('earnToday').textContent = 'L ' + (data?.reduce((a,b)=>a+b.precio,0)||0);
    document.getElementById('tripsToday').textContent = data?.length||0;
}
async function dibujarRuta(dest) {
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    if(miUbicacion) {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${miUbicacion.lng},${miUbicacion.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`);
        const d = await res.json();
        if(d.routes?.[0]) {
            rutaLayer = L.geoJSON(d.routes[0].geometry, {style:{color:'#00E676', weight:6}}).addTo(mapa);
            mapa.fitBounds(rutaLayer.getBounds(), {padding:[50,200]});
        }
    }
}
function openWaze() { 
    const dest = carreraEnCurso.estado === 'en_curso' ? {lat:carreraEnCurso.destino_lat, lng:carreraEnCurso.destino_lng} : {lat:carreraEnCurso.origen_lat, lng:carreraEnCurso.origen_lng};
    window.open(`https://waze.com/ul?ll=${dest.lat},${dest.lng}&navigate=yes`);
}
function callClient() { window.open(`tel:${carreraEnCurso.clientes?.telefono}`); }
async function cancel() { if(confirm('Cancelar?')) { await window.supabaseClient.from('carreras').update({estado:'cancelada_conductor'}).eq('id',carreraEnCurso.id); reset(); } }
async function logout() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }

window.addEventListener('load', init);
