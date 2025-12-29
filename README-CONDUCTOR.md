# Módulo CONDUCTOR

## Funcionalidades

### 1. Ver Solicitudes en el Mapa
- Marcadores de clientes que solicitan carreras
- Ver distancia y precio estimado
- Click para ver detalles

### 2. Aceptar/Rechazar Carreras
- Notificación cuando hay nueva solicitud
- 60 segundos para aceptar
- Rechazar automáticamente si no responde

### 3. Lista de Carreras Asignadas
- Ver carreras directas asignadas a ti
- Estado en tiempo real
- Botones de acción según estado

### 4. Carreras Colectivas
- Ver lista de carreras colectivas disponibles
- Unirse como conductor
- Ver pasajeros en ruta

### 5. Actualizar Ubicación
- GPS automático cada 5 segundos
- Aparecer en el mapa para clientes
- Cambiar estado: disponible/ocupado/inactivo

## Flujo de Trabajo

1. Login
2. Activar ubicación GPS
3. Cambiar estado a "Disponible"
4. Esperar notificación de carrera
5. Aceptar en 60 segundos
6. Ver ruta al cliente
7. "Estoy en camino"
8. "Cliente abordado"
9. "Carrera completada"
10. Calificar cliente

## Archivos

- `login.html` - Login/registro
- `index.html` - App principal
- `app.js` - Lógica completa
- `styles.css` - Estilos
