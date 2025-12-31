// CONDUCTOR JS (REPARADO Y FUNCIONAL)
let mapa, usuario, conductorId, conductorData, carreraEnCurso = null, solicitudTemp = null;
let miUbicacion = null, miMarker = null, rutaLayer = null, timer = null;

// DEFINICIÓN DE FUNCIONES GLOBALES (Para que el HTML las encuentre)
window.toggleDrawer = function() {
    document.getElementById('drawer').classList.toggle('open');
    document.querySelector('.drawer-overlay').classList.toggle('open');
    if(document.getElementById('drawer').classList.contains('open')) cargarHistorial();
};

window.rate = function(n) {
    window.rating = n;
    document.querySelectorAll('.star').forEach((s,i) => s.classList.toggle('active', i<n));
};

window.centrarMapa = function() {
    if(miUbicacion && mapa) mapa.setView([miUbicacion.lat, miUbicacion.lng], 16);
};

window.logout = async function() {
    await window.supabaseClient.auth.signOut();
    window.location.href = 'login.html';
};

// INICIALIZACIÓN
window.addEventListener('load', async () => {
    try {
        await esperarSupabase();
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return window.location.href = 'login.html';
        usuario = session.user;

        await cargarDatos();
        initMap();
        initSlider();
        suscribirse();
        await recuperarEstado();
        cargarStats();

        document.getElementById('loader').classList.add('hidden');
    } catch(e) { console.error(e); alert('Error inicio: '+e.message); }
});

// MAPA
function initMap() {
    mapa = L.map('map', { zoomControl: false }).setView([15.5, -88], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapa);
    
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(pos => {
            const { latitude: lat, longitude: lng, heading } = pos.coords;
            miUbicacion = { lat, lng };
            
            if (!miMarker) {
                miMarker = L.marker([lat, lng], {icon: L.divIcon({className:'nav-arrow', html:`<div style="transform:rotate(${heading||0}deg);font-size:24px;color:#00E676;text-shadow:0 0 10px #00E676">➤</div>`, iconSize:[30,30], iconAnchor:[15,15]})}).addTo(mapa);
                mapa.setView([lat, lng], 16);
            } else {
                miMarker.setLatLng([lat, lng]);
                miMarker.setIcon(L.divIcon({className:'nav-arrow', html:`<div style="transform:rotate(${heading||0}deg);font-size:24px;color:#00E676;text-shadow:0 0 10px #00E676">➤</div>`, iconSize:[30,30], iconAnchor:[15,15]}));
            }
            
            // Actualizar DB
            if (conductorData?.estado !== 'inactivo') {
                window.supabaseClient.from('conductores').update({ latitud: lat, longitud: lng, rumbo: heading }).eq('id', conductorId).then();
            }
        }, null, {enableHighAccuracy:true});
    }
}

// LOGICA
async function esperarSupabase() { return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); }); }

async function cargarDatos() {
    const { data } = await window.supabaseClient.from('conductores').select('*, perfiles(nombre)').eq('perfil_id', usuario.id).single();
    conductorId = data.id; conductorData = data;
    document.getElementById('driverName').textContent = data.perfiles.nombre;
    renderStatus(data.estado);
}

async function recuperarEstado() {
    const { data } = await window.supabaseClient.from('carreras').select('*, clientes(nombre, telefono)').eq('conductor_id', conductorId).in('estado', ['aceptada','en_camino','en_curso']).maybeSingle();
    if (data) { carreraEnCurso = data; mostrarViaje(); }
    else cargarSolicitudes();
}

async function cargarSolicitudes() {
    if(carreraEnCurso) return;
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('estado','buscando').is('conductor_id',null).order('fecha_solicitud',{ascending:false});
    const list = document.getElementById('reqList');
    document.getElementById('reqCount').textContent = data?.length || 0;
    
    if(!data || !data.length) list.innerHTML = '<p style="text-align:center;color:#555;font-size:12px">Esperando...</p>';
    else list.innerHTML = data.map(c => `<div style="background:#2C2C2C;padding:10px;border-radius:12px;margin-bottom:8px;border:1px solid #444;cursor:pointer" onclick='alerta(${JSON.stringify(c)})'><div style="display:flex;justify-content:space-between;color:white;font-size:14px;margin-bottom:4px"><strong>${c.tipo.toUpperCase()}</strong><span style="color:#00E676;font-weight:800">L ${c.precio}</span></div><div style="font-size:11px;color:#aaa">${c.origen_direccion}</div></div>`).join('');
}

// ALERTA
window.alerta = async function(c) {
    if(conductorData.estado === 'inactivo') return alert('Debes estar En Línea');
    solicitudTemp = c;
    
    document.getElementById('alertPrice').textContent = 'L ' + c.precio;
    document.getElementById('alertAddr').textContent = c.origen_direccion;
    document.getElementById('statsSheet').classList.add('hidden');
    document.getElementById('alertOverlay').classList.add('active');
    document.getElementById('gpsBtn').style.bottom = '300px';
    document.getElementById('sound').play().catch(()=>{});
    
    document.getElementById('sliderThumb').style.transform = 'translateX(0)';
    
    // OSRM
    document.getElementById('pickupDist').textContent = '...';
    if(miUbicacion) {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${miUbicacion.lng},${miUbicacion.lat};${c.origen_lng},${c.origen_lat}?overview=false`);
        const d = await res.json();
        const min = d.routes?.[0] ? Math.ceil(d.routes[0].duration/60) : '--';
        document.getElementById('pickupDist').textContent = min + ' min';
        document.getElementById('totalDist').textContent = (c.distancia_km + (d.routes?.[0]?.distance/1000||0)).toFixed(1) + ' km';
        dibujarRuta({lat:c.origen_lat, lng:c.origen_lng}, true); // Preview
    }
    
    let t=30; 
    if(timer) clearInterval(timer);
    timer = setInterval(()=>{ t--; document.getElementById('reqTimer').textContent=t+'s'; if(t<=0) rechazar(); }, 1000);
};

window.rechazar = function() {
    document.getElementById('alertOverlay').classList.remove('active');
    document.getElementById('statsSheet').classList.remove('hidden');
    document.getElementById('gpsBtn').style.bottom = '320px';
    document.getElementById('sound').pause();
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    clearInterval(timer); solicitudTemp = null; centrarMapa(); cargarSolicitudes();
};

window.aceptar = async function() {
    document.getElementById('sound').pause(); clearInterval(timer);
    const { data, error } = await window.supabaseClient.from('carreras').update({ conductor_id: conductorId, estado: 'aceptada' }).eq('id', solicitudTemp.id).is('conductor_id', null).select('*, clientes(nombre, telefono)').single();
    if(error) { alert('Ganado por otro'); rechazar(); return; }
    
    carreraEnCurso = data;
    await window.supabaseClient.from('conductores').update({ estado: 'en_carrera' }).eq('id', conductorId);
    conductorData.estado = 'en_carrera';
    document.getElementById('alertOverlay').classList.remove('active');
    mostrarViaje();
};

function mostrarViaje() {
    document.getElementById('statsSheet').classList.add('hidden');
    document.getElementById('tripCard').style.display = 'block';
    
    const t = document.getElementById('tripTitle');
    const dest = document.getElementById('tripDest');
    const btn = document.getElementById('tripBtn');
    
    document.getElementById('tripClient').textContent = carreraEnCurso.clientes?.nombre || 'Pasajero';
    
    if (carreraEnCurso.estado === 'aceptada' || carreraEnCurso.estado === 'en_camino') {
        t.textContent = 'Recogiendo'; dest.textContent = carreraEnCurso.origen_direccion;
        btn.textContent = 'Llegué'; btn.className = 'btn-main btn-blue'; btn.onclick = () => avanzar('en_curso');
        dibujarRuta({lat:carreraEnCurso.origen_lat, lng:carreraEnCurso.origen_lng});
    } else {
        t.textContent = 'En Ruta'; dest.textContent = carreraEnCurso.destino_direccion;
        btn.textContent = 'Finalizar'; btn.className = 'btn-main btn-green'; btn.onclick = () => avanzar('completada');
        dibujarRuta({lat:carreraEnCurso.destino_lat, lng:carreraEnCurso.destino_lng});
    }
}

async function avanzar(est) {
    if(est==='completada') {
        document.getElementById('rateModal').style.display='flex';
    } else {
        await window.supabaseClient.from('carreras').update({ estado: est }).eq('id', carreraEnCurso.id);
        carreraEnCurso.estado = est; mostrarViaje();
    }
}

window.sendRate = async function() {
    await window.supabaseClient.from('carreras').update({ estado: 'completada', fecha_completado: new Date(), calificacion_cliente: window.rating||5 }).eq('id', carreraEnCurso.id);
    document.getElementById('rateModal').style.display='none';
    reset();
};

async function reset() {
    carreraEnCurso=null; solicitudTemp=null;
    await window.supabaseClient.from('conductores').update({ estado: 'disponible' }).eq('id', conductorId);
    conductorData.estado='disponible'; renderStatus('disponible');
    document.getElementById('tripCard').style.display='none';
    document.getElementById('statsSheet').classList.remove('hidden');
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    cargarStats(); cargarSolicitudes(); centrarMapa();
}

window.cancelar = async function() {
    if(confirm('Cancelar?')) {
        await window.supabaseClient.from('carreras').update({estado:'cancelada_conductor'}).eq('id',carreraEnCurso.id);
        reset();
    }
};

window.tripAction = function() { document.getElementById('tripBtn').click(); };
window.navApp = function() { window.open(`https://waze.com/ul?ll=${carreraEnCurso.estado==='en_curso'?carreraEnCurso.destino_lat:carreraEnCurso.origen_lat},${carreraEnCurso.estado==='en_curso'?carreraEnCurso.destino_lng:carreraEnCurso.origen_lng}&navigate=yes`); };
window.callClient = function() { window.open(`tel:${carreraEnCurso.clientes?.telefono}`); };

// UTILS
function initSlider() {
    const t = document.getElementById('sliderThumb'), s = document.getElementById('slider');
    let d=false, sx, w;
    t.addEventListener('touchstart', e=>{d=true; sx=e.touches[0].clientX; w=s.offsetWidth-50;});
    window.addEventListener('touchmove', e=>{if(d) t.style.transform=`translateX(${Math.min(w,Math.max(0, e.touches[0].clientX-sx))}px)`;});
    window.addEventListener('touchend', ()=>{d=false; if(new WebKitCSSMatrix(t.style.transform).m41>w*0.9) aceptar(); else t.style.transform='translateX(0)';});
}

function suscribirse() {
    window.supabaseClient.channel('cond').on('postgres_changes', { event: '*', schema: 'public', table: 'carreras' }, p => {
        if((p.eventType==='INSERT' || p.eventType==='UPDATE') && p.new.estado==='buscando' && !p.new.conductor_id && !carreraEnCurso && !solicitudTemp) alerta(p.new);
        else if(p.eventType==='UPDATE' && solicitudTemp && p.new.id===solicitudTemp.id && p.new.conductor_id) rechazar();
    }).subscribe();
}

async function dibujarRuta(dest, preview=false) {
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${miUbicacion.lng},${miUbicacion.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`);
    const d = await res.json();
    if(d.routes?.[0]) {
        rutaLayer = L.geoJSON(d.routes[0].geometry, {style:{color: preview?'#2979FF':'#00E676', weight:6}}).addTo(mapa);
        mapa.fitBounds(rutaLayer.getBounds(), {paddingTopLeft:[20,20], paddingBottomRight:[20, preview?350:200]});
    }
}

async function cargarStats() { /* igual que antes */ }
window.cargarHistorial = async function() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('conductor_id', conductorId).eq('estado','completada').order('fecha_completado',{ascending:false}).limit(20);
    document.getElementById('historyList').innerHTML = data.map(c=>`<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #333"><div>${new Date(c.fecha_completado).toLocaleDateString()}</div><div style="color:#00E676;font-weight:bold">L ${c.precio}</div></div>`).join('');
};

function renderStatus(s) { document.getElementById('statusDot').className = 'dot '+(s==='disponible'?'online':'offline'); document.getElementById('statusTxt').textContent = s==='disponible'?'En Línea':'Offline'; }
window.toggleStatus = function() { 
    const n = conductorData.estado==='disponible'?'inactivo':'disponible'; 
    window.supabaseClient.from('conductores').update({estado:n}).eq('id',conductorId).then(); 
    conductorData.estado=n; renderStatus(n); 
};
