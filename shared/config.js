const SUPABASE_CONFIG = {
    url: 'https://brtiamwcdlwfyyprlevw.supabase.co',
    anonKey: 'sb_publishable_g8ETwpbbpEFR64zacmx_cw_L3Yxg7Zt'
};

// Variable global para el cliente de Supabase
window.supabaseClient = null;

// Inicializar Supabase con mejor manejo de errores
(function initSupabase() {
    console.log('🔄 Iniciando configuración de Supabase...');
    
    let intentos = 0;
    const maxIntentos = 50;
    
    const checkSupabase = setInterval(() => {
        intentos++;
        
        // Verificar si la librería de Supabase está cargada
        if (window.supabase && window.supabase.createClient) {
            clearInterval(checkSupabase);
            
            try {
                // Crear cliente de Supabase
                window.supabaseClient = window.supabase.createClient(
                    SUPABASE_CONFIG.url, 
                    SUPABASE_CONFIG.anonKey,
                    {
                        auth: {
                            persistSession: true,
                            autoRefreshToken: true,
                            detectSessionInUrl: true
                        },
                        realtime: {
                            params: {
                                eventsPerSecond: 10
                            }
                        }
                    }
                );
                
                // Alias para compatibilidad
                window.supabase = window.supabaseClient;
                
                console.log('✅ Supabase inicializado correctamente');
                
                // Disparar evento personalizado
                window.dispatchEvent(new CustomEvent('supabaseReady'));
                
            } catch (error) {
                console.error('❌ Error inicializando Supabase:', error);
                window.dispatchEvent(new CustomEvent('supabaseError', { detail: error }));
            }
        } else if (intentos >= maxIntentos) {
            clearInterval(checkSupabase);
            console.error('❌ Timeout: No se pudo cargar Supabase después de ' + maxIntentos + ' intentos');
            window.dispatchEvent(new CustomEvent('supabaseError', { 
                detail: new Error('Timeout cargando Supabase') 
            }));
        }
    }, 100);
})();

const MAP_CONFIG = {
    defaultCenter: [15.612498976764755, -87.95696292004212], // Tegucigalpa
    defaultZoom: 13,
    maxZoom: 18,
    minZoom: 10,
    
    // Configuración de centrado automático
    autoCenterEnabled: false,
    autoCenterZoom: 15,
    autoCenterDuration: 0.5,
    
    // Radio de búsqueda (km)
    radioBusquedaConductores: 5,
    
    // Servidor OSRM para rutas
    osrmServer: 'https://router.project-osrm.org',
    
    // Multiplicador de tráfico (1.3 = +30% tiempo)
    multiplicadorTrafico: 1.3,
    
    // Iconos emoji
    iconos: {
        conductor: {
            disponible: '🟢',
            ocupado: '🟡',
            inactivo: '⚪',
            en_carrera: '🔵'
        },
        cliente: '👤',
        origen: '📍',
        destino: '🏁'
    }
};


const PRICING_CONFIG = {
    precioBaseKm: 5,
    precioMinimo: 10,
    descuentoColectivo: 0.3,
    
    async cargarDesdeDB() {
        if (!window.supabaseClient) {
            console.warn('⚠️ Supabase no está listo para cargar precios');
            return;
        }
        
        try {
            const { data, error } = await window.supabaseClient
                .from('configuracion')
                .select('clave, valor')
                .in('clave', ['precio_base_km', 'precio_minimo', 'descuento_colectivo']);
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                data.forEach(config => {
                    switch(config.clave) {
                        case 'precio_base_km':
                            this.precioBaseKm = parseFloat(config.valor);
                            break;
                        case 'precio_minimo':
                            this.precioMinimo = parseFloat(config.valor);
                            break;
                        case 'descuento_colectivo':
                            this.descuentoColectivo = parseFloat(config.valor);
                            break;
                    }
                });
                console.log('✅ Precios cargados desde BD:', this);
            }
        } catch (error) {
            console.warn('⚠️ Error cargando precios desde BD, usando valores por defecto:', error);
        }
    },
    
    calcularPrecio(distanciaKm, esColectivo = false) {
        if (!distanciaKm || distanciaKm <= 0) return this.precioMinimo;
        
        let precio = distanciaKm * this.precioBaseKm;
        precio = Math.max(precio, this.precioMinimo);
        
        if (esColectivo) {
            precio = precio * (1 - this.descuentoColectivo);
        }
        
        return Math.round(precio * 100) / 100; // Redondear a 2 decimales
    }
};

const ESTADOS = {
    CARRERA: {
        SOLICITADA: 'solicitada',
        BUSCANDO: 'buscando',
        ASIGNADA: 'asignada',
        ACEPTADA: 'aceptada',
        RECHAZADA: 'rechazada',
        EN_CAMINO: 'en_camino',
        EN_CURSO: 'en_curso',
        COMPLETADA: 'completada',
        CANCELADA_CLIENTE: 'cancelada_cliente',
        CANCELADA_CONDUCTOR: 'cancelada_conductor'
    },
    
    CONDUCTOR: {
        DISPONIBLE: 'disponible',
        OCUPADO: 'ocupado',
        INACTIVO: 'inactivo',
        EN_CARRERA: 'en_carrera'
    },
    
    traducir(tipo, estado) {
        const traducciones = {
            carrera: {
                'solicitada': 'Solicitada',
                'buscando': 'Buscando Conductor',
                'asignada': 'Asignada',
                'aceptada': 'Aceptada',
                'rechazada': 'Rechazada',
                'en_camino': 'Conductor en Camino',
                'en_curso': 'En Curso',
                'completada': 'Completada',
                'cancelada_cliente': 'Cancelada por Cliente',
                'cancelada_conductor': 'Cancelada por Conductor'
            },
            conductor: {
                'disponible': 'Disponible',
                'ocupado': 'Ocupado',
                'inactivo': 'Inactivo',
                'en_carrera': 'En Carrera'
            }
        };
        
        return traducciones[tipo]?.[estado] || estado;
    }
};


const UTILS = {
    // Formateo
    formatearFecha(fecha) {
        if (!fecha) return '-';
        const date = new Date(fecha);
        return date.toLocaleDateString('es-HN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },
    
    formatearPrecio(precio) {
        return `L ${parseFloat(precio || 0).toFixed(2)}`;
    },
    
    formatearDistancia(km) {
        return `${parseFloat(km || 0).toFixed(1)} km`;
    },
    
    formatearTiempo(minutos) {
        if (!minutos) return '-';
        if (minutos < 60) {
            return `${Math.round(minutos)} min`;
        }
        const horas = Math.floor(minutos / 60);
        const mins = Math.round(minutos % 60);
        return `${horas}h ${mins}min`;
    },
    
    // Cálculos geográficos
    calcularDistancia(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radio de la Tierra en km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    },
    
    // Notificaciones
    mostrarNotificacion(titulo, mensaje, tipo = 'info') {
        console.log(`[${tipo.toUpperCase()}] ${titulo}: ${mensaje}`);
        
        // Toast visual
        this.mostrarToast(titulo, mensaje, tipo);
        
        // Notificación del navegador
        if ('Notification' in window && Notification.permission === 'granted') {
            try {
                new Notification(titulo, {
                    body: mensaje,
                    icon: '/icon-192.png',
                    badge: '/icon-192.png'
                });
            } catch (e) {
                console.warn('No se pudo mostrar notificación del navegador:', e);
            }
        }
    },
    
    mostrarToast(titulo, mensaje, tipo) {
        const container = document.getElementById('toast-container');
        if (!container) {
            console.warn('No se encontró el contenedor de toasts');
            return;
        }
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${tipo}`;
        toast.innerHTML = `
            <strong>${titulo}</strong>
            ${mensaje ? `<p>${mensaje}</p>` : ''}
        `;
        
        container.appendChild(toast);
        
        // Auto-eliminar después de 3 segundos
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },
    
    // Permisos
    async solicitarPermisoNotificaciones() {
        if (!('Notification' in window)) {
            console.warn('Este navegador no soporta notificaciones');
            return false;
        }
        
        if (Notification.permission === 'granted') {
            return true;
        }
        
        if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            return permission === 'granted';
        }
        
        return false;
    },
    
    async solicitarPermisoUbicacion() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocalización no soportada'));
                return;
            }
            
            navigator.geolocation.getCurrentPosition(
                position => resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    precision: position.coords.accuracy
                }),
                error => {
                    const mensajes = {
                        1: 'Permiso denegado. Activa la ubicación.',
                        2: 'Ubicación no disponible.',
                        3: 'Tiempo de espera agotado.'
                    };
                    reject(new Error(mensajes[error.code] || 'Error de ubicación'));
                },
                { 
                    enableHighAccuracy: true, 
                    timeout: 10000, 
                    maximumAge: 0 
                }
            );
        });
    },
    
    // Debounce
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    
    // Validaciones
    validarEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    },
    
    validarTelefono(telefono) {
        // Formato: 9999-9999 o 99999999
        const re = /^\d{4}-?\d{4}$/;
        return re.test(telefono);


const AUTH = {
    usuario: null,
    perfil: null,
    
    async inicializar() {
        if (!window.supabaseClient) {
            console.warn('⚠️ Supabase no está listo');
            return false;
        }
        
        try {
            const { data: { session }, error } = await window.supabaseClient.auth.getSession();
            
            if (error) throw error;
            
            if (session) {
                this.usuario = session.user;
                await this.cargarPerfil();
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Error inicializando auth:', error);
            return false;
        }
    },
    
    async cargarPerfil() {
        if (!this.usuario) return null;
        
        try {
            const { data, error } = await window.supabaseClient
                .from('perfiles')
                .select('*')
                .eq('id', this.usuario.id)
                .single();
            
            if (error) throw error;
            
            this.perfil = data;
            return this.perfil;
        } catch (error) {
            console.error('Error cargando perfil:', error);
            return null;
        }
    },
    
    async registrar(email, password, datosAdicionales) {
        try {
            const { data, error } = await window.supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    data: datosAdicionales
                }
            });
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en registro:', error);
            throw error;
        }
    },
    
    async iniciarSesion(email, password) {
        try {
            const { data, error } = await window.supabaseClient.auth.signInWithPassword({
                email,
                password
            });
            
            if (error) throw error;
            
            this.usuario = data.user;
            await this.cargarPerfil();
            
            return data;
        } catch (error) {
            console.error('Error en login:', error);
            throw error;
        }
    },
    
    async cerrarSesion() {
        try {
            await window.supabaseClient.auth.signOut();
            this.usuario = null;
            this.perfil = null;
            window.location.href = 'login.html';
        } catch (error) {
            console.error('Error cerrando sesión:', error);
        }
    },
    
    estaAutenticado() {
        return !!this.usuario;
    },
    
    esAdmin() {
        return this.perfil?.rol === 'admin';
    },
    
    esConductor() {
        return this.perfil?.rol === 'conductor';
    },
    
    esCliente() {
        return this.perfil?.rol === 'cliente';
    }
};

const REALTIME = {
    canales: {},
    
    suscribirse(nombreCanal, tabla, callback, filtro = null) {
        try {
            const config = {
                event: '*',
                schema: 'public',
                table: tabla
            };
            
            if (filtro) {
                config.filter = filtro;
            }
            
            const canal = window.supabaseClient
                .channel(nombreCanal)
                .on('postgres_changes', config, callback)
                .subscribe((status) => {
                    console.log(`Canal ${nombreCanal}: ${status}`);
                });
            
            this.canales[nombreCanal] = canal;
            return canal;
        } catch (error) {
            console.error('Error suscribiéndose:', error);
            return null;
        }
    },
    
    desuscribirse(nombreCanal) {
        if (this.canales[nombreCanal]) {
            this.canales[nombreCanal].unsubscribe();
            delete this.canales[nombreCanal];
        }
    },
    
    desuscribirseTodo() {
        Object.keys(this.canales).forEach(canal => {
            this.desuscribirse(canal);
        });
    }
};

// Esperar a que Supabase esté listo
window.addEventListener('supabaseReady', async () => {
    console.log('🚀 Supabase listo, cargando configuración...');
    
    try {
        await PRICING_CONFIG.cargarDesdeDB();
        await AUTH.inicializar();
        console.log('✅ Configuración cargada');
    } catch (error) {
        console.error('Error en inicialización:', error);
    }
});

// Manejar errores de Supabase
window.addEventListener('supabaseError', (event) => {
    console.error('❌ Error de Supabase:', event.detail);
    UTILS.mostrarNotificacion(
        'Error de Conexión',
        'No se pudo conectar a la base de datos',
        'danger'
    );
});

console.log('📦 Config.js cargado');
