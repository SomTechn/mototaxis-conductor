let mapa, usuario, conductorId, conductorData, carrera=null, temp=null, ubi, marker, ruta, timer;

window.addEventListener('load', async () => {
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
        cargarStats();
        
        document.getElementById('loader').style.display='none';
    } catch(e) { alert(e.message); }
});

async function loadData() {
    const { data } = await window.supabaseClient.from('conductores').select('*, perfiles(nombre)').eq('perfil_id', usuario.id).single();
    conductorId = data.id; conductorData = data;
    document.getElementById('driverName').textContent = data.perfiles.nombre;
    renderStatus(data.estado);
}

function initMap() {
    mapa = L.map('map', { zoomControl: false }).setView([15.5, -88], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapa);
    if(navigator.geolocation) navigator.geolocation.watchPosition(pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        ubi = { lat, lng };
        if(!marker) {
            marker = L.marker([lat, lng], {icon: L.divIcon({html:`<div style="font-size:24px;color:#00E676">➤</div>`, className:'arrow'})}).addTo(mapa);
            mapa.setView([lat, lng], 16);
        } else marker.setLatLng([lat, lng]);
        
        if(conductorData && conductorData.estado !== 'inactivo') 
            window.supabaseClient.from('conductores').update({ latitud: lat, longitud: lng }).eq('id', conductorId).then();
    }, null, {enableHighAccuracy:true});
}

// LOGICA
async function checkTrip() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('conductor_id', conductorId).in('estado',['aceptada','en_camino','en_curso']).maybeSingle();
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
    
    // Ruta Preview
    if(ubi && ruta) mapa.removeLayer(ruta);
    if(ubi) {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${ubi.lng},${ubi.lat};${c.origen_lng},${c.origen_lat}?overview=full&geometries=geojson`);
        const d = await res.json();
        if(d.routes?.[0]) {
            ruta = L.geoJSON(d.routes[0].geometry, {style:{color:'#00E676',weight:5}}).addTo(mapa);
            mapa.fitBounds(ruta.getBounds(), {padding:[50,200]});
        }
    }
}

window.rechazar = function() {
    document.getElementById('alertOverlay').classList.remove('active');
    document.getElementById('statsSheet').classList.remove('hidden');
    document.getElementById('sound').pause();
    if(ruta) mapa.removeLayer(ruta);
    temp=null; loadReq();
}

async function aceptar() {
    document.getElementById('sound').pause();
    const { data, error } = await window.supabaseClient.from('carreras').update({conductor_id:conductorId, estado:'aceptada'}).eq('id', temp.id).is('conductor_id',null).select().single();
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
        b.textContent = 'Finalizar'; b.className = 'btn-main btn-green'; b.onclick = endTrip;
    } else {
        t.textContent = 'Recogiendo'; d.textContent = carrera.origen_direccion;
        b.textContent = 'Llegué'; b.className = 'btn-main btn-blue'; b.onclick = startTrip;
    }
}

async function startTrip() {
    const { data } = await window.supabaseClient.from('carreras').update({estado:'en_curso'}).eq('id',carrera.id).select().single();
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
    conductorData.estado='disponible'; renderStatus('disponible');
    document.getElementById('activeTrip').style.display='none';
    document.getElementById('statsSheet').classList.remove('hidden');
    if(ruta) mapa.removeLayer(ruta);
    loadReq(); cargarStats();
}

// GLOBALES
window.toggleStatus = function() {
    const n = conductorData.estado==='disponible'?'inactivo':'disponible';
    window.supabaseClient.from('conductores').update({estado:n}).eq('id',conductorId).then();
    conductorData.estado=n; renderStatus(n);
}
window.toggleDrawer = function() { 
    document.getElementById('drawer').classList.toggle('open');
    document.querySelector('.drawer-overlay').classList.toggle('open');
    if(document.getElementById('drawer').classList.contains('open')) cargarHistorial();
}
window.tripAction = function() { document.getElementById('tripBtn').click(); }
window.cancel = async function() { if(confirm('Cancelar?')) { await window.supabaseClient.from('carreras').update({estado:'cancelada_conductor'}).eq('id',carrera.id); reset(); } }
window.logout = async function() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }

function renderStatus(s) { document.getElementById('statusDot').className = 'dot '+(s==='disponible'?'online':'offline'); document.getElementById('statusTxt').textContent = s==='disponible'?'En Línea':'Offline'; }
function sub() { window.supabaseClient.channel('cond').on('postgres_changes', {event:'*', schema:'public', table:'carreras'}, p=>{ if(p.new.estado==='buscando' && !carrera) alertReq(p.new); }).subscribe(); }
async function cargarStats() {
    const h = new Date().toISOString().split('T')[0];
    const { data } = await window.supabaseClient.from('carreras').select('precio').eq('conductor_id', conductorId).eq('estado','completada').gte('fecha_completado', h);
    document.getElementById('earn').textContent = 'L ' + (data?.reduce((a,b)=>a+b.precio,0)||0);
}
async function cargarHistorial() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('conductor_id', conductorId).eq('estado','completada').limit(20);
    document.getElementById('historyList').innerHTML = data.map(c=>`<div style="padding:10px;border-bottom:1px solid #333;display:flex;justify-content:space-between"><div>${new Date(c.fecha_completado).toLocaleDateString()}</div><div style="color:#00E676">L ${c.precio}</div></div>`).join('');
}
function initSlider() {
    const s = document.getElementById('slider'), t = document.getElementById('sliderThumb');
    let d=false, sx, w;
    t.addEventListener('touchstart', e=>{d=true; sx=e.touches[0].clientX; w=s.offsetWidth-50;});
    window.addEventListener('touchmove', e=>{if(d) t.style.transform=`translateX(${Math.min(w,Math.max(0, e.touches[0].clientX-sx))}px)`;});
    window.addEventListener('touchend', ()=>{d=false; if(new WebKitCSSMatrix(t.style.transform).m41>w*0.9) aceptar(); else t.style.transform='translateX(0)';});
}
