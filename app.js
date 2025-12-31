let mapa, usuario, conductorId, conductorData;
let miUbicacion = null;
let miMarker = null;
let gpsInterval = null;
let trackingInterval = null;
let timers = {};
let marcadoresColectivas = [];
let carreraEnCurso = null;
let ultimaDireccion = 0;


async function init() {
    console.log('=== INICIANDO APP CONDUCTOR (UBER STYLE) ===');
    
    try {
        // Esperar a que Supabase esté listo
        await esperarSupabase();
        
        // Verificar sesión
        const sesionValida = await verificarSesion();
        if (!sesionValida) return;
        
        // Cargar datos del conductor
        await cargarDatosConductor();
        
        // Inicializar componentes
        await inicializarMapa();
        inicializarGPS();
        inicializarGestos();
        
        // Cargar datos
        await cargarTodasCarreras();
        await cargarEstadisticas();
        
        // Tiempo real
        suscribirseACambios();
        
        console.log('=== ✅ APP INICIADA ===');
        document.getElementById('loader').classList.add('hidden');
        
    } catch (error) {
        console.error('=== ❌ ERROR EN INIT ===', error);
        mostrarError('Error al iniciar la aplicación: ' + error.message);
        document.getElementById('loader').classList.add('hidden');
    }
}

async function esperarSupabase() {
    return new Promise((resolve, reject) => {
        if (window.supabaseClient) {
            resolve();
            return;
        }
        
        let intentos = 0;
        const maxIntentos = 50;
        
        const interval = setInterval(() => {
            intentos++;
            
            if (window.supabaseClient) {
                clearInterval(interval);
                console.log('✅ Supabase conectado');
                resolve();
            } else if (intentos >= maxIntentos) {
                clearInterval(interval);
                reject(new Error('Timeout esperando Supabase'));
            }
        }, 100);
    });
}

async function verificarSesion() {
    console.log('2. Verificando sesión...');
    
    try {
        const { data: { session }, error } = await window.supabaseClient.auth.getSession();
        
        if (error) throw error;
        
        if (!session) {
            window.location.href = 'login.html';
            return false;
        }
        
        usuario = session.user;
        console.log('✅ Sesión:', usuario.email);
        
        // Verificar rol
        const { data: perfil, error: perfilError } = await window.supabaseClient
            .from('perfiles')
            .select('nombre, rol')
            .eq('id', usuario.id)
            .single();
        
        if (perfilError) throw perfilError;
        
        if (!perfil || perfil.rol !== 'conductor') {
            alert('No tienes permisos de conductor');
            await window.supabaseClient.auth.signOut();
            window.location.href = 'login.html';
            return false;
        }
        
        console.log('✅ Perfil:', perfil.nombre);
        return true;
        
    } catch (error) {
        console.error('Error verificando sesión:', error);
        throw error;
    }
}

async function cargarDatosConductor() {
    console.log('3. Cargando datos de conductor...');
    
    try {
        const { data: conductor, error } = await window.supabaseClient
            .from('conductores')
            .select('*')
            .eq('perfil_id', usuario.id)
            .single();
        
        if (error) throw error;
        if (!conductor) throw new Error('Registro de conductor no encontrado');
        
        conductorId = conductor.id;
        conductorData = conductor;
        
        console.log('✅ Conductor ID:', conductorId);
        
        // Actualizar UI
        actualizarEstadoUI(conductor.estado);
        
    } catch (error) {
        console.error('Error cargando datos conductor:', error);
        throw error;
    }
}


async function inicializarMapa() {
    try {
        mapa = L.map('map', {
            zoomControl: false,
            attributionControl: false
        }).setView(MAP_CONFIG.defaultCenter, MAP_CONFIG.defaultZoom);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: MAP_CONFIG.maxZoom,
            minZoom: MAP_CONFIG.minZoom
        }).addTo(mapa);
        
        L.control.zoom({
            position: 'bottomright'
        }).addTo(mapa);
        
        // Ajustar tamaño al cargar
        setTimeout(() => mapa.invalidateSize(), 500);
        
        console.log('✅ Mapa inicializado');
        return true;
    } catch (error) {
        console.error('Error inicializando mapa:', error);
        throw error;
    }
}

function inicializarGPS() {
    if (!navigator.geolocation) {
        console.warn('GPS no disponible');
        alert('Tu dispositivo no soporta geolocalización');
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
            
            crearMarcadorRotable();
            iniciarActualizacionGPS();
            guardarUbicacionEnBD();
        },
        (error) => {
            console.error('Error GPS:', error);
            const mensajes = {
                1: 'Por favor activa los permisos de ubicación',
                2: 'No se pudo obtener tu ubicación',
                3: 'Tiempo de espera agotado'
            };
            alert(mensajes[error.code] || 'Error obteniendo ubicación');
        },
        { 
            enableHighAccuracy: true, 
            timeout: 10000,
            maximumAge: 0
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
    const x = Math.cos(lat1) * Math.sin(lat2) - 
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
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
                
                // Actualizar marcador
                crearMarcadorRotable();
                
                // Centrar si no hay carrera activa
                if (!carreraEnCurso) {
                    centrarMapaEnConductor();
                }
                
                // Verificar cambio de ruta si hay carrera
                if (carreraEnCurso) {
                    await verificarCambioRuta();
                }
                
                ubicacionAnterior = { ...miUbicacion };
                
                // Guardar en BD
                if (conductorData && conductorData.estado !== 'inactivo') {
                    await guardarUbicacionEnBD();
                }
            },
            (error) => console.warn('Error actualizando GPS:', error),
            { enableHighAccuracy: true, maximumAge: 0 }
        );
    }, 3000);
}

function centrarMapaEnConductor() {
    if (!miUbicacion || !mapa) return;
    
    mapa.setView([miUbicacion.lat, miUbicacion.lng], 15, {
        animate: true,
        duration: MAP_CONFIG.autoCenterDuration
    });
}

async function guardarUbicacionEnBD() {
    if (!miUbicacion || !conductorId) return;
    
    try {
        const { error } = await window.supabaseClient
            .from('conductores')
            .update({
                latitud: miUbicacion.lat,
                longitud: miUbicacion.lng,
                ultima_actualizacion: new Date().toISOString()
            })
            .eq('id', conductorId);
        
        if (error) throw error;
    } catch (error) {
        console.warn('Error guardando ubicación:', error);
    }
}

async function iniciarTrackingCarrera(carrera) {
    carreraEnCurso = carrera;
    
    if (trackingInterval) clearInterval(trackingInterval);
    
    console.log('Iniciando tracking para carrera:', carrera.id);
    
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
        
        let minutosHastaOrigen = 0;
        let horaLlegadaOrigen = '';
        
        // Si va hacia el origen
        if (estado === 'aceptada' || estado === 'en_camino') {
            const rutaOrigen = await calcularRutaOSRM(
                miUbicacion.lng, miUbicacion.lat,
                carreraEnCurso.origen_lng, carreraEnCurso.origen_lat
            );
            
            if (rutaOrigen.distance && rutaOrigen.duration) {
                const kmOrigen = (rutaOrigen.distance / 1000).toFixed(1);
                minutosHastaOrigen = Math.round((rutaOrigen.duration / 60) * MAP_CONFIG.multiplicadorTrafico);
                horaLlegadaOrigen = calcularHoraLlegada(minutosHastaOrigen);
                
                actualizarUITracking('origen', kmOrigen, minutosHastaOrigen, horaLlegadaOrigen);
            }
        }
        
        // Calcular ruta al destino
        const puntoInicio = estado === 'en_curso' 
            ? { lng: miUbicacion.lng, lat: miUbicacion.lat }
            : { lng: carreraEnCurso.origen_lng, lat: carreraEnCurso.origen_lat };
        
        const rutaDestino = await calcularRutaOSRM(
            puntoInicio.lng, puntoInicio.lat,
            carreraEnCurso.destino_lng, carreraEnCurso.destino_lat
        );
        
        if (rutaDestino.distance && rutaDestino.duration) {
            const kmDestino = (rutaDestino.distance / 1000).toFixed(1);
            const minDestino = Math.round((rutaDestino.duration / 60) * MAP_CONFIG.multiplicadorTrafico);
            
            let horaLlegadaDestino;
            if (estado === 'en_curso') {
                horaLlegadaDestino = calcularHoraLlegada(minDestino);
            } else {
                const tiempoTotal = minutosHastaOrigen + minDestino;
                horaLlegadaDestino = calcularHoraLlegada(tiempoTotal);
            }
            
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
            Math.abs(nuevaRuta.distance - ultimaRutaDibujada.distance) > 500;
        
        if (cambioSignificativo) {
            contadorCambioRuta++;
            console.log(`🔄 Cambio de ruta detectado (#${contadorCambioRuta})`);
            
            ultimaRutaDibujada = nuevaRuta;
            await mostrarCarreraActivaEnMapa(carreraEnCurso);
            mostrarNotificacion('Ruta actualizada', 'info');
        }
        
    } catch (error) {
        console.error('Error verificando cambio de ruta:', error);
    }
}

async function calcularRutaOSRM(lng1, lat1, lng2, lat2) {
    try {
        const url = `${MAP_CONFIG.osrmServer}/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        
        if (!res.ok) throw new Error('Error en OSRM');
        
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
        
        // Query 1: Asignadas a mí
        const { data: asignadas, error: errorAsignadas } = await window.supabaseClient
            .from('carreras')
            .select('*, clientes!inner(nombre, telefono)')
            .eq('conductor_id', conductorId)
            .eq('estado', 'asignada');
        
        if (errorAsignadas) console.error('Error asignadas:', errorAsignadas);
        
        // Query 2: Directas disponibles
        const { data: directas, error: errorDirectas } = await window.supabaseClient
            .from('carreras')
            .select('*, clientes!inner(nombre, telefono)')
            .eq('tipo', 'directo')
            .in('estado', ['solicitada', 'buscando'])
            .is('conductor_id', null)
            .limit(10);
        
        if (errorDirectas) console.error('Error directas:', errorDirectas);
        
        // Query 3: Colectivas disponibles
        const { data: colectivas, error: errorColectivas } = await window.supabaseClient
            .from('carreras')
            .select('*, clientes!inner(nombre, telefono)')
            .eq('tipo', 'colectivo')
            .in('estado', ['solicitada', 'buscando'])
            .is('conductor_id', null)
            .limit(20);
        
        if (errorColectivas) console.error('Error colectivas:', errorColectivas);
        
        const todas = [
            ...(asignadas || []), 
            ...(directas || []),
            ...(colectivas || [])
        ];
        
        console.log('Total carreras:', todas.length);
        
        if (todas.length === 0) {
            document.getElementById('carrerasDisponibles').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🏍️</div>
                    <div class="empty-text">No hay carreras disponibles</div>
                    <p style="font-size:0.75rem;color:#9ca3af;margin-top:0.5rem">
                        Las carreras aparecerán aquí automáticamente
                    </p>
                </div>
            `;
            document.getElementById('badgeDisponibles').style.display = 'none';
            limpiarMarcadoresColectivas();
            return;
        }
        
        // Renderizar carreras
        let html = '';
        todas.forEach(carrera => {
            html += renderCarreraDisponible(carrera);
        });
        
        document.getElementById('carrerasDisponibles').innerHTML = html;
        document.getElementById('badgeDisponibles').textContent = todas.length;
        document.getElementById('badgeDisponibles').style.display = 'block';
        
        // Calcular distancias
        for (const carrera of todas) {
            await calcularDistanciasCard(carrera);
        }
        
        console.log('✅ Carreras disponibles listas');
        
    } catch (error) {
        console.error('=== ERROR EN cargarCarrerasDisponibles ===', error);
        mostrarError('Error cargando carreras: ' + error.message);
    }
}

function renderCarreraDisponible(carrera) {
    const esColectiva = carrera.tipo === 'colectivo';
    const esNueva = carrera.conductor_id === conductorId;
    const clienteNombre = carrera.clientes?.nombre || 'Cliente';
    
    const cardId = `card-${carrera.id}`;
    
    let html = `
        <div class="ride-card ${esNueva ? 'nueva' : ''}" id="${cardId}">
            <div class="ride-header">
                <div class="ride-type">
                    ${esColectiva ? '🚌 Colectiva' : '🏍️ Directa'}
                </div>
                <div class="ride-price">L ${parseFloat(carrera.precio).toFixed(2)}</div>
            </div>
            
            <div style="background:#f3f4f6;padding:0.5rem 0.75rem;border-radius:0.5rem;margin-bottom:0.75rem">
                <div style="font-size:0.875rem;font-weight:600;color:#111827">
                    👤 ${clienteNombre}
                </div>
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
            
            <div style="background:#fef3c7;padding:0.75rem;border-radius:0.5rem;margin-bottom:0.5rem">
                <div style="font-size:0.625rem;color:#92400e;font-weight:600;margin-bottom:0.25rem;text-transform:uppercase">Hasta Recogida</div>
                <div style="display:flex;gap:0.75rem;font-size:0.875rem;color:#92400e;flex-wrap:wrap">
                    <div>📍 <span id="${cardId}-dist-origen" style="font-weight:700">...</span> km</div>
                    <div>⏱️ <span id="${cardId}-time-origen" style="font-weight:700">...</span> min</div>
                    <div>🕐 <span id="${cardId}-hora-origen" style="font-weight:700">...</span></div>
                </div>
            </div>
            
            <div style="background:#dbeafe;padding:0.75rem;border-radius:0.5rem;margin-bottom:0.75rem">
                <div style="font-size:0.625rem;color:#1e40af;font-weight:600;margin-bottom:0.25rem;text-transform:uppercase">Distancia del Viaje</div>
                <div style="display:flex;gap:0.75rem;font-size:0.875rem;color:#1e40af;flex-wrap:wrap">
                    <div>📍 <span style="font-weight:700">${carrera.distancia_km ? carrera.distancia_km.toFixed(1) : '—'}</span> km</div>
                    <div>⏱️ <span style="font-weight:700">${carrera.tiempo_estimado_min || '—'}</span> min</div>
                    <div>🏁 <span id="${cardId}-hora-destino" style="font-weight:700">...</span></div>
                    ${esColectiva ? '<div style="color:#10b981;font-weight:700">✨ 30% OFF</div>' : ''}
                </div>
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

async function calcularDistanciasCard(carrera) {
    if (!miUbicacion) {
        console.warn('No hay ubicación GPS para calcular distancias');
        return;
    }
    
    const cardId = `card-${carrera.id}`;
    
    try {
        const rutaOrigen = await calcularRutaOSRM(
            miUbicacion.lng, miUbicacion.lat,
            carrera.origen_lng, carrera.origen_lat
        );
        
        if (rutaOrigen.distance && rutaOrigen.duration) {
            const kmOrigen = (rutaOrigen.distance / 1000).toFixed(1);
            const minOrigen = Math.round((rutaOrigen.duration / 60) * MAP_CONFIG.multiplicadorTrafico);
            const horaLlegadaOrigen = calcularHoraLlegada(minOrigen);
            
            const elemDist = document.getElementById(`${cardId}-dist-origen`);
            const elemTime = document.getElementById(`${cardId}-time-origen`);
            const elemHora = document.getElementById(`${cardId}-hora-origen`);
            
            if (elemDist) elemDist.textContent = kmOrigen;
            if (elemTime) elemTime.textContent = minOrigen;
            if (elemHora) elemHora.textContent = horaLlegadaOrigen;
            
            // Calcular hora de llegada al destino
            const minViaje = carrera.tiempo_estimado_min || 0;
            const tiempoTotal = minOrigen + minViaje;
            const horaLlegadaDestino = calcularHoraLlegada(tiempoTotal);
            
            const elemHoraDestino = document.getElementById(`${cardId}-hora-destino`);
            if (elemHoraDestino) {
                elemHoraDestino.textContent = horaLlegadaDestino;
            }
        }
        
    } catch (error) {
        console.error('Error calculando distancias para card:', error);
    }
}

async function cargarCarrerasActivas() {
    try {
        console.log('=== CARGANDO CARRERAS ACTIVAS ===');
        
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .select('*, clientes!inner(nombre, telefono)')
            .eq('conductor_id', conductorId)
            .in('estado', ['aceptada', 'en_curso']);
        
        if (error) throw error;
        
        console.log('Carreras activas encontradas:', data ? data.length : 0);
        
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
        
        // Tracking de la primera
        if (data.length > 0 && miUbicacion) {
            await mostrarCarreraActivaEnMapa(data[0]);
            await iniciarTrackingCarrera(data[0]);
        }
        
        console.log('✅ Carreras activas cargadas');
        
    } catch (error) {
        console.error('Error cargando activas:', error);
        mostrarError('Error cargando carreras activas');
    }
}

function renderCarreraActiva(carrera) {
    const clienteNombre = carrera.clientes?.nombre || 'Cliente';
    const mostrarOrigen = carrera.estado === 'aceptada';
    
    let botonHTML = '';
    if (carrera.estado === 'aceptada') {
        botonHTML = `
            <button class="btn btn-success" onclick="pasajeroRecogido('${carrera.id}')">
                👤 Pasajero Recogido
            </button>
        `;
    } else if (carrera.estado === 'en_curso') {
        botonHTML = `
            <button class="btn btn-primary" onclick="completarCarrera('${carrera.id}')">
                ✅ Completar Viaje
            </button>
        `;
    }
    
    return `
        <div class="ride-card" style="border-left: 4px solid #2563eb">
            <div class="ride-header">
                <div class="ride-type">🚗 En curso</div>
                <div class="ride-price">L ${parseFloat(carrera.precio).toFixed(2)}</div>
            </div>
            
            <div style="background:#f3f4f6;padding:0.5rem 0.75rem;border-radius:0.5rem;margin-bottom:0.75rem">
                <div style="font-size:0.875rem;font-weight:600;color:#111827">
                    👤 ${clienteNombre}
                </div>
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
                ${botonHTML}
            </div>
        </div>
    `;
}

async function verRutaEnMapa(carreraId) {
    try {
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .select('*')
            .eq('id', carreraId)
            .single();
        
        if (error) throw error;
        
        if (data) {
            await mostrarCarreraActivaEnMapa(data);
            await iniciarTrackingCarrera(data);
            mostrarNotificacion('Ruta mostrada en el mapa', 'info');
        }
    } catch (error) {
        mostrarError('Error mostrando ruta: ' + error.message);
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
        mapa.fitBounds(bounds, { 
            padding: [50, 50],
            maxZoom: 15
        });
        
    } catch (error) {
        console.error('Error mostrando carrera:', error);
    }
}

async function cargarCarrerasCompletadas() {
    try {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .select('*')
            .eq('conductor_id', conductorId)
            .eq('estado', 'completada')
            .gte('fecha_completado', hoy.toISOString())
            .order('fecha_completado', { ascending: false });
        
        if (error) throw error;
        
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
                            <span>📍</span>
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
        console.error('Error cargando completadas:', error);
    }
}

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
        
        const { error } = await window.supabaseClient
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
        await cargarTodasCarreras();
        cambiarTab('activas');
        
    } catch (error) {
        mostrarError('Error aceptando carrera: ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

async function rechazarCarrera(id, auto = false) {
    try {
        const { error } = await window.supabaseClient
            .from('carreras')
            .update({ 
                estado: 'rechazada',
                conductor_id: null
            })
            .eq('id', id);
        
        if (error) throw error;
        
        delete timers[id];
        mostrarNotificacion(auto ? 'Carrera expirada' : 'Carrera rechazada', 'info');
        await cargarTodasCarreras();
        
    } catch (error) {
        console.error('Error rechazando:', error);
    }
}

async function tomarCarrera(id) {
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .update({ 
                conductor_id: conductorId,
                estado: 'aceptada',
                fecha_aceptacion: new Date().toISOString()
            })
            .eq('id', id)
            .is('conductor_id', null)
            .select('*, clientes!inner(nombre, telefono)')
            .single();
        
        if (error) throw error;
        
        await cambiarEstado('en_carrera');
        mostrarNotificacion('¡Carrera tomada!', 'success');
        reproducirSonido();
        
        await mostrarCarreraActivaEnMapa(data);
        await iniciarTrackingCarrera(data);
        
        await cargarTodasCarreras();
        cambiarTab('activas');
        
    } catch (error) {
        console.error('Error tomando carrera:', error);
        mostrarError('Esta carrera ya fue tomada o hubo un error');
        await cargarTodasCarreras();
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

async function pasajeroRecogido(id) {
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .update({ 
                estado: 'en_curso',
                fecha_inicio: new Date().toISOString()
            })
            .eq('id', id)
            .select('*, clientes!inner(nombre, telefono)')
            .single();
        
        if (error) throw error;
        
        mostrarNotificacion('Pasajero a bordo 👤', 'success');
        
        await mostrarCarreraActivaEnMapa(data);
        await iniciarTrackingCarrera(data);
        
        await cargarTodasCarreras();
        
    } catch (error) {
        mostrarError('Error: ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

async function completarCarrera(id) {
    if (!confirm('¿Completar este viaje?')) return;
    
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        const { error } = await window.supabaseClient
            .from('carreras')
            .update({ 
                estado: 'completada',
                fecha_completado: new Date().toISOString()
            })
            .eq('id', id);
        
        if (error) throw error;
        
        detenerTrackingCarrera();
        limpiarMarcadoresColectivas();
        
        await cambiarEstado('disponible');
        mostrarNotificacion('¡Viaje completado! 🎉', 'success');
        reproducirSonido();
        
        await cargarTodasCarreras();
        await cargarEstadisticas();
        cambiarTab('completadas');
        
    } catch (error) {
        mostrarError('Error: ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

async function cargarEstadisticas() {
    try {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .select('precio')
            .eq('conductor_id', conductorId)
            .eq('estado', 'completada')
            .gte('fecha_completado', hoy.toISOString());
        
        if (error) throw error;
        
        const total = data ? data.length : 0;
        const ganancias = data ? data.reduce((sum, c) => sum + parseFloat(c.precio || 0), 0) : 0;
        
        document.getElementById('statCarreras').textContent = total;
        document.getElementById('statGanancias').textContent = 'L ' + ganancias.toFixed(0);
        
    } catch (error) {
        console.error('Error cargando estadísticas:', error);
    }
}


function limpiarMarcadoresColectivas() {
    marcadoresColectivas.forEach(m => mapa.removeLayer(m));
    marcadoresColectivas = [];
}


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
        
        const { error } = await window.supabaseClient
            .from('conductores')
            .update({ estado: nuevoEstado })
            .eq('id', conductorId);
        
        if (error) throw error;
        
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
        mostrarError('Error cambiando estado: ' + error.message);
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

function mostrarNotificacion(mensaje, tipo) {
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.textContent = mensaje;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

function mostrarError(mensaje) {
    alert(mensaje);
    console.error(mensaje);
}

function reproducirSonido() {
    try {
        document.getElementById('notificationSound').play();
    } catch (e) {
        console.warn('No se pudo reproducir sonido:', e);
    }
}

function suscribirseACambios() {
    console.log('Suscribiéndose a cambios en tiempo real...');
    
    window.supabaseClient
        .channel('conductor-realtime')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'carreras'
        }, async (payload) => {
            console.log('✅ Nueva carrera insertada:', payload.new.id);
            mostrarNotificacion('Nueva carrera disponible', 'info');
            reproducirSonido();
            await cargarCarrerasDisponibles();
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'carreras'
        }, async (payload) => {
            const carrera = payload.new;
            console.log('✅ Carrera actualizada:', carrera.id, carrera.estado);
            
            if (carrera.conductor_id === conductorId && carrera.estado === 'asignada') {
                mostrarNotificacion('¡Nueva carrera asignada!', 'success');
                reproducirSonido();
            }
            
            await cargarTodasCarreras();
        })
        .subscribe((status) => {
            console.log('Estado suscripción:', status);
            if (status === 'SUBSCRIBED') {
                console.log('✅ Suscripción activa');
            }
        });
}

async function cerrarSesion() {
    if (confirm('¿Cerrar sesión?')) {
        if (gpsInterval) clearInterval(gpsInterval);
        if (trackingInterval) clearInterval(trackingInterval);
        await cambiarEstado('inactivo');
        await window.supabaseClient.auth.signOut();
        window.location.href = 'login.html';
    }
}


async function debugCarreras() {
    console.log('=== 🛠 DEBUG ===');
    
    try {
        const { data, error } = await window.supabaseClient
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

window.addEventListener('load', init);

window.addEventListener('orientationchange', () => {
    setTimeout(() => mapa && mapa.invalidateSize(), 200);
});

// Manejo de errores global
window.addEventListener('error', (event) => {
    console.error('Error global:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Promise no manejada:', event.reason);
});

console.log('📱 App.js conductor cargado');
