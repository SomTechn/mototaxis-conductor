// APP CLIENTE - MOTOTAXIS
let mapa, carreraActiva = null, conductorMarker = null;
let origenMarker = null, destinoMarker = null;
let modoSeleccion = null;

// Verificar autenticación
async function verificarAuth() {
    const autenticado = await AUTH.inicializar();
    if (!autenticado) {
        window.location.href = 'login.html';
        return false;
    }
    if (!AUTH.esCliente()) {
        UTILS.mostrarNotificacion('Error', 'No tienes permisos', 'danger');
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

// Inicializar
async function init() {
    const autenticado = await verificarAuth();
    if (!autenticado) return;
    
    document.getElementById('welcomeMsg').textContent = `Hola, ${AUTH.perfil.nombre}`;
    
    inicializarMapa();
    cargarCarreraActiva();
    cargarHistorial();
    inicializarEventos();
    suscribirseAActualizaciones();
    
    document.getElementById('loader').classList.add('hidden');
}

// Mapa
function inicializarMapa() {
    mapa = L.map('map').setView(MAP_CONFIG.defaultCenter, MAP_CONFIG.defaultZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa);
    
    mapa.on('click', (e) => {
        if (modoSeleccion) {
            seleccionarUbicacion(e.latlng);
        }
    });
}

// Eventos
function inicializarEventos() {
    document.getElementById('btnCarreraDirecta').onclick = () => abrirModalCarrera('directo');
    document.getElementById('btnCarreraColectiva').onclick = () => abrirModalCarrera('colectivo');
    document.getElementById('btnCerrarSesion').onclick = () => AUTH.cerrarSesion();
    
    document.getElementById('formNuevaCarrera').onsubmit = (e) => {
        e.preventDefault();
        solicitarCarrera();
    };
    
    document.getElementById('btnSelOrigen').onclick = () => {
        modoSeleccion = 'origen';
        document.body.style.cursor = 'crosshair';
        UTILS.mostrarNotificacion('Mapa', 'Click en tu ubicación', 'info');
    };
    
    document.getElementById('btnSelDestino').onclick = () => {
        modoSeleccion = 'destino';
        document.body.style.cursor = 'crosshair';
        UTILS.mostrarNotificacion('Mapa', 'Click en tu destino', 'info');
    };
    
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        };
    });
}

// Modal
function abrirModalCarrera(tipo) {
    document.getElementById('tipoCarrera').value = tipo;
    document.getElementById('modalTitulo').textContent = 
        tipo === 'directo' ? 'Nueva Carrera Directa' : 'Nueva Carrera Colectiva (30% OFF)';
    document.getElementById('modalNuevaCarrera').classList.add('active');
    document.getElementById('descuentoMsg').classList.toggle('hidden', tipo !== 'colectivo');
}

function cerrarModal() {
    document.getElementById('modalNuevaCarrera').classList.remove('active');
    document.getElementById('formNuevaCarrera').reset();
    limpiarMarcadores();
}

// Seleccionar ubicación
async function seleccionarUbicacion(latlng) {
    const direccion = await obtenerDireccion(latlng.lat, latlng.lng);
    
    if (modoSeleccion === 'origen') {
        document.getElementById('origenDir').value = direccion;
        document.getElementById('origenDir').dataset.lat = latlng.lat;
        document.getElementById('origenDir').dataset.lng = latlng.lng;
        
        if (origenMarker) mapa.removeLayer(origenMarker);
        origenMarker = L.marker(latlng, {
            icon: L.divIcon({ html: '📍', className: 'emoji-marker' })
        }).addTo(mapa);
    } else {
        document.getElementById('destinoDir').value = direccion;
        document.getElementById('destinoDir').dataset.lat = latlng.lat;
        document.getElementById('destinoDir').dataset.lng = latlng.lng;
        
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        destinoMarker = L.marker(latlng, {
            icon: L.divIcon({ html: '🏁', className: 'emoji-marker' })
        }).addTo(mapa);
    }
    
    modoSeleccion = null;
    document.body.style.cursor = 'default';
    
    // Calcular ruta si ambos están seleccionados
    const origenLat = document.getElementById('origenDir').dataset.lat;
    const destinoLat = document.getElementById('destinoDir').dataset.lat;
    if (origenLat && destinoLat) {
        calcularRuta();
    }
}

async function obtenerDireccion(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
        const res = await fetch(url);
        const data = await res.json();
        return data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    } catch {
        return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
}

async function calcularRuta() {
    const origenLat = parseFloat(document.getElementById('origenDir').dataset.lat);
    const origenLng = parseFloat(document.getElementById('origenDir').dataset.lng);
    const destinoLat = parseFloat(document.getElementById('destinoDir').dataset.lat);
    const destinoLng = parseFloat(document.getElementById('destinoDir').dataset.lng);
    
    const distancia = UTILS.calcularDistancia(origenLat, origenLng, destinoLat, destinoLng);
    const tiempo = (distancia / 30) * 60; // 30 km/h promedio
    const tipo = document.getElementById('tipoCarrera').value;
    const precio = PRICING_CONFIG.calcularPrecio(distancia, tipo === 'colectivo');
    
    document.getElementById('resDistancia').textContent = UTILS.formatearDistancia(distancia);
    document.getElementById('resTiempo').textContent = UTILS.formatearTiempo(tiempo);
    document.getElementById('resPrecio').textContent = UTILS.formatearPrecio(precio);
    document.getElementById('resumenCarrera').classList.remove('hidden');
}

// Solicitar carrera
async function solicitarCarrera() {
    try {
        const tipo = document.getElementById('tipoCarrera').value;
        const origenDir = document.getElementById('origenDir').value;
        const origenLat = parseFloat(document.getElementById('origenDir').dataset.lat);
        const origenLng = parseFloat(document.getElementById('origenDir').dataset.lng);
        const destinoDir = document.getElementById('destinoDir').value;
        const destinoLat = parseFloat(document.getElementById('destinoDir').dataset.lat);
        const destinoLng = parseFloat(document.getElementById('destinoDir').dataset.lng);
        const notas = document.getElementById('notasCarrera').value;
        
        if (!origenLat || !destinoLat) {
            UTILS.mostrarNotificacion('Error', 'Selecciona origen y destino', 'danger');
            return;
        }
        
        // Obtener cliente_id
        const { data: cliente } = await window.supabase
            .from('clientes')
            .select('id')
            .eq('perfil_id', AUTH.usuario.id)
            .single();
        
        const distancia = UTILS.calcularDistancia(origenLat, origenLng, destinoLat, destinoLng);
        const tiempo = Math.round((distancia / 30) * 60);
        const precio = PRICING_CONFIG.calcularPrecio(distancia, tipo === 'colectivo');
        
        const { data, error } = await window.supabase
            .from('carreras')
            .insert({
                tipo,
                cliente_id: cliente.id,
                origen_direccion: origenDir,
                origen_lat: origenLat,
                origen_lng: origenLng,
                destino_direccion: destinoDir,
                destino_lat: destinoLat,
                destino_lng: destinoLng,
                distancia_km: distancia,
                tiempo_estimado_min: tiempo,
                precio,
                estado: 'solicitada',
                notas
            })
            .select()
            .single();
        
        if (error) throw error;
        
        UTILS.mostrarNotificacion('¡Éxito!', 'Carrera solicitada. Buscando conductor...', 'success');
        cerrarModal();
        cargarCarreraActiva();
        
    } catch (error) {
        console.error(error);
        UTILS.mostrarNotificacion('Error', error.message, 'danger');
    }
}

// Cargar carrera activa
async function cargarCarreraActiva() {
    try {
        const { data: cliente } = await window.supabase
            .from('clientes')
            .select('id')
            .eq('perfil_id', AUTH.usuario.id)
            .single();
        
        const { data, error } = await window.supabase
            .from('vista_carreras_completa')
            .select('*')
            .eq('cliente_id', cliente.id)
            .in('estado', ['solicitada', 'buscando', 'asignada', 'aceptada', 'en_camino', 'en_curso'])
            .order('fecha_solicitud', { ascending: false })
            .limit(1)
            .single();
        
        if (error || !data) {
            document.getElementById('carreraActiva').innerHTML = '<p class="text-center">No tienes carreras activas</p>';
            return;
        }
        
        carreraActiva = data;
        mostrarCarreraActiva(data);
        
        if (data.conductor_lat && data.conductor_lng) {
            actualizarConductorEnMapa(data.conductor_lat, data.conductor_lng);
        }
        
    } catch (error) {
        console.error(error);
    }
}

function mostrarCarreraActiva(carrera) {
    const html = `
        <div class="card">
            <h3>${carrera.numero_carrera}</h3>
            <span class="badge badge-${carrera.estado}">${UTILS.traducirEstadoCarrera(carrera.estado)}</span>
            <p><strong>Tipo:</strong> ${carrera.tipo === 'directo' ? 'Directa' : 'Colectiva'}</p>
            <p><strong>Origen:</strong> ${carrera.origen_direccion}</p>
            <p><strong>Destino:</strong> ${carrera.destino_direccion}</p>
            <p><strong>Precio:</strong> ${UTILS.formatearPrecio(carrera.precio)}</p>
            ${carrera.nombre_conductor ? `
                <div class="mt-2">
                    <p><strong>Conductor:</strong> ${carrera.nombre_conductor}</p>
                    <p><strong>Placa:</strong> ${carrera.placa_conductor}</p>
                    <p><strong>Teléfono:</strong> ${carrera.telefono_conductor}</p>
                </div>
            ` : '<p class="text-center">Buscando conductor...</p>'}
            <button class="btn btn-danger btn-sm mt-2" onclick="cancelarCarrera('${carrera.id}')">Cancelar</button>
        </div>
    `;
    document.getElementById('carreraActiva').innerHTML = html;
}

function actualizarConductorEnMapa(lat, lng) {
    if (conductorMarker) {
        conductorMarker.setLatLng([lat, lng]);
    } else {
        conductorMarker = L.marker([lat, lng], {
            icon: L.divIcon({ html: '🏍️', className: 'emoji-marker' })
        }).addTo(mapa);
    }
}

async function cancelarCarrera(id) {
    if (!confirm('¿Cancelar esta carrera?')) return;
    
    try {
        const { error } = await window.supabase
            .from('carreras')
            .update({ estado: 'cancelada_cliente' })
            .eq('id', id);
        
        if (error) throw error;
        
        UTILS.mostrarNotificacion('Carrera cancelada', '', 'info');
        cargarCarreraActiva();
        
    } catch (error) {
        console.error(error);
        UTILS.mostrarNotificacion('Error', error.message, 'danger');
    }
}

// Historial
async function cargarHistorial() {
    try {
        const { data: cliente } = await window.supabase
            .from('clientes')
            .select('id')
            .eq('perfil_id', AUTH.usuario.id)
            .single();
        
        const { data, error } = await window.supabase
            .from('vista_carreras_completa')
            .select('*')
            .eq('cliente_id', cliente.id)
            .in('estado', ['completada', 'cancelada_cliente', 'cancelada_conductor'])
            .order('fecha_solicitud', { ascending: false })
            .limit(10);
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            document.getElementById('historialCarreras').innerHTML = '<p class="text-center">No hay historial</p>';
            return;
        }
        
        const html = data.map(c => `
            <div class="card mb-1">
                <div style="display:flex; justify-content:space-between">
                    <strong>${c.numero_carrera}</strong>
                    <span class="badge badge-${c.estado}">${UTILS.traducirEstadoCarrera(c.estado)}</span>
                </div>
                <p>${UTILS.formatearFecha(c.fecha_solicitud)}</p>
                <p>${c.origen_direccion} → ${c.destino_direccion}</p>
                <p><strong>${UTILS.formatearPrecio(c.precio)}</strong></p>
            </div>
        `).join('');
        
        document.getElementById('historialCarreras').innerHTML = html;
        
    } catch (error) {
        console.error(error);
    }
}

// Suscribirse a cambios
function suscribirseAActualizaciones() {
    REALTIME.suscribirseACambios('carreras', (payload) => {
        if (payload.new && carreraActiva && payload.new.id === carreraActiva.id) {
            cargarCarreraActiva();
        }
    });
    
    REALTIME.suscribirseACambios('ubicaciones_tiempo_real', (payload) => {
        if (carreraActiva && payload.new.carrera_id === carreraActiva.id) {
            actualizarConductorEnMapa(payload.new.latitud, payload.new.longitud);
        }
    });
}

function limpiarMarcadores() {
    if (origenMarker) mapa.removeLayer(origenMarker);
    if (destinoMarker) mapa.removeLayer(destinoMarker);
    origenMarker = null;
    destinoMarker = null;
}

// Iniciar
window.addEventListener('load', init);
