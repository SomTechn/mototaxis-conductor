// APP CONDUCTOR (FINAL)
let mapa, usuario, conductorId, conductorData, carreraEnCurso = null, solicitudTemp = null;
let miUbicacion = null, miMarker = null;

// DEFINICIÓN DE INICIALIZAR MAPA (ANTES DE INIT)
function inicializarMapa() {
    if(!document.getElementById('map')) return;
    mapa = L.map('map', { zoomControl: false }).setView([15.5048, -88.0250], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa);
    if(navigator.geolocation) navigator.geolocation.watchPosition(pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        miUbicacion = { lat, lng };
        if(!miMarker) { miMarker = L.marker([lat, lng], {icon:L.divIcon({className:'moto-marker', html:'🏍️'})}).addTo(mapa); mapa.setView([lat,lng], 16); }
        else miMarker.setLatLng([lat, lng]);
        
        if(conductorData && conductorData.estado !== 'inactivo') 
            window.supabaseClient.from('conductores').update({ latitud: lat, longitud: lng }).eq('id', conductorId).then();
    }, console.error, {enableHighAccuracy:true});
}

async function init() {
    try {
        await esperarSupabase();
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return window.location.href = 'login.html';
        usuario = session.user;

        await cargarDatosConductor();
        inicializarMapa(); // YA ESTÁ DEFINIDA ARRIBA
        inicializarSlider();
        suscribirse();
        await recuperarSesion();
        cargarStats();
        
        document.getElementById('loader').classList.add('hidden');
    } catch (e) { alert(e.message); }
}

// ... Funciones soporte (esperarSupabase, cargarDatosConductor) igual que antes ...
async function esperarSupabase() { return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); }); }
async function cargarDatosConductor() {
    const { data } = await window.supabaseClient.from('conductores').select('*').eq('perfil_id', usuario.id).single();
    conductorId = data.id; conductorData = data;
    updateStatusUI(data.estado);
}

// LÓGICA
async function recuperarSesion() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('conductor_id', conductorId).in('estado',['aceptada','en_camino','en_curso']).maybeSingle();
    if(data) { carreraEnCurso = data; mostrarPantallaViaje(); }
    else cargarSolicitudes();
}

async function cargarSolicitudes() {
    if(carreraEnCurso) return;
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('estado','buscando').is('conductor_id',null);
    const div = document.getElementById('requestsList');
    if(!data || !data.length) div.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:1rem">Esperando...</p>';
    else div.innerHTML = data.map(c => `<div class="req-card" onclick='alerta(${JSON.stringify(c)})'><div style="display:flex;justify-content:space-between"><strong>${c.tipo}</strong><span style="color:#10b981;font-weight:800">L ${c.precio}</span></div><small>${c.origen_direccion}</small></div>`).join('');
}

function alerta(c) {
    if(conductorData.estado === 'inactivo') return alert('Ponte en línea');
    solicitudTemp = c;
    document.getElementById('alertPrice').textContent = 'L '+c.precio;
    document.getElementById('alertAddress').textContent = c.origen_direccion;
    document.getElementById('alertOverlay').classList.add('active');
    document.getElementById('sound').play().catch(()=>{});
    resetSlider();
}

function rechazar() {
    document.getElementById('alertOverlay').classList.remove('active');
    document.getElementById('sound').pause();
    cargarSolicitudes();
}

async function aceptar() {
    document.getElementById('sound').pause();
    try {
        const { data, error } = await window.supabaseClient.from('carreras').update({ conductor_id: conductorId, estado: 'aceptada' }).eq('id', solicitudTemp.id).is('conductor_id', null).select().single();
        if(error) throw new Error('Ya tomado');
        carreraEnCurso = data;
        await window.supabaseClient.from('conductores').update({ estado: 'en_carrera' }).eq('id', conductorId);
        conductorData.estado = 'en_carrera';
        updateStatusUI('en_carrera');
        document.getElementById('alertOverlay').classList.remove('active');
        mostrarPantallaViaje();
    } catch(e) { alert(e.message); rechazar(); }
}

function mostrarPantallaViaje() {
    document.getElementById('requestsList').style.display = 'none';
    document.getElementById('activeTripCard').classList.remove('hidden');
    const title = document.getElementById('tripTitle');
    const dest = document.getElementById('tripDest');
    const btn = document.querySelector('#activeTripCard button');
    
    if(carreraEnCurso.estado === 'aceptada' || carreraEnCurso.estado === 'en_camino') {
        title.textContent = 'Yendo a Recoger'; dest.textContent = carreraEnCurso.origen_direccion;
        btn.textContent = 'Llegué'; btn.onclick = () => avanzar('en_curso');
    } else {
        title.textContent = 'En Curso'; dest.textContent = carreraEnCurso.destino_direccion;
        btn.textContent = 'Finalizar'; btn.onclick = () => avanzar('completada');
    }
}

async function avanzar(est) {
    await window.supabaseClient.from('carreras').update({ estado: est }).eq('id', carreraEnCurso.id);
    if(est === 'completada') {
        alert('Ganaste L '+carreraEnCurso.precio);
        carreraEnCurso = null;
        await window.supabaseClient.from('conductores').update({ estado: 'disponible' }).eq('id', conductorId);
        conductorData.estado = 'disponible';
        updateStatusUI('disponible');
        document.getElementById('activeTripCard').classList.add('hidden');
        document.getElementById('requestsList').style.display = 'block';
        cargarSolicitudes(); cargarStats();
    } else {
        carreraEnCurso.estado = est; mostrarPantallaViaje();
    }
}

// UTILS
function suscribirse() { window.supabaseClient.channel('cond').on('postgres_changes', { event: '*', schema: 'public', table: 'carreras' }, cargarSolicitudes).subscribe(); }
async function cargarStats() { /* Lógica similar a antes */ }
async function cargarHistorial() { /* Lógica similar a antes */ }
function toggleEstado() {
    const n = conductorData.estado === 'disponible' ? 'inactivo' : 'disponible';
    window.supabaseClient.from('conductores').update({ estado: n }).eq('id', conductorId).then();
    conductorData.estado = n; updateStatusUI(n);
}
function updateStatusUI(s) {
    const d=document.getElementById('statusDot'), t=document.getElementById('statusText');
    d.className = 'dot '+(s==='disponible'?'online':'offline'); t.textContent = s==='disponible'?'En Línea':'Offline';
}
function inicializarSlider() {
    const s = document.getElementById('slider'), t = document.getElementById('sliderThumb');
    let drag=false, sx, w;
    t.addEventListener('touchstart', e => { drag=true; sx=e.touches[0].clientX; w=s.offsetWidth-50; });
    window.addEventListener('touchmove', e => { if(drag) t.style.transform = `translateX(${Math.min(w, Math.max(0, e.touches[0].clientX-sx))}px)`; });
    window.addEventListener('touchend', () => { drag=false; if(new WebKitCSSMatrix(t.style.transform).m41 > w*0.9) aceptar(); else t.style.transform='translateX(0)'; });
}
function resetSlider() { document.getElementById('sliderThumb').style.transform = 'translateX(0)'; }
async function cerrarSesion() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }

window.addEventListener('load', init);
