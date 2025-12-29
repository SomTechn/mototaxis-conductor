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
let marcadoresColectivas = [];

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
        console.log('Estado inicial:', conductor.estado);
        
        // Actualizar UI según estado
        actualizarUIEstado(conductor.estado);
        
        // Inicializar
        await inicializarMapa();
        await inicializarGPS();
        inicializarTabs();
        await cargarCarreras();
        await cargarEstadisticas();
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
    try {
        mapa = L.map('map').setView([14.0723, -87.1921], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 18
        }).addTo(mapa);
        
        // Forzar redimensión del mapa
        setTimeout(() => mapa.invalidateSize(), 500);
        
        console.log('✅ Mapa inicializado');
    } catch (error) {
        console.error('Error inicializando mapa:', error);
    }
}

// ============================================
// GPS Y UBICACIÓN
// ============================================

async function inicializarGPS() {
    if (!navigator.geolocation) {
        alert('Tu navegador no soporta GPS');
        return;
    }
    
    console.log('Solicitando ubicación GPS...');
    
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
                }),
                zIndexOffset: 1000
            }).addTo(mapa).bindPopup('Tu ubicación');
            
            // Iniciar actualización continua
            iniciarActualizacionGPS();
            
            // Guardar ubicación inicial
            guardarUbicacionEnBD();
        },
        (error) => {
            console.error('Error GPS:', error);
            alert('No se pudo obtener tu ubicación. Activa el GPS y recarga.');
        },
        { 
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

function iniciarActualizacionGPS() {
    if (gpsInterval) clearInterval(gpsInterval);
    
    console.log('Iniciando actualización GPS cada 5 segundos...');
    
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
                
                // Guardar en BD si está disponible o en carrera
                if (conductorData.estado === 'disponible' || conductorData.estado === 'en_carrera') {
                    await guardarUbicacionEnBD();
                }
            },
            (error) => console.warn('Error actualizando GPS:', error.message),
            { enableHighAccuracy: true, maximumAge: 0 }
        );
    }, 5000);
}

async function guardarUbicacionEnBD() {
    if (!miUbicacion || !conductorId) return;
    
    try {
        await window.supabase
            .from('conductores')
            .update({
                latitud: miUbicacion.lat,
                longitud: miUbicacion.lng,
                ultima_actualizacion: new Date().toISOString()
            })
            .eq('id', conductorId);
        
        console.log('Ubicación guardada:', miUbicacion);
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
        
        console.log('Estado cambiado a:', nuevoEstado);
        
        mostrarNotificacion(
            nuevoEstado === 'disponible' ? '¡Estás disponible!' : 'Estado: Inactivo',
            nuevoEstado === 'disponible' ? 'success' : 'info'
        );
        
        // Recargar carreras si cambia a disponible
        if (nuevoEstado === 'disponible') {
            await cargarCarreras();
        }
        
    } catch (error) {
        console.error('Error:', error);
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
    
    if (estado === 'disponible' || estado === 'en_carrera') {
        btnDisponible.classList.add('disponible');
    } else {
        btnInactivo.classList.add('inactivo');
    }
}

// ============================================
// CARRERAS
// ============================================

async function cargarCarreras() {
    console.log('Cargando carreras...');
    await cargarCarrerasDirectas();
    await cargarCarrerasColectivas();
}

async function cargarCarrerasDirectas() {
    try {
        console.log('Buscando carreras directas para conductor:', conductorId);
        
        // Carreras asignadas a mí o en curso
        const { data, error } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('conductor_id', conductorId)
            .in('estado', ['asignada', 'aceptada', 'en_camino', 'en_curso'])
            .order('fecha_solicitud', { ascending: false });
        
        if (error) {
            console.error('Error SQL:', error);
            throw error;
        }
        
        console.log('Carreras encontradas:', data ? data.length : 0);
        
        if (!data || data.length === 0) {
            document.getElementById('carrerasDirectas').innerHTML = '<p style="text-align:center;color:#6b7280;padding:1rem">No hay carreras directas asignadas</p>';
            return;
        }
        
        let html = '';
        data.forEach(carrera => {
            console.log('Renderizando carrera:', carrera.id, carrera.estado);
            html += renderCarreraDirecta(carrera);
        });
        
        document.getElementById('carrerasDirectas').innerHTML = html;
        
        // Mostrar la primera en el mapa
        if (data.length > 0 && miUbicacion) {
            mostrarCarreraEnMapa(data[0]);
        }
        
    } catch (error) {
        console.error('Error cargando carreras directas:', error);
        document.getElementById('carrerasDirectas').innerHTML = '<p style="text-align:center;color:#ef4444;padding:1rem">Error cargando carreras</p>';
    }
}

function renderCarreraDirecta(carrera) {
    const estados = {
        'asignada': { badge: 'warning', texto: '🔔 Nueva' },
        'aceptada': { badge: 'success', texto: '✅ Aceptada' },
        'en_camino': { badge: 'info', texto: '🚗 En Camino' },
        'en_curso': { badge: 'success', texto: '🏁 En Curso' }
    };
    
    const estado = estados[carrera.estado] || { badge: 'info', texto: carrera.estado };
    
    let html = `
        <div class="card card-carrera">
            <h4>#${carrera.numero_carrera || carrera.id.slice(0,8)} 
                <span class="badge badge-${estado.badge}">${estado.texto}</span>
            </h4>
            <p><strong>📍 Origen:</strong> ${carrera.origen_direccion}</p>
            <p><strong>🏁 Destino:</strong> ${carrera.destino_direccion}</p>
            <p><strong>💵 Tarifa:</strong> L ${parseFloat(carrera.precio).toFixed(2)}</p>
            <p><strong>📏 Distancia:</strong> ${carrera.distancia_km ? carrera.distancia_km.toFixed(2) + ' km' : 'N/A'}</p>
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
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
                <button class="btn btn-success" onclick="aceptarCarrera('${carrera.id}')">
                    ✅ Aceptar
                </button>
                <button class="btn btn-danger" onclick="rechazarCarrera('${carrera.id}')">
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
        if (timers[carreraId] !== undefined) {
            timers[carreraId]--;
            const timerEl = document.getElementById(`timer-${carreraId}`);
            if (timerEl) {
                timerEl.textContent = timers[carreraId] + 's';
                
                if (timers[carreraId] <= 10) {
                    timerEl.style.animation = 'pulse 1s infinite';
                }
            }
            
            if (timers[carreraId] <= 0) {
                clearInterval(interval);
                rechazarCarrera(carreraId, true);
            }
        } else {
            clearInterval(interval);
        }
    }, 1000);
}

async function mostrarCarreraEnMapa(carrera) {
    if (!miUbicacion) {
        console.warn('No hay ubicación GPS aún');
        return;
    }
    
    try {
        console.log('Mostrando carrera en mapa:', carrera.id);
        
        // Limpiar rutas anteriores
        if (rutaActualLayer) mapa.removeLayer(rutaActualLayer);
        if (origenMarker) mapa.removeLayer(origenMarker);
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        
        // Marcadores
        origenMarker = L.marker([carrera.origen_lat, carrera.origen_lng], {
            icon: L.divIcon({ html: '📍', className: 'emoji-marker', iconSize: [30, 30] })
        }).addTo(mapa).bindPopup('<b>Origen</b><br>' + carrera.origen_direccion);
        
        destinoMarker = L.marker([carrera.destino_lat, carrera.destino_lng], {
            icon: L.divIcon({ html: '🏁', className: 'emoji-marker', iconSize: [30, 30] })
        }).addTo(mapa).bindPopup('<b>Destino</b><br>' + carrera.destino_direccion);
        
        // Ruta 1: Mi ubicación → Origen (línea punteada roja)
        const ruta1 = await calcularRutaOSRM(
            miUbicacion.lng, miUbicacion.lat,
            carrera.origen_lng, carrera.origen_lat
        );
        
        // Ruta 2: Origen → Destino (línea sólida naranja)
        const ruta2 = await calcularRutaOSRM(
            carrera.origen_lng, carrera.origen_lat,
            carrera.destino_lng, carrera.destino_lat
        );
        
        // Dibujar ambas rutas
        rutaActualLayer = L.layerGroup();
        
        if (ruta1.geometry) {
            const km1 = (ruta1.distance / 1000).toFixed(2);
            const min1 = Math.round(ruta1.duration / 60 * 1.3); // Con tráfico
            
            L.geoJSON(ruta1.geometry, {
                style: { 
                    color: '#ef4444', 
                    weight: 4, 
                    dashArray: '10, 10',
                    opacity: 0.8
                }
            }).addTo(rutaActualLayer).bindPopup(`<b>Hacia el origen</b><br>📏 ${km1} km<br>⏱️ ${min1} min`);
        }
        
        if (ruta2.geometry) {
            const km2 = (ruta2.distance / 1000).toFixed(2);
            const min2 = Math.round(ruta2.duration / 60 * 1.3);
            
            L.geoJSON(ruta2.geometry, {
                style: { 
                    color: '#f59e0b', 
                    weight: 4,
                    opacity: 0.8
                }
            }).addTo(rutaActualLayer).bindPopup(`<b>Origen → Destino</b><br>📏 ${km2} km<br>⏱️ ${min2} min`);
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
        console.error('Error mostrando carrera en mapa:', error);
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
// CARRERAS COLECTIVAS
// ============================================

async function cargarCarrerasColectivas() {
    try {
        console.log('Buscando carreras colectivas...');
        
        // Carreras colectivas sin conductor o en búsqueda
        const { data, error } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('tipo', 'colectivo')
            .in('estado', ['solicitada', 'buscando'])
            .is('conductor_id', null)
            .order('fecha_solicitud', { ascending: true })
            .limit(20);
        
        if (error) throw error;
        
        console.log('Carreras colectivas encontradas:', data ? data.length : 0);
        
        if (!data || data.length === 0) {
            document.getElementById('carrerasColectivas').innerHTML = '<p style="text-align:center;color:#6b7280;padding:1rem">No hay carreras colectivas disponibles</p>';
            limpiarMarcadoresColectivas();
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
        console.error('Error cargando colectivas:', error);
        document.getElementById('carrerasColectivas').innerHTML = '<p style="text-align:center;color:#ef4444;padding:1rem">Error cargando carreras</p>';
    }
}

function renderCarreraColectiva(carrera) {
    return `
        <div class="card card-colectiva">
            <h4>🚐 #${carrera.numero_carrera || carrera.id.slice(0,8)}</h4>
            <p><strong>📍 Origen:</strong> ${carrera.origen_direccion}</p>
            <p><strong>🏁 Destino:</strong> ${carrera.destino_direccion}</p>
            <p><strong>💵 Tarifa:</strong> L ${parseFloat(carrera.precio).toFixed(2)}</p>
            <p style="color:#10b981;font-weight:bold">✨ Incluye 30% descuento</p>
            <button class="btn btn-success btn-block" onclick="tomarColectiva('${carrera.id}')">
                Tomar Carrera
            </button>
        </div>
    `;
}

function limpiarMarcadoresColectivas() {
    marcadoresColectivas.forEach(m => mapa.removeLayer(m));
    marcadoresColectivas = [];
}

function mostrarColectivasEnMapa(carreras) {
    // Limpiar marcadores anteriores
    limpiarMarcadoresColectivas();
    
    // Agregar nuevos marcadores
    carreras.forEach(c => {
        const marker = L.marker([c.origen_lat, c.origen_lng], {
            icon: L.divIcon({ 
                html: '🚐', 
                className: 'emoji-marker',
                iconSize: [30, 30]
            })
        }).addTo(mapa).bindPopup(`
            <b>🚐 Colectiva</b><br>
            ${c.origen_direccion}<br>
            <b>L ${parseFloat(c.precio).toFixed(2)}</b>
        `);
        
        marcadoresColectivas.push(marker);
    });
    
    console.log(`✅ ${carreras.length} colectivas mostradas en mapa`);
}

async function tomarColectiva(id) {
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        // Asignarme como conductor
        const { error } = await window.supabase
            .from('carreras')
            .update({ 
                conductor_id: conductorId,
                estado: 'asignada'
            })
            .eq('id', id)
            .is('conductor_id', null); // Solo si no tiene conductor aún
        
        if (error) throw error;
        
        mostrarNotificacion('¡Carrera colectiva tomada!', 'success');
        reproducirSonido();
        
        // Cambiar a pestaña directas y recargar
        document.querySelector('[data-tab="directas"]').click();
        await cargarCarreras();
        
    } catch (error) {
        console.error('Error:', error);
        alert('Error: Esta carrera ya fue tomada por otro conductor');
        await cargarCarreras();
    } finally {
        document.getElementById('loader').classList.add('hidden');
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
        await cargarCarreras();
        
    } catch (error) {
        console.error('Error:', error);
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
            mostrarNotificacion('Carrera expirada (60s)', 'warning');
        } else {
            mostrarNotificacion('Carrera rechazada', 'info');
        }
        
        await cargarCarreras();
        
    } catch (error) {
        console.error('Error:', error);
    }
}

async function irAlOrigen(id) {
    try {
        const { error } = await window.supabase
            .from('carreras')
            .update({ 
                estado: 'en_camino',
                fecha_inicio_viaje: new Date().toISOString()
            })
            .eq('id', id);
        
        if (error) throw error;
        
        mostrarNotificacion('En camino al origen 🚗', 'info');
        await cargarCarreras();
        
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function clienteAbordado(id) {
    try {
        const { error } = await window.supabase
            .from('carreras')
            .update({ 
                estado: 'en_curso',
                fecha_inicio: new Date().toISOString()
            })
            .eq('id', id);
        
        if (error) throw error;
        
        mostrarNotificacion('Cliente abordado 👤', 'success');
        await cargarCarreras();
        
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
        mostrarNotificacion('¡Carrera completada! 🎉', 'success');
        reproducirSonido();
        
        // Limpiar mapa
        if (rutaActualLayer) mapa.removeLayer(rutaActualLayer);
        if (origenMarker) mapa.removeLayer(origenMarker);
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        
        await cargarCarreras();
        await cargarEstadisticas();
        
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

// ============================================
// ESTADÍSTICAS
// ============================================

async function cargarEstadisticas() {
    try {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        
        const { data, error } = await window.supabase
            .from('carreras')
            .select('precio')
            .eq('conductor_id', conductorId)
            .eq('estado', 'completada')
            .gte('fecha_completado', hoy.toISOString());
        
        if (error) throw error;
        
        const totalCarreras = data ? data.length : 0;
        const totalGanancias = data ? data.reduce((sum, c) => sum + parseFloat(c.precio || 0), 0) : 0;
        
        document.getElementById('statCarreras').textContent = totalCarreras;
        document.getElementById('statGanancias').textContent = 'L ' + totalGanancias.toFixed(2);
        
        console.log('Estadísticas:', { totalCarreras, totalGanancias });
        
    } catch (error) {
        console.error('Error cargando estadísticas:', error);
    }
}

// ============================================
// NOTIFICACIONES EN TIEMPO REAL
// ============================================

function suscribirseACambios() {
    console.log('Suscribiéndose a cambios...');
    
    window.supabase
        .channel('conductor-changes')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'carreras'
        }, async (payload) => {
            console.log('Cambio detectado:', payload);
            
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                const carrera = payload.new;
                
                // Nueva carrera asignada a mí
                if (carrera.conductor_id === conductorId && carrera.estado === 'asignada') {
                    mostrarNotificacion('¡Nueva carrera asignada!', 'success');
                    reproducirSonido();
                    await cargarCarreras();
                }
                
                // Cambio en mis carreras
                if (carrera.conductor_id === conductorId) {
                    await cargarCarreras();
                }
                
                // Nueva colectiva disponible
                if (carrera.tipo === 'colectivo' && !carrera.conductor_id) {
                    await cargarCarrerasColectivas();
                }
            }
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
    setTimeout(() => notif.remove(), 4000);
}

function reproducirSonido() {
    try {
        document.getElementById('notificationSound').play();
    } catch (e) {
        console.warn('No se pudo reproducir sonido:', e);
    }
}

async function cerrarSesion() {
    if (confirm('¿Cerrar sesión?')) {
        if (gpsInterval) clearInterval(gpsInterval);
        await cambiarEstado('inactivo');
        await window.supabase.auth.signOut();
        window.location.href = 'login.html';
    }
}

// Iniciar cuando la página cargue
window.addEventListener('load', init);

// Manejar cambio de orientación en móviles
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        if (mapa) mapa.invalidateSize();
    }, 200);
});
