// ============================================
// CONFIGURACIÓN COMPARTIDA - TODOS LOS MÓDULOS
// ============================================

const SUPABASE_CONFIG = {
    url: 'https://brtiamwcdlwfyyprlevw.supabase.co',
    anonKey: 'sb_publishable_g8ETwpbbpEFR64zacmx_cw_L3Yxg7Zt'
};

// Inicializar Supabase
(function initSupabase() {
    const checkSupabase = setInterval(() => {
        if (window.supabase && window.supabase.createClient) {
            clearInterval(checkSupabase);
            try {
                const client = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
                window.supabase = client;
                console.log('✅ Supabase inicializado');
            } catch (error) {
                console.error('❌ Error inicializando Supabase:', error);
            }
        }
    }, 100);
    
    setTimeout(() => clearInterval(checkSupabase), 5000);
})();

// ============================================
// CONFIGURACIÓN DEL MAPA
// ============================================

const MAP_CONFIG = {
    defaultCenter: [14.0723, -87.1921],
    defaultZoom: 13,
    maxZoom: 18,
    minZoom: 10,
    
    // IMPORTANTE: Deshabilitar auto-centrado por defecto
    autoCenterEnabled: false,  // ← CAMBIO CLAVE
    autoCenterZoom: 14,
    
    radioBusquedaConductores: 5,
    osrmServer: 'https://router.project-osrm.org',
    multiplicadorTrafico: 1.3,
    
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

// ============================================
// CONFIGURACIÓN DE PRECIOS
// ============================================

const PRICING_CONFIG = {
    precioBaseKm: 15,
    precioMinimo: 30,
    descuentoColectivo: 0.3, // 30% de descuento
    
    async cargarDesdeDB() {
        try {
            if (!window.supabase?.from) return;
            
            const { data, error } = await window.supabase
                .from('configuracion')
                .select('clave, valor')
                .in('clave', ['precio_base_km', 'precio_minimo', 'descuento_colectivo']);
            
            if (data && !error) {
                data.forEach(config => {
                    if (config.clave === 'precio_base_km') {
                        this.precioBaseKm = parseFloat(config.valor);
                    }
                    if (config.clave === 'precio_minimo') {
                        this.precioMinimo = parseFloat(config.valor);
                    }
                    if (config.clave === 'descuento_colectivo') {
                        this.descuentoColectivo = parseFloat(config.valor);
                    }
                });
            }
        } catch (e) {
            console.error('Error cargando precios:', e);
        }
    },
    
    calcularPrecio(distanciaKm, esColectivo = false) {
        let precio = distanciaKm * this.precioBaseKm;
        precio = Math.max(precio, this.precioMinimo);
        
        if (esColectivo) {
            precio = precio * (1 - this.descuentoColectivo);
        }
        
        return precio;
    }
};

// ============================================
// ESTADOS DE CARRERAS
// ============================================

const ESTADOS_CARRERA = {
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
};

const ESTADOS_CONDUCTOR = {
    DISPONIBLE: 'disponible',
    OCUPADO: 'ocupado',
    INACTIVO: 'inactivo',
    EN_CARRERA: 'en_carrera'
};

// ============================================
// UTILIDADES
// ============================================

const UTILS = {
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
        return `L ${parseFloat(precio).toFixed(2)}`;
    },
    
    formatearDistancia(km) {
        return `${parseFloat(km).toFixed(2)} km`;
    },
    
    formatearTiempo(minutos) {
        if (minutos < 60) {
            return `${Math.round(minutos)} min`;
        }
        const horas = Math.floor(minutos / 60);
        const mins = Math.round(minutos % 60);
        return `${horas}h ${mins}min`;
    },
    
    calcularDistancia(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    },
    
    mostrarNotificacion(titulo, mensaje, tipo = 'info') {
        console.log(`[${tipo.toUpperCase()}] ${titulo}: ${mensaje}`);
        
        // Toast notification (implementar en UI)
        this.mostrarToast(titulo, mensaje, tipo);
        
        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(titulo, {
                body: mensaje,
                icon: '/assets/icon-192.png'
            }).catch(() => {});
        }
    },
    
    mostrarToast(titulo, mensaje, tipo) {
        // Implementación de toast (será diferente en cada módulo)
        const toastContainer = document.getElementById('toast-container');
        if (!toastContainer) return;
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${tipo}`;
        toast.innerHTML = `
            <strong>${titulo}</strong>
            <p>${mensaje}</p>
        `;
        
        toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },
    
    async solicitarPermisoNotificaciones() {
        if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
        }
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
                error => reject(error),
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        });
    },
    
    traducirEstadoCarrera(estado) {
        const traducciones = {
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
        };
        return traducciones[estado] || estado;
    }
};

// ============================================
// AUTENTICACIÓN
// ============================================

const AUTH = {
    usuario: null,
    perfil: null,
    
    async inicializar() {
        try {
            const { data: { session } } = await window.supabase.auth.getSession();
            
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
        
        const { data, error } = await window.supabase
            .from('perfiles')
            .select('*')
            .eq('id', this.usuario.id)
            .single();
        
        if (!error && data) {
            this.perfil = data;
        }
        
        return this.perfil;
    },
    
    async registrar(email, password, datos) {
        const { data, error } = await window.supabase.auth.signUp({
            email,
            password,
            options: {
                data: datos // nombre, rol, etc.
            }
        });
        
        if (error) throw error;
        return data;
    },
    
    async iniciarSesion(email, password) {
        const { data, error } = await window.supabase.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        this.usuario = data.user;
        await this.cargarPerfil();
        
        return data;
    },
    
    async cerrarSesion() {
        await window.supabase.auth.signOut();
        this.usuario = null;
        this.perfil = null;
        window.location.href = '/login.html';
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

// ============================================
// TIEMPO REAL (SUBSCRIPCIONES)
// ============================================

const REALTIME = {
    subscripciones: {},
    
    suscribirseACambios(tabla, callback, filtro = null) {
        const canal = window.supabase
            .channel(`${tabla}-changes`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: tabla,
                    filter: filtro
                },
                callback
            )
            .subscribe();
        
        this.subscripciones[tabla] = canal;
        return canal;
    },
    
    desuscribirse(tabla) {
        if (this.subscripciones[tabla]) {
            this.subscripciones[tabla].unsubscribe();
            delete this.subscripciones[tabla];
        }
    },
    
    desuscribirseDeTodo() {
        Object.keys(this.subscripciones).forEach(tabla => {
            this.desuscribirse(tabla);
        });
    }
};

// Cargar configuración al iniciar
setTimeout(() => {
    PRICING_CONFIG.cargarDesdeDB();
    AUTH.inicializar();
}, 1000);
