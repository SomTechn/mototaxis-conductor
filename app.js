// CONDUCTOR JS (FINAL)
let mapa, usuario, conductorId, conductorData, carreraEnCurso = null, solicitudTemp = null;
let miUbicacion, miMarker, rutaLayer;

// MAPA
function inicializarMapa() {
    if(!document.getElementById('map')) return;
    mapa = L.map('map', { zoomControl: false }).setView([15.5, -88], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapa);
    
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(pos => {
            const { latitude: lat, longitude: lng, heading } = pos.coords;
            miUbicacion = { lat, lng };
            if (!miMarker) {
                miMarker = L.marker([lat, lng], {icon: L.divIcon({html:`<div style="transform:rotate(${heading||0}deg);font-size:24px;color:#00E676">➤</div>`, className:'nav-arrow'})}).addTo(mapa);
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
        inicializarMapa();
        inicializarSlider();
        suscribirse();
        await recuperarEstado();
        
        document.getElementById('loader').style.display = 'none';
    } catch(e) { console.error(e); }
}

async function esperarSupabase() { return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); }); }
async function cargarDatos() {
    const { data } = await window.supabaseClient.from('conductores').select('*, perfiles(nombre)').eq('perfil_id', usuario.id).single();
    conductorId = data.id; conductorData = data;
    document.getElementById('driverName').textContent = data.perfiles.nombre;
    updateStatusUI(data.estado);
}

// LOGICA VIAJE
async function recuperarEstado() {
    const { data } = await window.supabaseClient.from('carreras').select('*, clientes(nombre, telefono)').eq('conductor_id', conductorId).in('estado', ['aceptada','en_camino','en_curso']).maybeSingle();
    if (data) { carreraEnCurso = data; mostrarViaje(); }
    else cargarSolicitudes();
}

async function cargarSolicitudes() {
    if(carreraEnCurso) return;
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('estado','buscando').is('conductor_id',null).order('fecha_solicitud',{ascending:false});
    const list = document.getElementById('reqList'); // En el statsSheet
    // Actualizar lista en statsSheet si existe el elemento en tu HTML
}

// ... suscripcion igual ...
function suscribirse() {
    window.supabaseClient.channel('cond').on('postgres_changes', { event: '*', schema: 'public', table: 'carreras' }, payload => {
        const n = payload.new;
        // Nueva alerta si estoy libre
        if (n.estado === 'buscando' && !n.conductor_id && !carreraEnCurso && conductorData.estado === 'disponible') {
            mostrarAlerta(n);
        }
        // Cancelacion
        if (carreraEnCurso && n.id === carreraEnCurso.id && n.estado.includes('cancelada')) {
            alert('Cancelado'); reset();
        }
    }).subscribe();
}

function mostrarAlerta(c) {
    solicitudTemp = c;
    document.getElementById('alertPrice').textContent = 'L ' + c.precio;
    document.getElementById('alertAddr').textContent = c.origen_direccion;
    document.getElementById('alertOverlay').classList.add('active');
    document.getElementById('sound').play().catch(()=>{});
    
    // Dibujar Ruta Preview
    if(miUbicacion) dibujarRuta({lat: c.origen_lat, lng: c.origen_lng}, true); // True = Preview padding
}

async function aceptar() {
    document.getElementById('sound').pause();
    const { data, error } = await window.supabaseClient.from('carreras').update({ conductor_id: conductorId, estado: 'aceptada' }).eq('id', solicitudTemp.id).is('conductor_id', null).select('*, clientes(nombre, telefono)').single();
    
    if (error) { alert('Ganado por otro'); document.getElementById('alertOverlay').classList.remove('active'); return; }
    
    carreraEnCurso = data;
    await window.supabaseClient.from('conductores').update({ estado: 'en_carrera' }).eq('id', conductorId);
    conductorData.estado = 'en_carrera';
    document.getElementById('alertOverlay').classList.remove('active');
    mostrarViaje();
}

function mostrarViaje() {
    document.getElementById('statsSheet').style.display = 'none';
    document.getElementById('tripCard').style.display = 'block';
    
    const t = document.getElementById('tripTitle');
    const d = document.getElementById('tripDest');
    const btn = document.getElementById('tripBtn');
    
    // CORRECCIÓN: Nombre Cliente en Card
    document.getElementById('tripClientName').textContent = carreraEnCurso.clientes?.nombre || 'Pasajero';
    
    if (carreraEnCurso.estado === 'aceptada' || carreraEnCurso.estado === 'en_camino') {
        t.textContent = 'Recoger Pasajero'; 
        d.textContent = carreraEnCurso.origen_direccion;
        btn.textContent = 'Llegué'; 
        btn.onclick = () => avanzar('en_curso');
        dibujarRuta({lat:carreraEnCurso.origen_lat, lng:carreraEnCurso.origen_lng});
    } else {
        t.textContent = 'Llevar a Destino'; 
        d.textContent = carreraEnCurso.destino_direccion;
        btn.textContent = 'Finalizar'; 
        btn.onclick = () => avanzar('completada');
        dibujarRuta({lat:carreraEnCurso.destino_lat, lng:carreraEnCurso.destino_lng});
    }
}

async function avanzar(est) {
    if(est === 'completada') {
        document.getElementById('rateModal').style.display = 'flex'; // Calificar cliente
    } else {
        await window.supabaseClient.from('carreras').update({ estado: est }).eq('id', carreraEnCurso.id);
        carreraEnCurso.estado = est; mostrarViaje();
    }
}

async function dibujarRuta(dest, isPreview = false) {
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${miUbicacion.lng},${miUbicacion.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`);
    const d = await res.json();
    if(d.routes?.[0]) {
        rutaLayer = L.geoJSON(d.routes[0].geometry, {style:{color:'#00E676', weight:6}}).addTo(mapa);
        // CORRECCIÓN ZOOM: Padding grande abajo (400px) para que la ruta se vea ARRIBA del panel
        const padBottom = isPreview ? 100 : 400; 
        mapa.fitBounds(rutaLayer.getBounds(), {paddingTopLeft:[20,20], paddingBottomRight:[20, padBottom]});
    }
}

// ... Utils Slider y Reset iguales que antes ...
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

function reset() {
    carreraEnCurso = null; solicitudTemp = null;
    document.getElementById('tripCard').style.display = 'none';
    document.getElementById('statsSheet').style.display = 'block';
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    window.supabaseClient.from('conductores').update({ estado: 'disponible' }).eq('id', conductorId);
    conductorData.estado = 'disponible';
    updateStatusUI('disponible');
}

// Funciones UI
function toggleStatus() {
    const n = conductorData.estado === 'disponible' ? 'inactivo' : 'disponible';
    window.supabaseClient.from('conductores').update({ estado: n }).eq('id', conductorId).then();
    conductorData.estado = n; updateStatusUI(n);
}
function updateStatusUI(s) {
    const d=document.getElementById('statusDot'), t=document.getElementById('statusTxt');
    d.className = 'dot '+(s==='disponible'?'online':'offline'); t.textContent = s==='disponible'?'En Línea':'Offline';
}
function rechazar() { document.getElementById('alertOverlay').classList.remove('active'); document.getElementById('sound').pause(); solicitudTemp=null; }
async function sendRate() { await window.supabaseClient.from('carreras').update({ estado: 'completada', fecha_completado: new Date() }).eq('id', carreraEnCurso.id); document.getElementById('rateModal').style.display = 'none'; reset(); }
async function logout() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }

window.addEventListener('load', init);
