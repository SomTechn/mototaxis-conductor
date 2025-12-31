// ============================================
// VARIABLES GLOBALES
// ============================================

let mapa, usuario, conductorId, conductorData;
let miUbicacion = null;
let miMarker = null;
let gpsInterval = null;
let timers = {};
let rutaActualLayer = null;
let origenMarker = null, destinoMarker = null;

// ============================================
// INICIALIZACIÓN
// ============================================

async function init() {
    console.log('=== INICIANDO APP CONDUCTOR ===');
    
    // Esperar Supabase
    let intentos = 0;
    while (!window.supabase?.auth && intentos < 50) {
        await new Promise(r => setTimeout(r, 100));
        intentos++;
    }
    
    if (!window.supabase?.auth) {
        alert('Error conectando a Supabase');
        document.getElementById('loader').classList.add('hidden');
        return;
    }
    
    try {
        // Verificar sesión
        const { data: { session } } = await window.supabase.auth.getSession();
        if (!session) {
            window.location.href = 'login.html';
            return;
        }
        
        usuario = session.user;
        console.log('✅ Sesión activa:', usuario.email);
        
        // Cargar perfil
        const { data: perfil } = await window.supabase
            .from('perfiles')
            .select('nombre, rol')
            .eq('id', usuario.id)
            .single();
        
        if (!perfil || perfil.rol !== 'conductor') {
            alert('No tienes permisos de conductor');
            await window.supabase.auth.signOut();
            window.location.href = 'login.html';
            return;
        }
        
        document.getElementById('welcomeMsg').textContent = perfil.nombre;
        
        // Obtener datos de conductor
        const { data: conductor } = await window.supabase
            .from('conductores')
            .select('*')
            .eq('perfil_id', usuario.id)
            .single();
        
        if (!conductor) {
            alert('No se encontró tu registro de conductor');
            return;
        }
        
        conductorId = conductor.id;
        conductorData = conductor;
        console.log('✅ Conductor ID:', conductorId);
        
        // Actualizar UI según estado
        actualizarUIEstado(conductor.estado);
        
        // Inicializar
        inicializarMapa();
        inicializarGPS();
        inicializarTabs();
        cargarCarreras();
        cargarEstadisticas();
        suscribirseACambios();
        
        console.log('=== APP CONDUCTOR INICIADA ===');
        document.getElementById('loader').classList.add('hidden');
        
    } catch (error) {
        console.error('Error en init:', error);
        alert('Error: ' + error.message);
        document.getElementById('loader').classList.add('hidden');
    }
}

// ============================================
// MAPA
// ============================================

async function inicializarMapa() {
    mapa = L.map('map').setView([14.0723, -87.1921], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa);
    console.log('✅ Mapa inicializado');
}

// ============================================
// GPS Y UBICACIÓN
// ============================================

async function inicializarGPS() {
    if (!navigator.geolocation) {
        alert('Tu navegador no soporta GPS');
        return;
    }
    
    // Obtener ubicación inicial
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            miUbicacion = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude
            };
            
            console.log('✅ GPS activado:', miUbicacion);
            
            // Centrar mapa
            mapa.setView([miUbicacion.lat, miUbicacion.lng], 15);
            
            // Crear marcador de mi ubicación (tuk-tuk)
            miMarker = L.marker([miUbicacion.lat, miUbicacion.lng], {
                icon: L.divIcon({
                    html: '🛺',
                    className: 'emoji-marker',
                    iconSize: [40, 40]
                })
            }).addTo(mapa).bindPopup('Tu ubicación');
            
            // Iniciar actualización continua
            iniciarActualizacionGPS();
        },
        (error) => {
            console.error('Error GPS:', error);
            alert('No se pudo obtener tu ubicación. Por favor activa el GPS.');
        },
        { enableHighAccuracy: true }
    );
}

function iniciarActualizacionGPS() {
    if (gpsInterval) clearInterval(gpsInterval);
    
    gpsInterval = setInterval(async () => {
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                miUbicacion = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude
                };
                
                // Actualizar marcador
                if (miMarker) {
                    miMarker.setLatLng([miUbicacion.lat, miUbicacion.lng]);
                }
                
                // Guardar en BD si está disponible
                if (conductorData.estado === 'disponible' || conductorData.estado === 'en_carrera') {
                    await guardarUbicacionEnBD();
                }
            },
            (error) => console.warn('Error actualizando GPS:', error),
            { enableHighAccuracy: true, maximumAge: 0 }
        );
    }, 5000); // Cada 5 segundos
}

async function guardarUbicacionEnBD() {
    if (!miUbicacion) return;
    
    try {
        await window.supabase
            .from('conductores')
            .update({
                latitud: miUbicacion.lat,
                longitud: miUbicacion.lng,
                ultima_actualizacion: new Date().toISOString()
            })
            .eq('id', conductorId);
    } catch (error) {
        console.warn('Error guardando ubicación:', error);
    }
}

// ============================================
// ESTADO DEL CONDUCTOR
// ============================================

async function cambiarEstado(nuevoEstado) {
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        const { error } = await window.supabase
            .from('conductores')
            .update({ estado: nuevoEstado })
            .eq('id', conductorId);
        
        if (error) throw error;
        
        conductorData.estado = nuevoEstado;
        actualizarUIEstado(nuevoEstado);
        
        mostrarNotificacion(
            nuevoEstado === 'disponible' ? '¡Estás disponible para recibir carreras!' : 'Estado cambiado a inactivo',
            nuevoEstado === 'disponible' ? 'success' : 'info'
        );
        
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

function actualizarUIEstado(estado) {
    const btnDisponible = document.getElementById('btnDisponible');
    const btnInactivo = document.getElementById('btnInactivo');
    
    btnDisponible.classList.remove('disponible');
    btnInactivo.classList.remove('inactivo');
    
    if (estado === 'disponible') {
        btnDisponible.classList.add('disponible');
    } else {
        btnInactivo.classList.add('inactivo');
    }
}

// ============================================
// CARRERAS DIRECTAS
// ============================================

async function cargarCarreras() {
    await cargarCarrerasDirectas();
    await cargarCarrerasColectivas();
}

async function cargarCarrerasDirectas() {
    try {
        // Carreras asignadas a mí
        const { data, error } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('conductor_id', conductorId)
            .in('estado', ['asignada', 'aceptada', 'en_camino', 'en_curso'])
            .order('fecha_solicitud', { ascending: true });
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            document.getElementById('carrerasDirectas').innerHTML = '<p style="text-align:center;color:#6b7280">No hay carreras directas</p>';
            return;
        }
        
        let html = '';
        data.forEach(carrera => {
            html += renderCarreraDirecta(carrera);
        });
        
        document.getElementById('carrerasDirectas').innerHTML = html;
        
        // Mostrar en mapa la primera carrera
        if (data.length > 0) {
            mostrarCarreraEnMapa(data[0]);
        }
        
    } catch (error) {
        console.error('Error cargando carreras:', error);
    }
}

function renderCarreraDirecta(carrera) {
    const estados = {
        'asignada': { badge: 'warning', texto: 'Nueva Carrera' },
        'aceptada': { badge: 'success', texto: 'Aceptada' },
        'en_camino': { badge: 'info', texto: 'En Camino' },
        'en_curso': { badge: 'success', texto: 'En Curso' }
    };
    
    const estado = estados[carrera.estado] || { badge: 'info', texto: carrera.estado };
    
    let html = `
        <div class="card card-carrera">
            <h4>${carrera.numero_carrera || 'Carrera'} 
                <span class="badge badge-${estado.badge}">${estado.texto}</span>
            </h4>
            <p><strong>📍 Origen:</strong> ${carrera.origen_direccion}</p>
            <p><strong>🏁 Destino:</strong> ${carrera.destino_direccion}</p>
            <p><strong>💵 Tarifa:</strong> L ${parseFloat(carrera.precio).toFixed(2)}</p>
    `;
    
    if (carrera.estado === 'asignada') {
        // Timer de 60 segundos
        const timerId = `timer-${carrera.id}`;
        if (!timers[carrera.id]) {
            timers[carrera.id] = 60;
            iniciarTimer(carrera.id);
        }
        
        html += `
            <div class="timer" id="${timerId}">${timers[carrera.id]}s</div>
            <div style="display:flex;gap:0.5rem">
                <button class="btn btn-success" style="flex:1" onclick="aceptarCarrera('${carrera.id}')">
                    ✅ Aceptar
                </button>
                <button class="btn btn-danger" style="flex:1" onclick="rechazarCarrera('${carrera.id}')">
                    ❌ Rechazar
                </button>
            </div>
        `;
    } else if (carrera.estado === 'aceptada') {
        html += `
            <button class="btn btn-primary btn-block" onclick="irAlOrigen('${carrera.id}')">
                🚀 Ir al Origen
            </button>
        `;
    } else if (carrera.estado === 'en_camino') {
        html += `
            <button class="btn btn-success btn-block" onclick="clienteAbordado('${carrera.id}')">
                👤 Cliente Abordado
            </button>
        `;
    } else if (carrera.estado === 'en_curso') {
        html += `
            <button class="btn btn-primary btn-block" onclick="completarCarrera('${carrera.id}')">
                ✅ Completar Carrera
            </button>
        `;
    }
    
    html += `</div>`;
    return html;
}

function iniciarTimer(carreraId) {
    const interval = setInterval(() => {
        if (timers[carreraId]) {
            timers[carreraId]--;
            const timerEl = document.getElementById(`timer-${carreraId}`);
            if (timerEl) {
                timerEl.textContent = timers[carreraId] + 's';
            }
            
            if (timers[carreraId] <= 0) {
                clearInterval(interval);
                rechazarCarrera(carreraId, true); // Auto-rechazar
            }
        } else {
            clearInterval(interval);
        }
    }, 1000);
}

async function mostrarCarreraEnMapa(carrera) {
    if (!miUbicacion) return;
    
    try {
        // Limpiar rutas anteriores
        if (rutaActualLayer) mapa.removeLayer(rutaActualLayer);
        if (origenMarker) mapa.removeLayer(origenMarker);
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        
        // Marcadores
        origenMarker = L.marker([carrera.origen_lat, carrera.origen_lng], {
            icon: L.divIcon({ html: '📍', className: 'emoji-marker' })
        }).addTo(mapa).bindPopup('Origen');
        
        destinoMarker = L.marker([carrera.destino_lat, carrera.destino_lng], {
            icon: L.divIcon({ html: '🏁', className: 'emoji-marker' })
        }).addTo(mapa).bindPopup('Destino');
        
        // Ruta 1: Mi ubicación → Origen
        const ruta1 = await calcularRutaOSRM(
            miUbicacion.lng, miUbicacion.lat,
            carrera.origen_lng, carrera.origen_lat
        );
        
        // Ruta 2: Origen → Destino
        const ruta2 = await calcularRutaOSRM(
            carrera.origen_lng, carrera.origen_lat,
            carrera.destino_lng, carrera.destino_lat
        );
        
        // Dibujar ambas rutas
        rutaActualLayer = L.layerGroup();
        
        if (ruta1.geometry) {
            L.geoJSON(ruta1.geometry, {
                style: { color: '#ef4444', weight: 4, dashArray: '10, 10' }
            }).addTo(rutaActualLayer).bindPopup(`Distancia: ${(ruta1.distance/1000).toFixed(2)} km<br>Tiempo: ${Math.round(ruta1.duration/60)} min`);
        }
        
        if (ruta2.geometry) {
            L.geoJSON(ruta2.geometry, {
                style: { color: '#f59e0b', weight: 4 }
            }).addTo(rutaActualLayer).bindPopup(`Distancia: ${(ruta2.distance/1000).toFixed(2)} km<br>Tiempo: ${Math.round(ruta2.duration/60)} min`);
        }
        
        rutaActualLayer.addTo(mapa);
        
        // Ajustar vista
        const bounds = L.latLngBounds([
            [miUbicacion.lat, miUbicacion.lng],
            [carrera.origen_lat, carrera.origen_lng],
            [carrera.destino_lat, carrera.destino_lng]
        ]);
        mapa.fitBounds(bounds, { padding: [50, 50] });
        
        console.log('✅ Carrera mostrada en mapa');
        
    } catch (error) {
        console.error('Error mostrando carrera:', error);
    }
}

async function calcularRutaOSRM(lng1, lat1, lng2, lat2) {
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.routes && data.routes[0]) {
            return {
                geometry: data.routes[0].geometry,
                distance: data.routes[0].distance,
                duration: data.routes[0].duration
            };
        }
        return {};
    } catch (error) {
        console.error('Error OSRM:', error);
        return {};
    }
}

// ============================================
// ACCIONES DE CARRERAS
// ============================================

async function aceptarCarrera(id) {
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        const { error } = await window.supabase
            .from('carreras')
            .update({ 
                estado: 'aceptada',
                fecha_aceptacion: new Date().toISOString()
            })
            .eq('id', id);
        
        if (error) throw error;
        
        delete timers[id];
        await cambiarEstado('en_carrera');
        mostrarNotificacion('¡Carrera aceptada!', 'success');
        reproducirSonido();
        cargarCarreras();
        
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

async function rechazarCarrera(id, autoRechazo = false) {
    try {
        const { error } = await window.supabase
            .from('carreras')
            .update({ 
                estado: 'rechazada',
                conductor_id: null
            })
            .eq('id', id);
        
        if (error) throw error;
        
        delete timers[id];
        if (autoRechazo) {
            mostrarNotificacion('Carrera expirada por tiempo', 'warning');
        } else {
            mostrarNotificacion('Carrera rechazada', 'info');
        }
        cargarCarreras();
        
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function irAlOrigen(id) {
    try {
        const { error } = await window.supabase
            .from('carreras')
            .update({ estado: 'en_camino', fecha_inicio_viaje: new Date().toISOString() })
            .eq('id', id);
        
        if (error) throw error;
        
        mostrarNotificacion('En camino al origen', 'info');
        cargarCarreras();
        
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function clienteAbordado(id) {
    try {
        const { error } = await window.supabase
            .from('carreras')
            .update({ estado: 'en_curso', fecha_inicio: new Date().toISOString() })
            .eq('id', id);
        
        if (error) throw error;
        
        mostrarNotificacion('Cliente abordado. ¡Buen viaje!', 'success');
        cargarCarreras();
        
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function completarCarrera(id) {
    if (!confirm('¿Completar esta carrera?')) return;
    
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        const { error } = await window.supabase
            .from('carreras')
            .update({ 
                estado: 'completada',
                fecha_completado: new Date().toISOString()
            })
            .eq('id', id);
        
        if (error) throw error;
        
        await cambiarEstado('disponible');
        mostrarNotificacion('¡Carrera completada!', 'success');
        reproducirSonido();
        
        // Limpiar mapa
        if (rutaActualLayer) mapa.removeLayer(rutaActualLayer);
        if (origenMarker) mapa.removeLayer(origenMarker);
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        
        cargarCarreras();
        cargarEstadisticas();
        
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

// ============================================
// CARRERAS COLECTIVAS
// ============================================

async function cargarCarrerasColectivas() {
    try {
        const { data, error } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('tipo', 'colectivo')
            .in('estado', ['solicitada', 'buscando'])
            .order('fecha_solicitud', { ascending: true })
            .limit(10);
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            document.getElementById('carrerasColectivas').innerHTML = '<p style="text-align:center;color:#6b7280">No hay carreras colectivas disponibles</p>';
            return;
        }
        
        let html = '';
        data.forEach(carrera => {
            html += renderCarreraColectiva(carrera);
        });
        
        document.getElementById('carrerasColectivas').innerHTML = html;
        
        // Mostrar en mapa
        mostrarColectivasEnMapa(data);
        
    } catch (error) {
        console.error('Error:', error);
    }
}

function renderCarreraColectiva(carrera) {
    return `
        <div class="card card-colectiva">
            <h4>🚐 ${carrera.numero_carrera || 'Colectiva'}</h4>
            <p><strong>Origen:</strong> ${carrera.origen_direccion}</p>
            <p><strong>Destino:</strong> ${carrera.destino_direccion}</p>
            <p><strong>Tarifa:</strong> L ${parseFloat(carrera.precio).toFixed(2)}</p>
            <button class="btn btn-success btn-block" onclick="tomarColectiva('${carrera.id}')">
                Tomar Carrera
            </button>
        </div>
    `;
}

function mostrarColectivasEnMapa(carreras) {
    // Limpiar marcadores anteriores de colectivas
    // y agregar nuevos
    carreras.forEach(c => {
        L.marker([c.origen_lat, c.origen_lng], {
            icon: L.divIcon({ html: '🚐', className: 'emoji-marker' })
        }).addTo(mapa).bindPopup(`Colectiva<br>${c.origen_direccion}`);
    });
}

async function tomarColectiva(id) {
    // Similar a aceptar carrera directa
    await aceptarCarrera(id);
}

// ============================================
// ESTADÍSTICAS
// ============================================

async function cargarEstadisticas() {
    try {
        const hoy = new Date().toISOString().split('T')[0];
        
        const { data, error } = await window.supabase
            .from('carreras')
            .select('precio')
            .eq('conductor_id', conductorId)
            .eq('estado', 'completada')
            .gte('fecha_completado', hoy);
        
        if (error) throw error;
        
        const totalCarreras = data ? data.length : 0;
        const totalGanancias = data ? data.reduce((sum, c) => sum + parseFloat(c.precio), 0) : 0;
        
        document.getElementById('statCarreras').textContent = totalCarreras;
        document.getElementById('statGanancias').textContent = 'L ' + totalGanancias.toFixed(2);
        
    } catch (error) {
        console.error('Error cargando estadísticas:', error);
    }
}

// ============================================
// NOTIFICACIONES EN TIEMPO REAL
// ============================================

function suscribirseACambios() {
    window.supabase
        .channel('conductor-carreras')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'carreras',
            filter: `conductor_id=eq.${conductorId}`
        }, (payload) => {
            mostrarNotificacion('¡Nueva carrera asignada!', 'success');
            reproducirSonido();
            cargarCarreras();
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'carreras',
            filter: `conductor_id=eq.${conductorId}`
        }, (payload) => {
            cargarCarreras();
        })
        .subscribe();
}

// ============================================
// UTILIDADES
// ============================================

function inicializarTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        });
    });
}

function mostrarNotificacion(mensaje, tipo) {
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.textContent = mensaje;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

function reproducirSonido() {
    document.getElementById('notificationSound').play().catch(() => {});
}

async function cerrarSesion() {
    if (confirm('¿Cerrar sesión?')) {
        if (gpsInterval) clearInterval(gpsInterval);
        await cambiarEstado('inactivo');
        await window.supabase.auth.signOut();
        window.location.href = 'login.html';
    }
}

window.addEventListener('load', init);
