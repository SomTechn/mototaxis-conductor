// ============================================
// VARIABLES GLOBALES
// ============================================

let mapa, usuario, conductorId, conductorData;
let miUbicacion = null;
let miMarker = null;
let gpsInterval = null;
let timers = {};
let marcadoresColectivas = [];
let marcadoresCarreras = {};

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
        
        if (sessionError) {
            console.error('Error de sesión:', sessionError);
            throw sessionError;
        }
        
        if (!session) {
            console.log('No hay sesión, redirigiendo...');
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
        
        if (perfilError) {
            console.error('Error perfil:', perfilError);
            throw perfilError;
        }
        
        if (!perfil) {
            throw new Error('Perfil no encontrado');
        }
        
        if (perfil.rol !== 'conductor') {
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
        
        if (conductorError) {
            console.error('Error conductor:', conductorError);
            throw conductorError;
        }
        
        if (!conductor) {
            throw new Error('Registro de conductor no encontrado');
        }
        
        conductorId = conductor.id;
        conductorData = conductor;
        console.log('✅ Conductor ID:', conductorId);
        
        // Actualizar UI
        console.log('5. Actualizando UI...');
        actualizarEstadoUI(conductor.estado);
        
        // Inicializar mapa
        console.log('6. Inicializando mapa...');
        await inicializarMapa();
        
        // Inicializar GPS
        console.log('7. Inicializando GPS...');
        inicializarGPS(); // No await - es async pero no bloqueante
        
        // Gestos
        console.log('8. Inicializando gestos...');
        inicializarGestos();
        
        // Cargar carreras
        console.log('9. Cargando carreras...');
        await cargarTodasCarreras();
        
        // Estadísticas
        console.log('10. Cargando estadísticas...');
        await cargarEstadisticas();
        
        // Suscribirse
        console.log('11. Suscribiéndose a cambios...');
        suscribirseACambios();
        
        console.log('=== ✅ APP INICIADA ===');
        document.getElementById('loader').classList.add('hidden');
        
    } catch (error) {
        console.error('=== ❌ ERROR EN INIT ===');
        console.error('Error completo:', error);
        console.error('Stack:', error.stack);
        alert('Error al iniciar: ' + error.message);
        document.getElementById('loader').classList.add('hidden');
    }
}

// ============================================
// MAPA
// ============================================

async function inicializarMapa() {
    try {
        console.log('Creando mapa...');
        mapa = L.map('map', {
            zoomControl: false
        }).setView([14.0723, -87.1921], 13);
        
        console.log('Agregando tiles...');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 18
        }).addTo(mapa);
        
        // Control de zoom personalizado
        L.control.zoom({
            position: 'bottomright'
        }).addTo(mapa);
        
        console.log('Redimensionando mapa...');
        setTimeout(() => {
            try {
                mapa.invalidateSize();
                console.log('✅ Mapa inicializado correctamente');
            } catch (e) {
                console.warn('Error redimensionando:', e);
            }
        }, 500);
        
        return true;
    } catch (error) {
        console.error('Error inicializando mapa:', error);
        throw error;
    }
}

// ============================================
// GPS
// ============================================

function inicializarGPS() {
    if (!navigator.geolocation) {
        console.warn('GPS no disponible en este dispositivo');
        return;
    }
    
    console.log('Solicitando ubicación GPS...');
    
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            miUbicacion = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude
            };
            
            console.log('✅ GPS activado:', miUbicacion);
            
            mapa.setView([miUbicacion.lat, miUbicacion.lng], 15);
            
            miMarker = L.marker([miUbicacion.lat, miUbicacion.lng], {
                icon: L.divIcon({
                    html: '🛺',
                    className: 'emoji-marker',
                    iconSize: [40, 40]
                }),
                zIndexOffset: 1000
            }).addTo(mapa);
            
            iniciarActualizacionGPS();
            guardarUbicacionEnBD();
        },
        (error) => {
            console.error('Error GPS:', error);
            console.warn('Continuando sin GPS preciso');
            // No bloquear la app, solo advertir
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
    
    gpsInterval = setInterval(async () => {
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                miUbicacion = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude
                };
                
                if (miMarker) {
                    miMarker.setLatLng([miUbicacion.lat, miUbicacion.lng]);
                }
                
                if (conductorData.estado !== 'inactivo') {
                    await guardarUbicacionEnBD();
                }
            },
            () => {},
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
    } catch (error) {
        console.warn('Error guardando ubicación:', error);
    }
}

// ============================================
// GESTOS
// ============================================

function inicializarGestos() {
    const sheet = document.getElementById('bottomSheet');
    const header = document.getElementById('sheetHeader');
    let startY, currentY, isDragging = false;
    
    header.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        isDragging = true;
    });
    
    header.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
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
    
    // Click en handle para expandir/contraer
    header.addEventListener('click', () => {
        sheet.classList.toggle('expanded');
    });
}

// ============================================
// ESTADO
// ============================================

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
            nuevoEstado === 'disponible' ? '¡Estás disponible!' : 'Modo inactivo',
            'success'
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
        console.log('Conductor ID:', conductorId);
        console.log('Estado conductor:', conductorData.estado);
        
        // Carreras asignadas a mí pendientes
        console.log('Buscando carreras asignadas...');
        const { data: asignadas, error: errorAsignadas } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('conductor_id', conductorId)
            .eq('estado', 'asignada');
        
        if (errorAsignadas) {
            console.error('Error asignadas:', errorAsignadas);
        } else {
            console.log('Carreras asignadas encontradas:', asignadas ? asignadas.length : 0);
            if (asignadas) console.log('Detalles asignadas:', asignadas);
        }
        
        // Carreras directas sin conductor disponibles para tomar
        console.log('Buscando carreras directas disponibles...');
        const { data: directas, error: errorDirectas } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('tipo', 'directo')
            .in('estado', ['solicitada', 'buscando'])
            .is('conductor_id', null)
            .limit(10);
        
        if (errorDirectas) {
            console.error('Error directas:', errorDirectas);
        } else {
            console.log('Carreras directas encontradas:', directas ? directas.length : 0);
            if (directas) console.log('Detalles directas:', directas);
        }
        
        // Carreras colectivas sin conductor
        console.log('Buscando carreras colectivas...');
        const { data: colectivas, error: errorColectivas } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('tipo', 'colectivo')
            .in('estado', ['solicitada', 'buscando'])
            .is('conductor_id', null)
            .limit(20);
        
        if (errorColectivas) {
            console.error('Error colectivas:', errorColectivas);
        } else {
            console.log('Carreras colectivas encontradas:', colectivas ? colectivas.length : 0);
            if (colectivas) console.log('Detalles colectivas:', colectivas);
        }
        
        // Combinar todas
        const todas = [
            ...(asignadas || []), 
            ...(directas || []),
            ...(colectivas || [])
        ];
        
        console.log('Total carreras disponibles:', todas.length);
        
        if (todas.length === 0) {
            console.log('No hay carreras, mostrando empty state');
            document.getElementById('carrerasDisponibles').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🏍️</div>
                    <div class="empty-text">No hay carreras disponibles</div>
                    <p style="font-size:0.75rem;color:#9ca3af;margin-top:0.5rem">
                        Las carreras aparecerán aquí cuando estés disponible
                    </p>
                </div>
            `;
            document.getElementById('badgeDisponibles').style.display = 'none';
            limpiarMarcadoresColectivas();
            return;
        }
        
        console.log('Renderizando', todas.length, 'carreras...');
        let html = '';
        todas.forEach((carrera, index) => {
            console.log(`Renderizando carrera ${index + 1}:`, carrera.id, carrera.tipo, carrera.estado);
            html += renderCarreraDisponible(carrera);
        });
        
        document.getElementById('carrerasDisponibles').innerHTML = html;
        document.getElementById('badgeDisponibles').textContent = todas.length;
        document.getElementById('badgeDisponibles').style.display = 'block';
        
        console.log('✅ Carreras disponibles mostradas');
        
        // Mostrar todas en mapa (colectivas Y directas)
        const paraMapa = [...(directas || []), ...(colectivas || [])];
        if (paraMapa.length > 0) {
            console.log('Mostrando', paraMapa.length, 'carreras en mapa');
            mostrarCarrerasEnMapa(paraMapa);
        }
        
    } catch (error) {
        console.error('=== ERROR CARGANDO CARRERAS ===');
        console.error('Error completo:', error);
        console.error('Stack:', error.stack);
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
        console.log('=== CARGANDO CARRERAS ACTIVAS ===');
        
        const { data, error } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('conductor_id', conductorId)
            .in('estado', ['aceptada', 'en_camino', 'en_curso']);
        
        if (error) {
            console.error('Error:', error);
            throw error;
        }
        
        console.log('Carreras activas encontradas:', data ? data.length : 0);
        
        if (!data || data.length === 0) {
            document.getElementById('carrerasActivas').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🚗</div>
                    <div class="empty-text">No tienes carreras en curso</div>
                </div>
            `;
            document.getElementById('badgeActivas').style.display = 'none';
            return;
        }
        
        let html = '';
        data.forEach(carrera => {
            html += renderCarreraActiva(carrera);
        });
        
        document.getElementById('carrerasActivas').innerHTML = html;
        document.getElementById('badgeActivas').textContent = data.length;
        document.getElementById('badgeActivas').style.display = 'block';
        
        // Mostrar la primera carrera activa en el mapa con ruta
        if (data.length > 0 && miUbicacion) {
            console.log('Mostrando carrera activa en mapa...');
            await mostrarCarreraActivaEnMapa(data[0]);
        }
        
        console.log('✅ Carreras activas cargadas');
        
    } catch (error) {
        console.error('Error cargando activas:', error);
    }
}

async function mostrarCarreraActivaEnMapa(carrera) {
    try {
        console.log('Dibujando ruta de carrera activa:', carrera.id);
        
        // Limpiar marcadores anteriores
        limpiarMarcadoresColectivas();
        
        // Marcadores
        const origenMarker = L.marker([carrera.origen_lat, carrera.origen_lng], {
            icon: L.divIcon({ html: '📍', className: 'emoji-marker', iconSize: [30, 30] })
        }).addTo(mapa).bindPopup('<b>Punto de Recogida</b><br>' + carrera.origen_direccion);
        
        const destinoMarker = L.marker([carrera.destino_lat, carrera.destino_lng], {
            icon: L.divIcon({ html: '🏁', className: 'emoji-marker', iconSize: [30, 30] })
        }).addTo(mapa).bindPopup('<b>Destino</b><br>' + carrera.destino_direccion);
        
        marcadoresColectivas.push(origenMarker, destinoMarker);
        
        // Ruta 1: Mi ubicación → Origen (roja punteada)
        if (carrera.estado === 'aceptada' || carrera.estado === 'en_camino') {
            const ruta1 = await calcularRutaOSRM(
                miUbicacion.lng, miUbicacion.lat,
                carrera.origen_lng, carrera.origen_lat
            );
            
            if (ruta1.geometry) {
                const km1 = (ruta1.distance / 1000).toFixed(1);
                const min1 = Math.round(ruta1.duration / 60 * 1.3);
                
                const rutaLayer1 = L.geoJSON(ruta1.geometry, {
                    style: { 
                        color: '#ef4444', 
                        weight: 5, 
                        dashArray: '10, 10',
                        opacity: 0.8
                    }
                }).addTo(mapa).bindPopup(`
                    <b>Hacia punto de recogida</b><br>
                    📏 ${km1} km<br>
                    ⏱️ ${min1} min
                `);
                
                marcadoresColectivas.push(rutaLayer1);
            }
        }
        
        // Ruta 2: Origen → Destino (naranja sólida)
        const ruta2 = await calcularRutaOSRM(
            carrera.origen_lng, carrera.origen_lat,
            carrera.destino_lng, carrera.destino_lat
        );
        
        if (ruta2.geometry) {
            const km2 = (ruta2.distance / 1000).toFixed(1);
            const min2 = Math.round(ruta2.duration / 60 * 1.3);
            
            const rutaLayer2 = L.geoJSON(ruta2.geometry, {
                style: { 
                    color: '#f59e0b', 
                    weight: 5,
                    opacity: 0.8
                }
            }).addTo(mapa).bindPopup(`
                <b>Ruta del viaje</b><br>
                📏 ${km2} km<br>
                ⏱️ ${min2} min
            `);
            
            marcadoresColectivas.push(rutaLayer2);
        }
        
        // Ajustar vista del mapa
        const bounds = L.latLngBounds([
            [miUbicacion.lat, miUbicacion.lng],
            [carrera.origen_lat, carrera.origen_lng],
            [carrera.destino_lat, carrera.destino_lng]
        ]);
        mapa.fitBounds(bounds, { padding: [50, 50] });
        
        console.log('✅ Carrera activa mostrada en mapa');
        
    } catch (error) {
        console.error('Error mostrando carrera activa en mapa:', error);
    }
}

function renderCarreraActiva(carrera) {
    const estados = {
        'aceptada': { btn: 'Ir al Origen', action: 'irAlOrigen', icon: '🚀' },
        'en_camino': { btn: 'Cliente Abordado', action: 'clienteAbordado', icon: '👤' },
        'en_curso': { btn: 'Completar', action: 'completarCarrera', icon: '✅' }
    };
    
    const estado = estados[carrera.estado];
    
    return `
        <div class="ride-card">
            <div class="ride-header">
                <div class="ride-type">🏁 En curso</div>
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
        console.log('Buscando carrera para mostrar en mapa:', carreraId);
        
        const { data, error } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('id', carreraId)
            .single();
        
        if (error) throw error;
        if (!data) throw new Error('Carrera no encontrada');
        
        await mostrarCarreraActivaEnMapa(data);
        mostrarNotificacion('Ruta mostrada en el mapa', 'info');
        
    } catch (error) {
        console.error('Error:', error);
        alert('Error mostrando ruta: ' + error.message);
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
            html += renderCarreraCompletada(carrera);
        });
        
        document.getElementById('carrerasCompletadas').innerHTML = html;
        
    } catch (error) {
        console.error('Error:', error);
    }
}

function renderCarreraCompletada(carrera) {
    return `
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
}

// ============================================
// MAPA - COLECTIVAS
// ============================================

function limpiarMarcadoresColectivas() {
    marcadoresColectivas.forEach(m => mapa.removeLayer(m));
    marcadoresColectivas = [];
}

async function mostrarCarrerasEnMapa(carreras) {
    limpiarMarcadoresColectivas();
    
    console.log('Mostrando', carreras.length, 'carreras en mapa con rutas');
    
    for (const c of carreras) {
        try {
            // Marcador de origen
            const iconoOrigen = c.tipo === 'colectivo' ? '🚐' : '🏍️';
            const markerOrigen = L.marker([c.origen_lat, c.origen_lng], {
                icon: L.divIcon({ 
                    html: iconoOrigen, 
                    className: 'emoji-marker',
                    iconSize: [35, 35]
                })
            }).addTo(mapa);
            
            // Marcador de destino
            const markerDestino = L.marker([c.destino_lat, c.destino_lng], {
                icon: L.divIcon({ 
                    html: '🏁', 
                    className: 'emoji-marker',
                    iconSize: [30, 30]
                })
            }).addTo(mapa);
            
            marcadoresColectivas.push(markerOrigen, markerDestino);
            
            // Dibujar ruta entre origen y destino
            try {
                const ruta = await calcularRutaOSRM(
                    c.origen_lng, c.origen_lat,
                    c.destino_lng, c.destino_lat
                );
                
                if (ruta.geometry) {
                    const color = c.tipo === 'colectivo' ? '#10b981' : '#f59e0b';
                    const km = (ruta.distance / 1000).toFixed(1);
                    const min = Math.round(ruta.duration / 60 * 1.3);
                    
                    const rutaLayer = L.geoJSON(ruta.geometry, {
                        style: { 
                            color: color, 
                            weight: 4,
                            opacity: 0.7
                        }
                    }).addTo(mapa);
                    
                    rutaLayer.bindPopup(`
                        <div style="text-align:center">
                            <strong>${iconoOrigen} ${c.tipo === 'colectivo' ? 'Colectiva' : 'Directa'}</strong><br>
                            <div style="font-size:1.25rem;font-weight:bold;color:${color};margin:0.5rem 0">L ${parseFloat(c.precio).toFixed(2)}</div>
                            <div style="font-size:0.875rem">📏 ${km} km • ⏱️ ${min} min</div>
                        </div>
                    `);
                    
                    marcadoresColectivas.push(rutaLayer);
                }
            } catch (error) {
                console.warn('Error dibujando ruta para carrera', c.id, error);
            }
            
            // Popup en origen con info completa
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
            console.error('Error mostrando carrera', c.id, 'en mapa:', error);
        }
    }
    
    console.log(`✅ ${carreras.length} carreras mostradas en mapa con rutas`);
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
        await window.supabase
            .from('carreras')
            .update({ 
                estado: 'en_camino',
                fecha_inicio_viaje: new Date().toISOString()
            })
            .eq('id', id);
        
        mostrarNotificacion('En camino 🚗', 'info');
        await cargarTodasCarreras();
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function clienteAbordado(id) {
    try {
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
    }
}

async function completarCarrera(id) {
    if (!confirm('¿Completar esta carrera?')) return;
    
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        await window.supabase
            .from('carreras')
            .update({ 
                estado: 'completada',
                fecha_completado: new Date().toISOString()
            })
            .eq('id', id);
        
        await cambiarEstado('disponible');
        mostrarNotificacion('¡Completada! 🎉', 'success');
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
// NOTIFICACIONES
// ============================================

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

// ============================================
// UI
// ============================================

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

async function cerrarSesion() {
    if (confirm('¿Cerrar sesión?')) {
        if (gpsInterval) clearInterval(gpsInterval);
        await cambiarEstado('inactivo');
        await window.supabase.auth.signOut();
        window.location.href = 'login.html';
    }
}

// ============================================
// DEBUG
// ============================================

async function debugCarreras() {
    console.log('=== 🐛 DEBUG DE CARRERAS ===');
    
    try {
        // 1. Verificar conductor
        console.log('1. Conductor ID:', conductorId);
        console.log('   Estado:', conductorData.estado);
        
        // 2. Buscar TODAS las carreras sin filtros
        console.log('2. Buscando TODAS las carreras...');
        const { data: todas, error } = await window.supabase
            .from('carreras')
            .select('*')
            .order('fecha_solicitud', { ascending: false })
            .limit(10);
        
        if (error) {
            console.error('Error:', error);
            alert('Error: ' + error.message);
            return;
        }
        
        console.log('Total carreras en BD:', todas ? todas.length : 0);
        
        if (!todas || todas.length === 0) {
            alert('❌ No hay NINGUNA carrera en la base de datos.\n\nPor favor ejecuta el script SQL para crear carreras de prueba.');
            return;
        }
        
        // 3. Analizar cada carrera
        console.log('3. Analizando carreras:');
        todas.forEach((c, i) => {
            console.log(`\nCarrera ${i + 1}:`);
            console.log('  - ID:', c.id);
            console.log('  - Tipo:', c.tipo);
            console.log('  - Estado:', c.estado);
            console.log('  - Conductor ID:', c.conductor_id);
            console.log('  - Cliente ID:', c.cliente_id);
            console.log('  - Precio:', c.precio);
            console.log('  - ¿Es mía?', c.conductor_id === conductorId);
            console.log('  - ¿Sin conductor?', c.conductor_id === null);
        });
        
        // 4. Contar por categoría
        const asignadas = todas.filter(c => c.conductor_id === conductorId && c.estado === 'asignada');
        const colectivas = todas.filter(c => c.tipo === 'colectivo' && !c.conductor_id && ['solicitada', 'buscando'].includes(c.estado));
        const activas = todas.filter(c => c.conductor_id === conductorId && ['aceptada', 'en_camino', 'en_curso'].includes(c.estado));
        
        console.log('\n4. Resumen:');
        console.log('  - Asignadas a mí:', asignadas.length);
        console.log('  - Colectivas disponibles:', colectivas.length);
        console.log('  - Activas:', activas.length);
        
        alert(`🐛 Debug completado:\n\nTotal en BD: ${todas.length}\nAsignadas a ti: ${asignadas.length}\nColectivas disponibles: ${colectivas.length}\nEn curso: ${activas.length}\n\nRevisa la consola para más detalles.`);
        
    } catch (error) {
        console.error('Error en debug:', error);
        alert('Error: ' + error.message);
    }
}

// ============================================
// INIT
// ============================================

window.addEventListener('load', init);
window.addEventListener('orientationchange', () => {
    setTimeout(() => mapa && mapa.invalidateSize(), 200);
});
