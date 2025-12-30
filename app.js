// ============================================
// VARIABLES GLOBALES
// ============================================

let mapa, usuario, conductorId, conductorData;
let miUbicacion = null;
let miMarker = null;
let gpsInterval = null;
let trackingInterval = null;
let timers = {};
let marcadoresColectivas = [];
let carreraEnCurso = null;
let ultimaDireccion = 0;

// ============================================
// INICIALIZACIÓN
// ============================================

async function init() {
    console.log('=== INICIANDO APP CONDUCTOR (UBER STYLE) ===');
    
    try {
        // Esperar Supabase
        console.log('1. Esperando Supabase...');
        let intentos = 0;
        while (!window.supabase?.auth && intentos < 50) {
            await new Promise(r => setTimeout(r, 100));
            intentos++;
        }
        
        if (!window.supabase?.auth) {
            throw new Error('No se pudo conectar a Supabase');
        }
        console.log('✅ Supabase conectado');
        
        // Verificar sesión
        console.log('2. Verificando sesión...');
        const { data: { session }, error: sessionError } = await window.supabase.auth.getSession();
        
        if (sessionError) throw sessionError;
        if (!session) {
            window.location.href = 'login.html';
            return;
        }
        
        usuario = session.user;
        console.log('✅ Sesión:', usuario.email);
        
        // Cargar perfil
        console.log('3. Cargando perfil...');
        const { data: perfil, error: perfilError } = await window.supabase
            .from('perfiles')
            .select('nombre, rol')
            .eq('id', usuario.id)
            .single();
        
        if (perfilError) throw perfilError;
        if (!perfil || perfil.rol !== 'conductor') {
            alert('No tienes permisos de conductor');
            await window.supabase.auth.signOut();
            window.location.href = 'login.html';
            return;
        }
        
        console.log('✅ Perfil:', perfil.nombre);
        
        // Obtener datos de conductor
        console.log('4. Cargando datos de conductor...');
        const { data: conductor, error: conductorError } = await window.supabase
            .from('conductores')
            .select('*')
            .eq('perfil_id', usuario.id)
            .single();
        
        if (conductorError) throw conductorError;
        if (!conductor) throw new Error('Registro de conductor no encontrado');
        
        conductorId = conductor.id;
        conductorData = conductor;
        console.log('✅ Conductor ID:', conductorId);
        
        // Actualizar UI
        actualizarEstadoUI(conductor.estado);
        
        // Inicializar
        await inicializarMapa();
        inicializarGPS();
        inicializarGestos();
        await cargarTodasCarreras();
        await cargarEstadisticas();
        suscribirseACambios();
        
        console.log('=== ✅ APP INICIADA ===');
        document.getElementById('loader').classList.add('hidden');
        
    } catch (error) {
        console.error('=== ❌ ERROR EN INIT ===');
        console.error(error);
        alert('Error al iniciar: ' + error.message);
        document.getElementById('loader').classList.add('hidden');
    }
}

// ============================================
// MAPA
// ============================================

async function inicializarMapa() {
    try {
        mapa = L.map('map', {
            zoomControl: false
        }).setView([14.0723, -87.1921], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 18
        }).addTo(mapa);
        
        L.control.zoom({
            position: 'bottomright'
        }).addTo(mapa);
        
        setTimeout(() => mapa.invalidateSize(), 500);
        console.log('✅ Mapa inicializado');
        return true;
    } catch (error) {
        console.error('Error inicializando mapa:', error);
        throw error;
    }
}

// ============================================
// GPS CON ROTACIÓN
// ============================================

function inicializarGPS() {
    if (!navigator.geolocation) {
        console.warn('GPS no disponible');
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            miUbicacion = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                heading: pos.coords.heading || 0
            };
            
            console.log('✅ GPS activado:', miUbicacion);
            mapa.setView([miUbicacion.lat, miUbicacion.lng], 15);
            
            // Crear marcador rotable
            crearMarcadorRotable();
            
            iniciarActualizacionGPS();
            guardarUbicacionEnBD();
        },
        (error) => {
            console.error('Error GPS:', error);
        },
        { 
            enableHighAccuracy: true, 
            timeout: 10000
        }
    );
}

function crearMarcadorRotable() {
    const iconHtml = `
        <div style="transform: rotate(${ultimaDireccion}deg); transition: transform 0.3s ease;">
            <svg width="40" height="40" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="18" fill="#2563eb" opacity="0.3"/>
                <circle cx="20" cy="20" r="12" fill="#2563eb"/>
                <path d="M 20 8 L 26 24 L 20 20 L 14 24 Z" fill="white"/>
            </svg>
        </div>
    `;
    
    if (miMarker) {
        mapa.removeLayer(miMarker);
    }
    
    miMarker = L.marker([miUbicacion.lat, miUbicacion.lng], {
        icon: L.divIcon({
            html: iconHtml,
            className: 'rotating-marker',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        }),
        zIndexOffset: 1000
    }).addTo(mapa);
}

function calcularDireccion(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const bearing = Math.atan2(y, x);
    return ((bearing * 180 / Math.PI) + 360) % 360;
}

function iniciarActualizacionGPS() {
    if (gpsInterval) clearInterval(gpsInterval);
    
    let ubicacionAnterior = { ...miUbicacion };
    
    gpsInterval = setInterval(async () => {
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const nuevaLat = pos.coords.latitude;
                const nuevaLng = pos.coords.longitude;
                
                // Calcular dirección de movimiento
                if (ubicacionAnterior.lat !== nuevaLat || ubicacionAnterior.lng !== nuevaLng) {
                    ultimaDireccion = calcularDireccion(
                        ubicacionAnterior.lat, ubicacionAnterior.lng,
                        nuevaLat, nuevaLng
                    );
                }
                
                miUbicacion = {
                    lat: nuevaLat,
                    lng: nuevaLng,
                    heading: ultimaDireccion
                };
                
                // Actualizar marcador con rotación
                crearMarcadorRotable();
                
                // Si hay carrera activa, verificar cambio de ruta
                if (carreraEnCurso) {
                    await verificarCambioRuta();
                }
                
                ubicacionAnterior = { ...miUbicacion };
                
                if (conductorData.estado !== 'inactivo') {
                    await guardarUbicacionEnBD();
                }
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 0 }
        );
    }, 3000); // Cada 3 segundos
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
    } catch (error) {
        console.warn('Error guardando ubicación:', error);
    }
}

// ============================================
// TRACKING EN TIEMPO REAL
// ============================================

async function iniciarTrackingCarrera(carrera) {
    carreraEnCurso = carrera;
    
    if (trackingInterval) clearInterval(trackingInterval);
    
    console.log('Iniciando tracking para carrera:', carrera.id);
    
    // Actualizar cada 5 segundos
    trackingInterval = setInterval(async () => {
        if (!carreraEnCurso || !miUbicacion) return;
        
        await actualizarDistanciasYTiempos();
    }, 5000);
    
    // Primera actualización inmediata
    await actualizarDistanciasYTiempos();
}

function detenerTrackingCarrera() {
    if (trackingInterval) {
        clearInterval(trackingInterval);
        trackingInterval = null;
    }
    carreraEnCurso = null;
}

async function actualizarDistanciasYTiempos() {
    if (!carreraEnCurso || !miUbicacion) return;
    
    try {
        const estado = carreraEnCurso.estado;
        
        if (estado === 'aceptada' || estado === 'en_camino') {
            // Calcular ruta a punto de recogida
            const rutaOrigen = await calcularRutaOSRM(
                miUbicacion.lng, miUbicacion.lat,
                carreraEnCurso.origen_lng, carreraEnCurso.origen_lat
            );
            
            if (rutaOrigen.distance && rutaOrigen.duration) {
                const kmOrigen = (rutaOrigen.distance / 1000).toFixed(1);
                const minOrigen = Math.round((rutaOrigen.duration / 60) * 1.3); // Con tráfico
                const horaLlegada = calcularHoraLlegada(minOrigen);
                
                actualizarUITracking('origen', kmOrigen, minOrigen, horaLlegada);
            }
        }
        
        // Siempre mostrar info del destino
        const rutaDestino = await calcularRutaOSRM(
            estado === 'en_curso' ? miUbicacion.lng : carreraEnCurso.origen_lng,
            estado === 'en_curso' ? miUbicacion.lat : carreraEnCurso.origen_lat,
            carreraEnCurso.destino_lng,
            carreraEnCurso.destino_lat
        );
        
        if (rutaDestino.distance && rutaDestino.duration) {
            const kmDestino = (rutaDestino.distance / 1000).toFixed(1);
            const minDestino = Math.round((rutaDestino.duration / 60) * 1.3);
            const horaLlegadaDestino = calcularHoraLlegada(minDestino);
            
            actualizarUITracking('destino', kmDestino, minDestino, horaLlegadaDestino);
        }
        
    } catch (error) {
        console.error('Error actualizando tracking:', error);
    }
}

function calcularHoraLlegada(minutos) {
    const ahora = new Date();
    ahora.setMinutes(ahora.getMinutes() + minutos);
    return ahora.toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' });
}

function actualizarUITracking(tipo, km, min, hora) {
    const elementoKm = document.getElementById(`tracking-${tipo}-km`);
    const elementoMin = document.getElementById(`tracking-${tipo}-min`);
    const elementoHora = document.getElementById(`tracking-${tipo}-hora`);
    
    if (elementoKm) elementoKm.textContent = km;
    if (elementoMin) elementoMin.textContent = min;
    if (elementoHora) elementoHora.textContent = hora;
}

// ============================================
// VERIFICAR CAMBIO DE RUTA
// ============================================

let ultimaRutaDibujada = null;
let contadorCambioRuta = 0;

async function verificarCambioRuta() {
    if (!carreraEnCurso || !miUbicacion) return;
    
    try {
        const destino = carreraEnCurso.estado === 'en_curso' 
            ? { lat: carreraEnCurso.destino_lat, lng: carreraEnCurso.destino_lng }
            : { lat: carreraEnCurso.origen_lat, lng: carreraEnCurso.origen_lng };
        
        const nuevaRuta = await calcularRutaOSRM(
            miUbicacion.lng, miUbicacion.lat,
            destino.lng, destino.lat
        );
        
        if (!nuevaRuta.geometry) return;
        
        // Comparar con ruta anterior
        const cambioSignificativo = !ultimaRutaDibujada || 
            Math.abs(nuevaRuta.distance - ultimaRutaDibujada.distance) > 500; // Más de 500m diferencia
        
        if (cambioSignificativo) {
            contadorCambioRuta++;
            console.log(`🔄 Cambio de ruta detectado (#${contadorCambioRuta})`);
            
            ultimaRutaDibujada = nuevaRuta;
            
            // Redibujar ruta
            await mostrarCarreraActivaEnMapa(carreraEnCurso);
            
            mostrarNotificacion('Ruta actualizada', 'info');
        }
        
    } catch (error) {
        console.error('Error verificando cambio de ruta:', error);
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
// CARGAR CARRERAS
// ============================================

async function cargarTodasCarreras() {
    await Promise.all([
        cargarCarrerasDisponibles(),
        cargarCarrerasActivas(),
        cargarCarrerasCompletadas()
    ]);
}

async function cargarCarrerasDisponibles() {
    try {
        console.log('=== CARGANDO CARRERAS DISPONIBLES ===');
        
        const { data: asignadas } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('conductor_id', conductorId)
            .eq('estado', 'asignada');
        
        const { data: directas } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('tipo', 'directo')
            .in('estado', ['solicitada', 'buscando'])
            .is('conductor_id', null)
            .limit(10);
        
        const { data: colectivas } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('tipo', 'colectivo')
            .in('estado', ['solicitada', 'buscando'])
            .is('conductor_id', null)
            .limit(20);
        
        const todas = [
            ...(asignadas || []), 
            ...(directas || []),
            ...(colectivas || [])
        ];
        
        if (todas.length === 0) {
            document.getElementById('carrerasDisponibles').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🏍️</div>
                    <div class="empty-text">No hay carreras disponibles</div>
                </div>
            `;
            document.getElementById('badgeDisponibles').style.display = 'none';
            limpiarMarcadoresColectivas();
            return;
        }
        
        let html = '';
        todas.forEach(carrera => {
            html += renderCarreraDisponible(carrera);
        });
        
        document.getElementById('carrerasDisponibles').innerHTML = html;
        document.getElementById('badgeDisponibles').textContent = todas.length;
        document.getElementById('badgeDisponibles').style.display = 'block';
        
        const paraMapa = [...(directas || []), ...(colectivas || [])];
        if (paraMapa.length > 0) {
            mostrarCarrerasEnMapa(paraMapa);
        }
        
    } catch (error) {
        console.error('Error cargando disponibles:', error);
    }
}

function renderCarreraDisponible(carrera) {
    const esColectiva = carrera.tipo === 'colectivo';
    const esNueva = carrera.conductor_id === conductorId;
    
    let html = `
        <div class="ride-card ${esNueva ? 'nueva' : ''}" onclick="expandirCarrera('${carrera.id}')">
            <div class="ride-header">
                <div class="ride-type">
                    ${esColectiva ? '🚐 Colectiva' : '🏍️ Directa'}
                </div>
                <div class="ride-price">L ${parseFloat(carrera.precio).toFixed(2)}</div>
            </div>
            
            <div class="ride-route">
                <div class="route-line">
                    <div class="route-dot"></div>
                    <div class="route-dots"></div>
                    <div class="route-dot destination"></div>
                </div>
                <div class="route-info">
                    <div class="route-point">
                        <div class="route-label">Recogida</div>
                        <div class="route-address">${carrera.origen_direccion}</div>
                    </div>
                    <div class="route-point">
                        <div class="route-label">Destino</div>
                        <div class="route-address">${carrera.destino_direccion}</div>
                    </div>
                </div>
            </div>
            
            <div class="ride-stats">
                <div class="stat-item">
                    <span>📏</span>
                    <span class="stat-value">${carrera.distancia_km ? carrera.distancia_km.toFixed(1) : '—'} km</span>
                </div>
                <div class="stat-item">
                    <span>⏱️</span>
                    <span class="stat-value">${carrera.tiempo_estimado_min || '—'} min</span>
                </div>
                ${esColectiva ? '<div class="stat-item"><span style="color:#10b981">✨ 30% OFF</span></div>' : ''}
            </div>
    `;
    
    if (esNueva) {
        const timerId = `timer-${carrera.id}`;
        if (!timers[carrera.id]) {
            timers[carrera.id] = 60;
            iniciarTimer(carrera.id);
        }
        
        html += `
            <div class="ride-timer">
                <div class="timer-text">Tiempo para responder</div>
                <div class="timer-value" id="${timerId}">${timers[carrera.id]}s</div>
            </div>
            <div class="ride-actions">
                <button class="btn btn-success" onclick="event.stopPropagation(); aceptarCarrera('${carrera.id}')">
                    Aceptar
                </button>
                <button class="btn btn-outline" onclick="event.stopPropagation(); rechazarCarrera('${carrera.id}')">
                    Rechazar
                </button>
            </div>
        `;
    } else {
        html += `
            <div class="ride-actions single">
                <button class="btn btn-primary" onclick="event.stopPropagation(); tomarCarrera('${carrera.id}')">
                    Tomar Carrera
                </button>
            </div>
        `;
    }
    
    html += `</div>`;
    return html;
}

async function cargarCarrerasActivas() {
    try {
        const { data } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('conductor_id', conductorId)
            .in('estado', ['aceptada', 'en_camino', 'en_curso']);
        
        if (!data || data.length === 0) {
            document.getElementById('carrerasActivas').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🚗</div>
                    <div class="empty-text">No tienes carreras en curso</div>
                </div>
            `;
            document.getElementById('badgeActivas').style.display = 'none';
            detenerTrackingCarrera();
            return;
        }
        
        let html = '';
        data.forEach(carrera => {
            html += renderCarreraActiva(carrera);
        });
        
        document.getElementById('carrerasActivas').innerHTML = html;
        document.getElementById('badgeActivas').textContent = data.length;
        document.getElementById('badgeActivas').style.display = 'block';
        
        // Iniciar tracking de la primera
        if (data.length > 0 && miUbicacion) {
            await mostrarCarreraActivaEnMapa(data[0]);
            await iniciarTrackingCarrera(data[0]);
        }
        
    } catch (error) {
        console.error('Error:', error);
    }
}

function renderCarreraActiva(carrera) {
    const estados = {
        'aceptada': { btn: 'Ir al Origen', action: 'irAlOrigen', icon: '🚀' },
        'en_camino': { btn: 'Cliente Abordado', action: 'clienteAbordado', icon: '👤' },
        'en_curso': { btn: 'Completar Viaje', action: 'completarCarrera', icon: '✅' }
    };
    
    const estado = estados[carrera.estado];
    const mostrarOrigen = carrera.estado !== 'en_curso';
    
    return `
        <div class="ride-card" style="border-left: 4px solid #2563eb">
            <div class="ride-header">
                <div class="ride-type">🏁 En curso</div>
                <div class="ride-price">L ${parseFloat(carrera.precio).toFixed(2)}</div>
            </div>
            
            ${mostrarOrigen ? `
            <div style="background:#fef3c7;padding:1rem;border-radius:0.5rem;margin-bottom:1rem">
                <div style="font-size:0.75rem;color:#92400e;font-weight:600;margin-bottom:0.5rem">AL PUNTO DE RECOGIDA</div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <div style="font-size:1.5rem;font-weight:800;color:#f59e0b">
                            <span id="tracking-origen-km">-.-</span> km
                        </div>
                        <div style="font-size:0.875rem;color:#92400e">
                            <span id="tracking-origen-min">--</span> min • 
                            Llegada: <span id="tracking-origen-hora">--:--</span>
                        </div>
                    </div>
                    <div style="font-size:2rem">📍</div>
                </div>
            </div>
            ` : ''}
            
            <div style="background:#e0f2fe;padding:1rem;border-radius:0.5rem;margin-bottom:1rem">
                <div style="font-size:0.75rem;color:#0c4a6e;font-weight:600;margin-bottom:0.5rem">AL DESTINO</div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <div style="font-size:1.5rem;font-weight:800;color:#0284c7">
                            <span id="tracking-destino-km">-.-</span> km
                        </div>
                        <div style="font-size:0.875rem;color:#0c4a6e">
                            <span id="tracking-destino-min">--</span> min • 
                            Llegada: <span id="tracking-destino-hora">--:--</span>
                        </div>
                    </div>
                    <div style="font-size:2rem">🏁</div>
                </div>
            </div>
            
            <div class="ride-route" style="margin-bottom:1rem">
                <div class="route-line">
                    <div class="route-dot"></div>
                    <div class="route-dots"></div>
                    <div class="route-dot destination"></div>
                </div>
                <div class="route-info">
                    <div class="route-point">
                        <div class="route-label">Recogida</div>
                        <div class="route-address">${carrera.origen_direccion}</div>
                    </div>
                    <div class="route-point">
                        <div class="route-label">Destino</div>
                        <div class="route-address">${carrera.destino_direccion}</div>
                    </div>
                </div>
            </div>
            
            <button class="btn btn-secondary btn-block" onclick="verRutaEnMapa('${carrera.id}')" style="margin-bottom:0.5rem;background:#6b7280">
                🗺️ Ver Ruta en Mapa
            </button>
            
            <div class="ride-actions single">
                <button class="btn btn-success" onclick="${estado.action}('${carrera.id}')">
                    ${estado.icon} ${estado.btn}
                </button>
            </div>
        </div>
    `;
}

async function verRutaEnMapa(carreraId) {
    try {
        const { data } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('id', carreraId)
            .single();
        
        if (data) {
            await mostrarCarreraActivaEnMapa(data);
            await iniciarTrackingCarrera(data);
            mostrarNotificacion('Ruta mostrada en el mapa', 'info');
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function mostrarCarreraActivaEnMapa(carrera) {
    try {
        limpiarMarcadoresColectivas();
        
        const origenMarker = L.marker([carrera.origen_lat, carrera.origen_lng], {
            icon: L.divIcon({ html: '📍', className: 'emoji-marker', iconSize: [30, 30] })
        }).addTo(mapa).bindPopup('<b>Punto de Recogida</b><br>' + carrera.origen_direccion);
        
        const destinoMarker = L.marker([carrera.destino_lat, carrera.destino_lng], {
            icon: L.divIcon({ html: '🏁', className: 'emoji-marker', iconSize: [30, 30] })
        }).addTo(mapa).bindPopup('<b>Destino</b><br>' + carrera.destino_direccion);
        
        marcadoresColectivas.push(origenMarker, destinoMarker);
        
        // Ruta según estado
        if (carrera.estado === 'aceptada' || carrera.estado === 'en_camino') {
            const ruta1 = await calcularRutaOSRM(
                miUbicacion.lng, miUbicacion.lat,
                carrera.origen_lng, carrera.origen_lat
            );
            
            if (ruta1.geometry) {
                const rutaLayer1 = L.geoJSON(ruta1.geometry, {
                    style: { 
                        color: '#ef4444', 
                        weight: 5, 
                        dashArray: '10, 10',
                        opacity: 0.8
                    }
                }).addTo(mapa);
                marcadoresColectivas.push(rutaLayer1);
                ultimaRutaDibujada = ruta1;
            }
        }
        
        const puntoInicio = carrera.estado === 'en_curso' 
            ? { lng: miUbicacion.lng, lat: miUbicacion.lat }
            : { lng: carrera.origen_lng, lat: carrera.origen_lat };
        
        const ruta2 = await calcularRutaOSRM(
            puntoInicio.lng, puntoInicio.lat,
            carrera.destino_lng, carrera.destino_lat
        );
        
        if (ruta2.geometry) {
            const rutaLayer2 = L.geoJSON(ruta2.geometry, {
                style: { 
                    color: '#f59e0b', 
                    weight: 5,
                    opacity: 0.8
                }
            }).addTo(mapa);
            marcadoresColectivas.push(rutaLayer2);
        }
        
        const bounds = L.latLngBounds([
            [miUbicacion.lat, miUbicacion.lng],
            [carrera.origen_lat, carrera.origen_lng],
            [carrera.destino_lat, carrera.destino_lng]
        ]);
        mapa.fitBounds(bounds, { padding: [50, 50] });
        
    } catch (error) {
        console.error('Error mostrando carrera:', error);
    }
}

async function cargarCarrerasCompletadas() {
    try {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        
        const { data } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('conductor_id', conductorId)
            .eq('estado', 'completada')
            .gte('fecha_completado', hoy.toISOString())
            .order('fecha_completado', { ascending: false });
        
        if (!data || data.length === 0) {
            document.getElementById('carrerasCompletadas').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">✅</div>
                    <div class="empty-text">No hay carreras completadas hoy</div>
                </div>
            `;
            return;
        }
        
        let html = '';
        data.forEach(carrera => {
            html += `
                <div class="ride-card">
                    <div class="ride-header">
                        <div class="ride-type">✅ Completada</div>
                        <div class="ride-price">L ${parseFloat(carrera.precio).toFixed(2)}</div>
                    </div>
                    <div class="ride-route">
                        <div class="route-line">
                            <div class="route-dot"></div>
                            <div class="route-dots"></div>
                            <div class="route-dot destination"></div>
                        </div>
                        <div class="route-info">
                            <div class="route-point">
                                <div class="route-address">${carrera.origen_direccion}</div>
                            </div>
                            <div class="route-point">
                                <div class="route-address">${carrera.destino_direccion}</div>
                            </div>
                        </div>
                    </div>
                    <div class="ride-stats">
                        <div class="stat-item">
                            <span>📏</span>
                            <span class="stat-value">${carrera.distancia_km ? carrera.distancia_km.toFixed(1) : '—'} km</span>
                        </div>
                        <div class="stat-item">
                            <span>⏱️</span>
                            <span class="stat-value">${carrera.tiempo_estimado_min || '—'} min</span>
                        </div>
                    </div>
                </div>
            `;
        });
        
        document.getElementById('carrerasCompletadas').innerHTML = html;
        
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================
// ACCIONES
// ============================================

function iniciarTimer(carreraId) {
    const interval = setInterval(() => {
        if (timers[carreraId] !== undefined) {
            timers[carreraId]--;
            const timerEl = document.getElementById(`timer-${carreraId}`);
            if (timerEl) {
                timerEl.textContent = timers[carreraId] + 's';
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

async function aceptarCarrera(id) {
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        await window.supabase
            .from('carreras')
            .update({ 
                estado: 'aceptada',
                fecha_aceptacion: new Date().toISOString()
            })
            .eq('id', id);
        
        delete timers[id];
        await cambiarEstado('en_carrera');
        mostrarNotificacion('¡Carrera aceptada!', 'success');
        reproducirSonido();
        await cargarTodasCarreras();
        cambiarTab('activas');
        
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

async function rechazarCarrera(id, auto = false) {
    try {
        await window.supabase
            .from('carreras')
            .update({ 
                estado: 'rechazada',
                conductor_id: null
            })
            .eq('id', id);
        
        delete timers[id];
        mostrarNotificacion(auto ? 'Carrera expirada' : 'Carrera rechazada', 'info');
        await cargarTodasCarreras();
        
    } catch (error) {
        console.error('Error:', error);
    }
}

async function tomarCarrera(id) {
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        await window.supabase
            .from('carreras')
            .update({ 
                conductor_id: conductorId,
                estado: 'asignada'
            })
            .eq('id', id)
            .is('conductor_id', null);
        
        mostrarNotificacion('¡Carrera tomada!', 'success');
        reproducirSonido();
        await cargarTodasCarreras();
        
    } catch (error) {
        alert('Esta carrera ya fue tomada');
        await cargarTodasCarreras();
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

async function irAlOrigen(id) {
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        await window.supabase
            .from('carreras')
            .update({ 
                estado: 'en_camino',
                fecha_inicio_viaje: new Date().toISOString()
            })
            .eq('id', id);
        
        mostrarNotificacion('En camino al origen 🚗', 'info');
        await cargarTodasCarreras();
        
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

async function clienteAbordado(id) {
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        await window.supabase
            .from('carreras')
            .update({ 
                estado: 'en_curso',
                fecha_inicio: new Date().toISOString()
            })
            .eq('id', id);
        
        mostrarNotificacion('Cliente abordado 👤', 'success');
        await cargarTodasCarreras();
        
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

async function completarCarrera(id) {
    if (!confirm('¿Completar este viaje?')) return;
    
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        await window.supabase
            .from('carreras')
            .update({ 
                estado: 'completada',
                fecha_completado: new Date().toISOString()
            })
            .eq('id', id);
        
        // Detener tracking
        detenerTrackingCarrera();
        limpiarMarcadoresColectivas();
        
        await cambiarEstado('disponible');
        mostrarNotificacion('¡Viaje completado! 🎉', 'success');
        reproducirSonido();
        
        await cargarTodasCarreras();
        await cargarEstadisticas();
        cambiarTab('completadas');
        
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
        
        const { data } = await window.supabase
            .from('carreras')
            .select('precio')
            .eq('conductor_id', conductorId)
            .eq('estado', 'completada')
            .gte('fecha_completado', hoy.toISOString());
        
        const total = data ? data.length : 0;
        const ganancias = data ? data.reduce((sum, c) => sum + parseFloat(c.precio || 0), 0) : 0;
        
        document.getElementById('statCarreras').textContent = total;
        document.getElementById('statGanancias').textContent = 'L ' + ganancias.toFixed(0);
        
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================
// MAPA - CARRERAS DISPONIBLES
// ============================================

function limpiarMarcadoresColectivas() {
    marcadoresColectivas.forEach(m => mapa.removeLayer(m));
    marcadoresColectivas = [];
}

async function mostrarCarrerasEnMapa(carreras) {
    limpiarMarcadoresColectivas();
    
    for (const c of carreras) {
        try {
            const iconoOrigen = c.tipo === 'colectivo' ? '🚐' : '🏍️';
            const markerOrigen = L.marker([c.origen_lat, c.origen_lng], {
                icon: L.divIcon({ 
                    html: iconoOrigen, 
                    className: 'emoji-marker',
                    iconSize: [35, 35]
                })
            }).addTo(mapa);
            
            const markerDestino = L.marker([c.destino_lat, c.destino_lng], {
                icon: L.divIcon({ 
                    html: '🏁', 
                    className: 'emoji-marker',
                    iconSize: [30, 30]
                })
            }).addTo(mapa);
            
            marcadoresColectivas.push(markerOrigen, markerDestino);
            
            const ruta = await calcularRutaOSRM(
                c.origen_lng, c.origen_lat,
                c.destino_lng, c.destino_lat
            );
            
            if (ruta.geometry) {
                const color = c.tipo === 'colectivo' ? '#10b981' : '#f59e0b';
                const rutaLayer = L.geoJSON(ruta.geometry, {
                    style: { 
                        color: color, 
                        weight: 4,
                        opacity: 0.7
                    }
                }).addTo(mapa);
                
                marcadoresColectivas.push(rutaLayer);
            }
            
            markerOrigen.bindPopup(`
                <div style="text-align:center;min-width:150px">
                    <strong>${iconoOrigen} ${c.tipo === 'colectivo' ? 'Colectiva' : 'Directa'}</strong><br>
                    <div style="font-size:0.875rem;margin:0.5rem 0">${c.origen_direccion}</div>
                    <div style="font-size:1.25rem;font-weight:bold;color:#10b981">L ${parseFloat(c.precio).toFixed(2)}</div>
                    <div style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem">
                        📏 ${c.distancia_km ? c.distancia_km.toFixed(1) : '—'} km • 
                        ⏱️ ${c.tiempo_estimado_min || '—'} min
                    </div>
                </div>
            `);
            
        } catch (error) {
            console.error('Error mostrando carrera en mapa:', error);
        }
    }
}

// ============================================
// UI
// ============================================

function inicializarGestos() {
    const sheet = document.getElementById('bottomSheet');
    const header = document.getElementById('sheetHeader');
    let startY, isDragging = false;
    
    header.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        isDragging = true;
    });
    
    header.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const currentY = e.touches[0].clientY;
        const diff = currentY - startY;
        
        if (diff > 50) {
            sheet.classList.remove('expanded');
        } else if (diff < -50) {
            sheet.classList.add('expanded');
        }
    });
    
    header.addEventListener('touchend', () => {
        isDragging = false;
    });
    
    header.addEventListener('click', () => {
        sheet.classList.toggle('expanded');
    });
}

async function cambiarEstado(nuevoEstado) {
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        await window.supabase
            .from('conductores')
            .update({ estado: nuevoEstado })
            .eq('id', conductorId);
        
        conductorData.estado = nuevoEstado;
        actualizarEstadoUI(nuevoEstado);
        
        mostrarNotificacion(
            nuevoEstado === 'disponible' ? '¡Estás disponible!' : 'Estado: Inactivo',
            nuevoEstado === 'disponible' ? 'success' : 'info'
        );
        
        toggleMenu();
        
        if (nuevoEstado === 'disponible') {
            await cargarTodasCarreras();
        }
        
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

function actualizarEstadoUI(estado) {
    const badge = document.getElementById('statusBadge');
    const icon = document.getElementById('statusIcon');
    const text = document.getElementById('statusText');
    
    badge.className = 'status-badge';
    
    if (estado === 'disponible') {
        badge.classList.add('disponible');
        icon.textContent = '🟢';
        text.textContent = 'Disponible';
    } else if (estado === 'en_carrera') {
        badge.classList.add('en-carrera');
        icon.textContent = '🟡';
        text.textContent = 'En carrera';
    } else {
        badge.classList.add('inactivo');
        icon.textContent = '⚪';
        text.textContent = 'Inactivo';
    }
}

function cambiarTab(tab) {
    document.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
    
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(`tab-${tab}`).style.display = 'block';
}

function toggleMenu() {
    document.getElementById('sideMenu').classList.toggle('open');
    document.getElementById('menuOverlay').classList.toggle('show');
}

function expandirCarrera(id) {
    document.getElementById('bottomSheet').classList.add('expanded');
}

function mostrarNotificacion(mensaje, tipo) {
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.textContent = mensaje;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

function reproducirSonido() {
    try {
        document.getElementById('notificationSound').play();
    } catch (e) {}
}

function suscribirseACambios() {
    window.supabase
        .channel('conductor-changes')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'carreras'
        }, async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                const carrera = payload.new;
                
                if (carrera.conductor_id === conductorId && carrera.estado === 'asignada') {
                    mostrarNotificacion('¡Nueva carrera!', 'success');
                    reproducirSonido();
                }
                
                await cargarTodasCarreras();
            }
        })
        .subscribe();
}

async function cerrarSesion() {
    if (confirm('¿Cerrar sesión?')) {
        if (gpsInterval) clearInterval(gpsInterval);
        if (trackingInterval) clearInterval(trackingInterval);
        await cambiarEstado('inactivo');
        await window.supabase.auth.signOut();
        window.location.href = 'login.html';
    }
}

// ============================================
// DEBUG
// ============================================

async function debugCarreras() {
    console.log('=== 🐛 DEBUG ===');
    
    try {
        const { data, error } = await window.supabase
            .from('carreras')
            .select('*')
            .order('fecha_solicitud', { ascending: false })
            .limit(10);
        
        if (error) {
            alert('Error: ' + error.message);
            return;
        }
        
        console.log('Total carreras:', data ? data.length : 0);
        
        if (!data || data.length === 0) {
            alert('❌ No hay carreras en la BD');
            return;
        }
        
        data.forEach((c, i) => {
            console.log(`\nCarrera ${i + 1}:`, c.id, c.tipo, c.estado);
        });
        
        const asignadas = data.filter(c => c.conductor_id === conductorId && c.estado === 'asignada');
        const directas = data.filter(c => c.tipo === 'directo' && !c.conductor_id && ['solicitada', 'buscando'].includes(c.estado));
        const colectivas = data.filter(c => c.tipo === 'colectivo' && !c.conductor_id && ['solicitada', 'buscando'].includes(c.estado));
        const activas = data.filter(c => c.conductor_id === conductorId && ['aceptada', 'en_camino', 'en_curso'].includes(c.estado));
        
        alert(`Total: ${data.length}\nAsignadas: ${asignadas.length}\nDirectas disponibles: ${directas.length}\nColectivas disponibles: ${colectivas.length}\nEn curso: ${activas.length}`);
        
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// INIT
window.addEventListener('load', init);
window.addEventListener('orientationchange', () => {
    setTimeout(() => mapa && mapa.invalidateSize(), 200);
});
