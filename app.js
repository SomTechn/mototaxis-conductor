// CONDUCTOR JS (FINAL)
let mapa, usuario, conductorId, conductorData, carrera=null, temp=null, ubi, marker, ruta, timer;

async function init() {
    try {
        await new Promise(r=>setTimeout(r,500));
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return window.location.href = 'login.html';
        usuario = session.user;

        await loadData();
        initMap();
        initSlider();
        sub();
        await checkTrip();
        document.getElementById('loader').style.display='none';
    } catch(e) { alert(e.message); }
}

async function loadData() {
    const { data } = await window.supabaseClient.from('conductores').select('*').eq('perfil_id', usuario.id).single();
    conductorId = data.id; conductorData = data;
    setStatus(data.estado);
}

function initMap() {
    mapa = L.map('map', { zoomControl: false }).setView([15.5, -88], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapa); // OSCURO
    
    if(navigator.geolocation) navigator.geolocation.watchPosition(pos => {
        const { latitude: lat, longitude: lng, heading } = pos.coords;
        ubi = { lat, lng };
        if(!marker) {
            marker = L.marker([lat, lng], {icon: L.divIcon({html:`<div style="transform:rotate(${heading||0}deg);font-size:24px;color:#00E676">➤</div>`, className:'arrow'})}).addTo(mapa);
            mapa.setView([lat, lng], 16);
        } else {
            marker.setLatLng([lat, lng]);
        }
        if(conductorData.estado !== 'inactivo') window.supabaseClient.from('conductores').update({latitud:lat, longitud:lng}).eq('id',conductorId).then();
    }, null, {enableHighAccuracy:true});
}

// LOGICA
async function checkTrip() {
    const { data } = await window.supabaseClient.from('carreras').select('*, clientes(telefono)').eq('conductor_id', conductorId).in('estado',['aceptada','en_camino','en_curso']).maybeSingle();
    if(data) { carrera = data; showTrip(); } else loadReq();
}

async function loadReq() {
    if(carrera) return;
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('estado','buscando').is('conductor_id',null);
    const list = document.getElementById('reqList');
    if(!data.length) list.innerHTML = '<p style="text-align:center;color:#555">Esperando...</p>';
    else list.innerHTML = data.map(c => `<div style="background:#2a2a2a;padding:10px;margin-bottom:5px;border-radius:10px;display:flex;justify-content:space-between" onclick='alertReq(${JSON.stringify(c)})'><div>${c.tipo}</div><div style="color:#00E676">L ${c.precio}</div></div>`).join('');
}

window.alertReq = async function(c) {
    if(conductorData.estado==='inactivo') return alert('Ponte en línea');
    temp = c;
    document.getElementById('alertPrice').textContent = 'L '+c.precio;
    document.getElementById('alertAddr').textContent = c.origen_direccion;
    document.getElementById('statsSheet').classList.add('hidden');
    document.getElementById('alertOverlay').classList.add('active');
    document.getElementById('sound').play().catch(()=>{});
    document.getElementById('sliderThumb').style.transform = 'translateX(0)';
    
    // OSRM
    if(ubi) {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${ubi.lng},${ubi.lat};${c.origen_lng},${c.origen_lat}?overview=false`);
        const d = await res.json();
        document.getElementById('pickupDist').textContent = Math.ceil(d.routes[0].duration/60) + ' min';
        document.getElementById('totalDist').textContent = c.distancia_km + ' km';
        drawRoute({lat:c.origen_lat, lng:c.origen_lng}, true);
    }
    
    let t=30; if(timer) clearInterval(timer);
    timer = setInterval(()=>{ t--; document.getElementById('timer').textContent=t+'s'; if(t<=0) rechazar(); }, 1000);
}

window.rechazar = function() {
    document.getElementById('alertOverlay').classList.remove('active');
    document.getElementById('statsSheet').classList.remove('hidden');
    document.getElementById('sound').pause();
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    temp=null; loadReq();
}

async function aceptar() {
    document.getElementById('sound').pause(); clearInterval(timer);
    const { data, error } = await window.supabaseClient.from('carreras').update({conductor_id:conductorId, estado:'aceptada'}).eq('id', temp.id).is('conductor_id',null).select('*, clientes(telefono)').single();
    if(error) { alert('Ganado por otro'); rechazar(); return; }
    
    carrera = data;
    await window.supabaseClient.from('conductores').update({estado:'en_carrera'}).eq('id',conductorId);
    conductorData.estado = 'en_carrera';
    document.getElementById('alertOverlay').classList.remove('active');
    showTrip();
}

function showTrip() {
    document.getElementById('statsSheet').classList.add('hidden');
    document.getElementById('activeTrip').style.display = 'block';
    
    const t = document.getElementById('tripTitle');
    const d = document.getElementById('tripDest');
    const b = document.getElementById('tripBtn');
    
    if(carrera.estado === 'en_curso') {
        t.textContent = 'En Ruta'; d.textContent = carrera.destino_direccion;
        b.textContent = 'Finalizar'; b.className = 'btn-action btn-green'; b.onclick = endTrip;
        drawRoute({lat:carrera.destino_lat, lng:carrera.destino_lng});
    } else {
        t.textContent = 'Recogiendo'; d.textContent = carrera.origen_direccion;
        b.textContent = 'Llegué'; b.className = 'btn-action btn-blue'; b.onclick = startTrip;
        drawRoute({lat:carrera.origen_lat, lng:carrera.origen_lng});
    }
}

async function startTrip() {
    const { data } = await window.supabaseClient.from('carreras').update({estado:'en_curso'}).eq('id',carrera.id).select('*, clientes(telefono)').single();
    carrera = data; showTrip();
}

async function endTrip() {
    if(!confirm('Cobrar L '+carrera.precio)) return;
    await window.supabaseClient.from('carreras').update({estado:'completada'}).eq('id',carrera.id);
    reset();
}

async function reset() {
    carrera=null; temp=null;
    await window.supabaseClient.from('conductores').update({estado:'disponible'}).eq('id',conductorId);
    conductorData.estado='disponible'; setStatus('disponible');
    document.getElementById('activeTrip').style.display='none';
    document.getElementById('statsSheet').classList.remove('hidden');
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    loadReq();
}

// UTILS
window.toggleStatus = function() {
    const n = conductorData.estado==='disponible'?'inactivo':'disponible';
    window.supabaseClient.from('conductores').update({estado:n}).eq('id',conductorId).then();
    conductorData.estado=n; setStatus(n);
}
function setStatus(s) { document.getElementById('dot').className = 'dot '+(s==='disponible'?'online':'offline'); document.getElementById('statusTxt').textContent = s==='disponible'?'En Línea':'Offline'; }
function sub() { window.supabaseClient.channel('cond').on('postgres_changes', {event:'*', schema:'public', table:'carreras'}, p=>{ if(p.new.estado==='buscando' && !carrera) alertReq(p.new); }).subscribe(); }
async function drawRoute(d, preview=false) {
    if(rutaLayer) mapa.removeLayer(rutaLayer);
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${ubi.lng},${ubi.lat};${d.lng},${d.lat}?overview=full&geometries=geojson`);
    const j = await res.json();
    if(j.routes?.[0]) {
        rutaLayer = L.geoJSON(j.routes[0].geometry, {style:{color:preview?'#2979FF':'#00E676', weight:6}}).addTo(mapa);
        mapa.fitBounds(rutaLayer.getBounds(), {paddingTopLeft:[20,20], paddingBottomRight:[20, preview?350:200]});
    }
}
function initSlider() {
    const t = document.getElementById('sliderThumb'), s = document.getElementById('slider');
    let d=false, sx, w;
    t.addEventListener('touchstart', e=>{d=true; sx=e.touches[0].clientX; w=s.offsetWidth-50;});
    window.addEventListener('touchmove', e=>{if(d) t.style.transform=`translateX(${Math.min(w,Math.max(0, e.touches[0].clientX-sx))}px)`;});
    window.addEventListener('touchend', ()=>{d=false; if(new WebKitCSSMatrix(t.style.transform).m41>w*0.9) aceptar(); else t.style.transform='translateX(0)';});
}
window.navApp = function() { window.open(`https://waze.com/ul?ll=${carrera.estado==='en_curso'?carrera.destino_lat:carrera.origen_lat},${carrera.estado==='en_curso'?carrera.destino_lng:carrera.origen_lng}&navigate=yes`); };
window.call = function() { window.open(`tel:${carrera.clientes?.telefono}`); };
window.cancel = async function() { if(confirm('Cancelar?')) { await window.supabaseClient.from('carreras').update({estado:'cancelada_conductor'}).eq('id',carrera.id); reset(); } };

window.addEventListener('load', init);
