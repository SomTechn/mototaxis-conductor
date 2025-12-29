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
        
        // Actualizar UI
        actualizarEstadoUI(conductor.estado);
        
        // Inicializar
        await inicializarMapa();
        await inicializarGPS();
        inicializarGestos();
        await cargarTodasCarreras();
        await cargarEstadisticas();
        suscribirseACambios();
        
        console.log('=== APP INICIADA ===');
        document.getElementById('loader').classList.add('hidden');
        
    } catch (error) {
        console.error('Error:', error);
        alert('Error: ' + error.message);
        document.getElementById('loader').classList.add('hidden');
    }
}

// ============================================
// MAPA
// ============================================

async function inicializarMapa() {
    mapa = L.map('map', {
        zoomControl: false
    }).setView([14.0723, -87.1921], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 18
    }).addTo(mapa);
    
    // Control de zoom personalizado
    L.control.zoom({
        position: 'bottomright'
    }).addTo(mapa);
    
    setTimeout(() => mapa.invalidateSize(), 500);
    console.log('✅ Mapa inicializado');
}

// ============================================
// GPS
// ============================================

async function inicializarGPS() {
    if (!navigator.geolocation) {
        alert('GPS no disponible');
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            miUbicacion = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude
            };
            
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
            
            console.log('✅ GPS activado');
        },
        (error) => {
            console.error('Error GPS:', error);
            alert('Activa el GPS para usar la app');
        },
        { enableHighAccuracy: true, timeout: 10000 }
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
        // Carreras asignadas a mí pendientes
        const { data: asignadas } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('conductor_id', conductorId)
            .eq('estado', 'asignada');
        
        // Carreras colectivas sin conductor
        const { data: colectivas } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('tipo', 'colectivo')
            .in('estado', ['solicitada', 'buscando'])
            .is('conductor_id', null)
            .limit(20);
        
        const todas = [...(asignadas || []), ...(colectivas || [])];
        
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
        
        // Mostrar colectivas en mapa
        if (colectivas && colectivas.length > 0) {
            mostrarColectivasEnMapa(colectivas);
        }
        
    } catch (error) {
        console.error('Error:', error);
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
            return;
        }
        
        let html = '';
        data.forEach(carrera => {
            html += renderCarreraActiva(carrera);
        });
        
        document.getElementById('carrerasActivas').innerHTML = html;
        document.getElementById('badgeActivas').textContent = data.length;
        document.getElementById('badgeActivas').style.display = 'block';
        
    } catch (error) {
        console.error('Error:', error);
    }
}

function renderCarreraActiva(carrera) {
    const estados = {
        'aceptada': { btn: 'Ir al Origen', action: 'irAlOrigen' },
        'en_camino': { btn: 'Cliente Abordado', action: 'clienteAbordado' },
        'en_curso': { btn: 'Completar', action: 'completarCarrera' }
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
            
            <div class="ride-actions single">
                <button class="btn btn-success" onclick="${estado.action}('${carrera.id}')">
                    ${estado.btn}
                </button>
            </div>
        </div>
    `;
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

function mostrarColectivasEnMapa(carreras) {
    limpiarMarcadoresColectivas();
    
    carreras.forEach(c => {
        const marker = L.marker([c.origen_lat, c.origen_lng], {
            icon: L.divIcon({ 
                html: '🚐', 
                className: 'emoji-marker',
                iconSize: [35, 35]
            })
        }).addTo(mapa).bindPopup(`
            <div style="text-align:center">
                <strong>🚐 Colectiva</strong><br>
                <div style="font-size:0.875rem;margin:0.5rem 0">${c.origen_direccion}</div>
                <div style="font-size:1.25rem;font-weight:bold;color:#10b981">L ${parseFloat(c.precio).toFixed(2)}</div>
            </div>
        `);
        
        marcadoresColectivas.push(marker);
    });
    
    console.log(`✅ ${carreras.length} colectivas en mapa`);
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
// INIT
// ============================================

window.addEventListener('load', init);
window.addEventListener('orientationchange', () => {
    setTimeout(() => mapa && mapa.invalidateSize(), 200);
});
