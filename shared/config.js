const SUPABASE_CONFIG = {
    url: 'https://brtiamwcdlwfyyprlevw.supabase.co',
    // ⚠️ IMPORTANTE: Esta es tu clave REAL de Supabase
    // Si da error, ve a: Supabase Dashboard → Settings → API → copia "anon public"
    anonKey: 'sb_publishable_g8ETwpbbpEFR64zacmx_cw_L3Yxg7Zt'
};

// Variable global para el cliente
window.supabaseClient = null;

// Inicializar Supabase con mejor manejo de errores
(function initSupabase() {
    console.log('🔄 Iniciando Supabase...');
    
    let intentos = 0;
    const maxIntentos = 50;
    
    const checkSupabase = setInterval(() => {
        intentos++;
        
        if (window.supabase && window.supabase.createClient) {
            clearInterval(checkSupabase);
            
            try {
                // Crear cliente de Supabase
                const client = window.supabase.createClient(
                    SUPABASE_CONFIG.url, 
                    SUPABASE_CONFIG.anonKey,
                    {
                        auth: {
                            persistSession: true,
                            autoRefreshToken: true,
                            detectSessionInUrl: true
                        }
                    }
                );
                
                // Asignar a variables globales
                window.supabaseClient = client;
                window.supabase = client;
                
                console.log('✅ Supabase inicializado correctamente');
                console.log('📦 URL:', SUPABASE_CONFIG.url);
                
                // Disparar evento personalizado
                window.dispatchEvent(new CustomEvent('supabaseReady'));
                
            } catch (error) {
                console.error('❌ Error inicializando Supabase:', error);
                window.dispatchEvent(new CustomEvent('supabaseError', { detail: error }));
            }
        } else if (intentos >= maxIntentos) {
            clearInterval(checkSupabase);
            console.error('❌ Timeout: No se cargó la librería de Supabase después de 5 segundos');
            window.dispatchEvent(new CustomEvent('supabaseError', { 
                detail: new Error('Timeout cargando librería de Supabase') 
            }));
        } else if (intentos % 10 === 0) {
            console.log(`⏳ Esperando Supabase... (${intentos}/${maxIntentos})`);
        }
    }, 100);
})();

// ============================================
// CONFIGURACIÓN DEL MAPA
// ============================================

const MAP_CONFIG = {
    defaultCenter: [14.0723, -87.1921],
    defaultZoom: 13,
    maxZoom: 18,
    minZoom: 10,
    autoCenterEnabled: false,
    autoCenterZoom: 15,
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
    descuentoColectivo: 0.3,
    
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
                console.log('✅ Precios cargados desde BD');
            }
        } catch (e) {
            console.warn('⚠️ No se pudieron cargar precios desde BD, usando valores por defecto');
        }
    },
    
    calcularPrecio(distanciaKm, esColectivo = false) {
        if (!distanciaKm || distanciaKm <= 0) return this.precioMinimo;
        
        let precio = distanciaKm * this.precioBaseKm;
        precio = Math.max(precio, this.precioMinimo);
        
        if (esColectivo) {
            precio = precio * (1 - this.descuentoColectivo);
        }
        
        return Math.round(precio * 100) / 100;
    }
};

// ============================================
// ESTADOS
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
        return new Date(fecha).toLocaleDateString('es-HN', {
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
        if (minutos < 60) return `${Math.round(minutos)} min`;
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
    }
};

// Cargar configuración cuando Supabase esté listo
window.addEventListener('supabaseReady', () => {
    console.log('🚀 Supabase listo, cargando configuración...');
    PRICING_CONFIG.cargarDesdeDB();
});

console.log('📦 config.js cargado');
