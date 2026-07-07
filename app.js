// Elements
const speciesSearch = document.getElementById('species-search');
const autocompleteList = document.getElementById('autocomplete-list');
const tagsContainer = document.getElementById('selected-species-tags');
const livingOnlyFilter = document.getElementById('living-only-filter');
const threatenedFilter = document.getElementById('threatened-filter');
const protectedFilter = document.getElementById('protected-filter');
const singularFilter = document.getElementById('singular-filter');
const statTotal = document.getElementById('stat-total');
const statSpecies = document.getElementById('stat-species');
const loader = document.getElementById('loader');
const loaderText = document.getElementById('loader-text');

// Mode selectors
const modeGlobal = document.getElementById('mode-global');
const modeDistrict = document.getElementById('mode-district');

// Global Flower Elements
const globalFlowerToggle = document.getElementById('global-flower-toggle');
const globalFlowerControl = document.getElementById('global-flower-control');

// App State
let currentMode = 'global'; // Default to global mode on startup
let allTrees = [];        // Currently active dataset (depends on mode)
let speciesList = [];     // Full species list for autocomplete
let districtsMetadata = []; // District count info
let singularTrees = [];   // Singular trees from CSV
let censusData = null;    // Full censo loaded in background
let districtBoundaries = {}; // Precalculated Convex Hull polygons
let loadedDistricts = new Set(); // File names of loaded districts
let boundaryLayers = {};  // Leaflet polygon layers in district mode

// Flower display state variables
let showGlobalFlowers = false; // For global mode
let loadedDistrictsFlowers = new Set(); // For district mode: stores filenames of active districts

// Caches
let fullTreesCache = null; // Cache for the 38MB JSON

// District Loading Queue
let districtQueue = [];
let isDistrictLoading = false;

let map;
let markerLayerGroup;
let selectedSpecies = [];

// Globals for virtualized listing
let currentFilteredTrees = [];
let currentMarkers = [];
let currentListIndex = 0;
const CHUNK_SIZE = 100;

// Initialize Map
let darkLayer;
let satelliteLayer;

function initMap() {
    let initialCenter = [37.3891, -5.9845];
    let initialZoom = 13;

    const savedState = localStorage.getItem('sevilleTreesMapState');
    if (savedState) {
        try {
            const state = JSON.parse(savedState);
            if (state.center && state.zoom) {
                initialCenter = [state.center.lat, state.center.lng];
                initialZoom = state.zoom;
            }
        } catch (e) {
            console.warn('Error reading map state:', e);
        }
    }

    map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true
    }).setView(initialCenter, initialZoom);
    
    darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 20
    });

    satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 20
    });

    darkLayer.addTo(map);

    map.on('moveend', () => {
        localStorage.setItem('sevilleTreesMapState', JSON.stringify({
            center: map.getCenter(),
            zoom: map.getZoom()
        }));
    });

    // Dynamic marker size adjustment on zoom
    map.on('zoomend', () => {
        updateMarkerSizes();
    });
}

// Extend Leaflet Canvas renderer to draw beautiful, high-performance flower shapes on the fly
// This delegates standard circles to the native Leaflet implementation (avoiding NaN scaling errors)
// and handles custom flower drawings on Canvas only when requested.
const originalUpdateCircle = L.Canvas.prototype._updateCircle;

L.Canvas.include({
    _updateCircle: function (layer) {
        if (layer.options.isFlower) {
            if (!layer._point || (layer._empty && layer._empty())) { return; }

            var p = layer._point,
                ctx = this._ctx,
                r = Math.max(Math.round(layer._radius), 1);

            ctx.beginPath();
            // Draw a beautiful 5-petal flower shape on Canvas (1 central disk + 4 surrounding petals)
            // Central circle
            ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2, false);
            
            // Petals (4 smaller circles around the center)
            var pr = r * 0.45; // petal radius
            var dist = r * 0.55; // petal distance
            ctx.arc(p.x, p.y - dist, pr, 0, Math.PI * 2, false); // top
            ctx.arc(p.x + dist, p.y, pr, 0, Math.PI * 2, false); // right
            ctx.arc(p.x, p.y + dist, pr, 0, Math.PI * 2, false); // bottom
            ctx.arc(p.x - dist, p.y, pr, 0, Math.PI * 2, false); // left
            
            this._fillStroke(ctx, layer);
        } else {
            // Call original Leaflet method for standard circles
            originalUpdateCircle.call(this, layer);
        }
    }
});

// Update sizes of active circle markers on screen (optimized scale for better zoom-out experience)
function updateMarkerSizes() {
    const currentZoom = map.getZoom();
    let r = 0.5; // Default very tiny size for zoom levels < 13
    if (currentZoom >= 17) r = 4.5;
    else if (currentZoom >= 16) r = 3.5;
    else if (currentZoom >= 15) r = 2.2;
    else if (currentZoom >= 14) r = 1.4;
    else if (currentZoom >= 13) r = 0.8;

    if (markerLayerGroup) {
        markerLayerGroup.eachLayer(layer => {
            if (layer.setRadius) {
                // If it is a flower marker, make it slightly larger so petals are distinct on screen
                const finalRadius = layer.options.isFlower ? r * 1.5 : r;
                layer.setRadius(finalRadius);
            }
        });
    }
}

// Load metadata lists once on startup
async function loadInitialMetadata() {
    try {
        // 1. Cargar especies únicas
        const speciesResponse = await fetch(`data/species.json?v=${Date.now()}`);
        if (speciesResponse.ok) {
            const rawSpecies = await speciesResponse.json();
            const deadKeywords = ['alcorque vacío', 'alcorque vacio', 'tocón', 'tocon', 'marra', 'vacio', 'vacío', 'muerto', 'no plantar'];
            const unknownKeywords = ['desconocida', 'no definido', 'no consta'];
            
            speciesList = rawSpecies.filter(s => {
                const lower = s.toLowerCase();
                return !deadKeywords.some(kw => lower.includes(kw)) && !unknownKeywords.some(kw => lower.includes(kw));
            });
            
            // Unify removed categories into virtual selectable species
            speciesList.push('Árbol muerto / Marra / Alcorque vacío');
            speciesList.push('Especie desconocida / No consta');
            speciesList.sort();
        }

        // 2. Cargar metadatos de distritos
        const districtsResponse = await fetch(`data/districts.json?v=${Date.now()}`);
        if (districtsResponse.ok) districtsMetadata = await districtsResponse.json();

        // 3. Cargar perímetros poligonales precalculados
        const boundariesResponse = await fetch(`data/district-boundaries.json?v=${Date.now()}`);
        if (boundariesResponse.ok) districtBoundaries = await boundariesResponse.json();
    } catch (e) {
        console.error("Error cargando metadatos iniciales", e);
    }
}

// Switch Active Navigation Tabs
function updateActiveTab() {
    if (modeGlobal && modeDistrict) {
        if (currentMode === 'global') modeGlobal.checked = true;
        else if (currentMode === 'district') modeDistrict.checked = true;
    }
}

// Clear map and boundaries
function cleanMap() {
    if (markerLayerGroup) {
        map.removeLayer(markerLayerGroup);
        markerLayerGroup = null;
    }
    
    // Eliminar polígonos de distritos
    Object.values(boundaryLayers).forEach(layer => map.removeLayer(layer));
    boundaryLayers = {};
}

// Enter Global Mode (Clustering)
async function enterModeGlobal() {
    currentMode = 'global';
    updateActiveTab();
    cleanMap();

    // Ajustar filtros específicos del modo
    document.getElementById('district-mode-indicator').classList.add('hidden');
    globalFlowerControl.classList.remove('hidden');
    globalFlowerToggle.checked = showGlobalFlowers;

    // Inicializar agrupamiento (Marker Clustering) con configuraciones optimizadas
    markerLayerGroup = L.markerClusterGroup({
        maxClusterRadius: 150,       // Agrupamiento amplio para evitar saturación de iconos
        disableClusteringAtZoom: 17, // Desactivar agrupamiento a nivel de zoom muy cercano
        chunkedLoading: true,        // Procesamiento asíncrono en segundo plano
        chunkInterval: 50,
        zoomToBoundsOnClick: false,  // Desactivar zoom al hacer clic en el cluster
        spiderfyOnMaxZoom: false,    // Desactivar expansión radial (spiderfy)

        iconCreateFunction: function (cluster) {
            // Icono de cluster compacto y estilizado
            const childCount = cluster.getChildCount();
            let c = ' marker-cluster-';
            let size = 26;
            
            if (childCount < 100) {
                c += 'small';
                size = 24;
            } else if (childCount < 1000) {
                c += 'medium';
                size = 28;
            } else {
                c += 'large';
                size = 32;
            }
            return new L.DivIcon({
                html: `<div><span>${childCount.toLocaleString()}</span></div>`,
                className: 'marker-cluster-custom' + c,
                iconSize: new L.Point(size, size)
            });
        }
    }).addTo(map);

    // Cargar dataset principal
    if (fullTreesCache) {
        allTrees = fullTreesCache;
        renderTrees();
    } else {
        loader.classList.remove('hidden');
        loaderText.textContent = "Descargando base de datos completa (38 MB)...";
        try {
            const response = await fetch(`trees.json?v=${Date.now()}`);
            if (!response.ok) throw new Error("No se pudo descargar el archivo JSON.");
            fullTreesCache = await response.json();
            allTrees = fullTreesCache;
            renderTrees();
        } catch (err) {
            alert("Error cargando el mapa global: " + err.message);
            enterModeDistrict();
        } finally {
            loader.classList.add('hidden');
        }
    }
}

// Enter District Mode (Segmented load on demand)
function enterModeDistrict() {
    currentMode = 'district';
    allTrees = [];
    currentFilteredTrees = [];
    currentMarkers = [];
    loadedDistricts.clear();
    selectedSpecies = [];
    renderTags();
    
    updateActiveTab();
    cleanMap();

    // Ajustar filtros específicos
    document.getElementById('district-mode-indicator').classList.remove('hidden');
    globalFlowerControl.classList.add('hidden');
    renderDistrictTags();

    // Capa de marcadores plana (sin clustering para este modo de bajo volumen de datos)
    markerLayerGroup = L.layerGroup().addTo(map);

    // Pintar los perímetros en gris de Sevilla
    drawDistrictBoundaries();
    
    statTotal.textContent = "0";
}

// Dibujar perímetros poligonales iniciales en modo distritos
function drawDistrictBoundaries() {
    // Patrón defensivo: reintentar si el JSON aún no está listo en memoria
    if (Object.keys(districtBoundaries).length === 0) {
        setTimeout(drawDistrictBoundaries, 100);
        return;
    }

    Object.entries(districtBoundaries).forEach(([distrito, info]) => {
        // Crear polígono (info.polygon es una lista de bucles para soportar MultiPolygon perfectamente)
        const polygon = L.polygon(info.polygon, {
            color: 'rgba(255,255,255,0.25)', // Borde gris claro
            fillColor: 'rgba(255,255,255,0.05)', // Relleno translúcido
            weight: 1.5,
            fillOpacity: 1
        }).addTo(map);

        // Guardar referencia
        boundaryLayers[distrito] = polygon;

        // Tooltip flotante con el nombre del distrito
        polygon.bindTooltip(`<strong>${distrito}</strong><br>Clic para cargar (${info.count.toLocaleString()} árboles)`, {
            sticky: true,
            className: 'district-tooltip'
        });

        // Configurar interactividad
        setupBoundaryEvents(distrito, polygon);
    });
}

// Controlar eventos hover y click de los perímetros
function setupBoundaryEvents(distrito, polygon) {
    const isLoaded = () => loadedDistricts.has(districtBoundaries[distrito].filename);

    polygon.on('mouseover', function () {
        if (isLoaded()) return; // Desactivar delimitación/hover si ya está cargado

        this.setStyle({
            color: '#228B22', // Forest Green
            fillColor: 'rgba(34,139,34,0.15)',
            weight: 2.5
        });
    });

    polygon.on('mouseout', function () {
        if (isLoaded()) return;

        this.setStyle({
            color: 'rgba(255,255,255,0.25)',
            fillColor: 'rgba(255,255,255,0.05)',
            weight: 1.5
        });
    });

    polygon.on('click', function () {
        if (isLoaded()) return;

        const info = districtBoundaries[distrito];
        loadDistrictAndAppend(info.name, info.filename);
    });
}

// Cargar y anexar datos de un distrito en modo segmentado (mediante cola de tareas)
async function loadDistrictAndAppend(name, filename) {
    if (loadedDistricts.has(filename)) return;
    loadedDistricts.add(filename); // Bloqueo preventivo de la UI inmediata

    return new Promise((resolve, reject) => {
        districtQueue.push({ name, filename, resolve, reject });
        processDistrictQueue();
    });
}

// Consumidor asíncrono de la cola de distritos
async function processDistrictQueue() {
    // Si ya estamos descargando algo, o la cola está vacía, no hacemos nada
    if (isDistrictLoading || districtQueue.length === 0) return;
    
    isDistrictLoading = true;
    const { name, filename, resolve, reject } = districtQueue.shift();
    
    loader.classList.remove('hidden');
    
    // Indicador visual de la cola
    if (districtQueue.length > 0) {
        loaderText.textContent = `Descargando distrito ${name}... (${districtQueue.length} en espera)`;
    } else {
        loaderText.textContent = `Descargando distrito ${name}...`;
    }

    try {
        const response = await fetch(`data/${filename}?v=${Date.now()}`);
        if (!response.ok) throw new Error("Error de conexión");
        
        const districtTrees = await response.json();
        
        // Unir datos de árboles
        allTrees.push(...districtTrees);
        
        // Modificar el estilo del polígono a estilo "Cargado" (casi invisible, sin hover)
        const polygon = boundaryLayers[name];
        if (polygon) {
            polygon.setStyle({
                color: 'rgba(34,139,34,0.3)', // Borde verde muy sutil
                fillColor: 'transparent',      // Sin relleno para ver el mapa oscuro
                weight: 1
            });
            polygon.closeTooltip();
            polygon.unbindTooltip(); // Quitar tooltip de invitación a cargar
            polygon.bindTooltip(`<strong>${name}</strong>`, { sticky: true });
        }

        renderDistrictTags();
        renderTrees();
        resolve(true);
    } catch (err) {
        loadedDistricts.delete(filename); // Liberamos el candado
        alert(`No se pudo cargar el distrito ${name}: ` + err.message);
        reject(err);
    } finally {
        isDistrictLoading = false;
        
        // Comprobar recursivamente si hay más tareas
        if (districtQueue.length === 0) {
            loader.classList.add('hidden');
        } else {
            // Breve respiro al navegador antes del siguiente fetch pesado
            setTimeout(processDistrictQueue, 50);
        }
    }
}

// Descartar/Eliminar datos de un distrito cargado
function unloadDistrict(name, filename) {
    // 1. Quitar distrito de la lista activa
    loadedDistricts.delete(filename);
    loadedDistrictsFlowers.delete(filename); // Eliminar también el estado de flor
    
    // 2. Filtrar árboles para remover los de este distrito
    allTrees = allTrees.filter(t => t.distrito !== name);

    // 3. Restablecer estilo de perímetro original e interactividad
    const polygon = boundaryLayers[name];
    if (polygon) {
        polygon.setStyle({
            color: 'rgba(255,255,255,0.25)',
            fillColor: 'rgba(255,255,255,0.05)',
            weight: 1.5
        });
        polygon.unbindTooltip();
        const info = districtBoundaries[name];
        polygon.bindTooltip(`<strong>${name}</strong><br>Clic para cargar (${info.count.toLocaleString()} árboles)`, {
            sticky: true
        });
    }

    renderDistrictTags();
    renderTrees();
}

// Pintar etiquetas de distritos cargados en el sidebar (estética idéntica a especies)
// Incluye el botón interactivo (🌸/❀) para cambiar a vista de flor por distrito
function renderDistrictTags() {
    const container = document.getElementById('loaded-districts-tags');
    container.innerHTML = '';

    if (loadedDistricts.size === 0) {
        container.innerHTML = '<span class="no-tags-placeholder">Ninguno. Haz clic en el mapa para cargar.</span>';
        return;
    }

    loadedDistricts.forEach(filename => {
        // Encontrar metadatos
        const meta = districtsMetadata.find(d => d.filename === filename);
        if (!meta) return;

        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.style.background = 'rgba(34, 139, 34, 0.2)';
        tag.style.borderColor = 'rgba(34, 139, 34, 0.5)';
        tag.style.color = 'var(--text-main)';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = meta.name;
        tag.appendChild(nameSpan);

        // Botón para alternar vista de flor en este distrito
        const flowerBtn = document.createElement('span');
        flowerBtn.className = 'tag-flower-btn';
        const isFlowerEnabled = loadedDistrictsFlowers.has(filename);
        flowerBtn.innerHTML = isFlowerEnabled ? '🌸' : '❀';
        flowerBtn.title = "Alternar vista de flor en este distrito";
        flowerBtn.style.cursor = 'pointer';
        flowerBtn.style.marginLeft = '0.5rem';
        flowerBtn.style.opacity = isFlowerEnabled ? '1' : '0.5';
        
        flowerBtn.addEventListener('click', () => {
            if (isFlowerEnabled) {
                loadedDistrictsFlowers.delete(filename);
            } else {
                loadedDistrictsFlowers.add(filename);
            }
            renderDistrictTags();
            renderTrees();
        });
        tag.appendChild(flowerBtn);

        const closeBtn = document.createElement('span');
        closeBtn.className = 'tag-close';
        closeBtn.style.color = 'var(--accent)';
        closeBtn.innerHTML = '×';
        closeBtn.style.marginLeft = '0.5rem';
        closeBtn.addEventListener('click', () => {
            unloadDistrict(meta.name, filename);
        });
        tag.appendChild(closeBtn);

        container.appendChild(tag);
    });
}

function isLiving(tree) {
    const estado = (tree.estado || '').toLowerCase();
    const especie = (tree.especie || '').toLowerCase();
    
    const deadKeywords = ['tocón', 'tocon', 'vacío', 'vacio', 'eliminada', 'muerto', 'no plantar', 'marra'];
    
    // Si el estado o la especie contienen alguna de estas palabras, el árbol no cuenta como vivo
    if (deadKeywords.some(keyword => estado.includes(keyword) || especie.includes(keyword))) {
        return false;
    }
    
    return true;
}

// Renderizar Marcadores sobre el mapa
function renderTrees() {
    if (!markerLayerGroup) return;

    markerLayerGroup.clearLayers();
    currentMarkers = [];

    const livingOnly = livingOnlyFilter.checked;
    const threatenedOnly = threatenedFilter.checked;
    const protectedOnly = protectedFilter.checked;
    const isSingularFilterActive = singularFilter.checked;

    // Cache singular lookups
    const singularIndices = new Set(singularTrees.filter(t => t.idx !== null && t.idx !== undefined).map(t => t.idx));
    const singularCoords = new Set(singularTrees.filter(t => t.idx === null && t.lat && t.lon).map(t => `${Number(t.lat).toFixed(6)},${Number(t.lon).toFixed(6)}`));

    // Filtros lógicos
    let filteredTrees = allTrees.filter(tree => {
        // 1. Filtros restrictivos (Lógica AND)
        if (livingOnly && !isLiving(tree)) return false;
        if (selectedSpecies.length > 0 && !selectedSpecies.some(s => {
            if (s.name === 'Árbol muerto / Marra / Alcorque vacío') return !isLiving(tree);
            if (s.name === 'Especie desconocida / No consta') {
                 const lowerEsp = (tree.especie || '').toLowerCase();
                 return ['desconocida', 'no definido', 'no consta'].some(kw => lowerEsp.includes(kw));
            }
            return s.name === tree.especie;
        })) return false;
        
        // 2. Filtros de características especiales (Lógica OR aditiva)
        const hasSpecialActive = threatenedOnly || protectedOnly || isSingularFilterActive;
        
        if (hasSpecialActive) {
            const checkThreatened = threatenedOnly ? tree.amenazado : false;
            const checkProtected = protectedOnly ? tree.protegido : false;
            
            let checkSingular = false;
            if (isSingularFilterActive) {
                checkSingular = (tree.idx !== null && tree.idx !== undefined && singularIndices.has(tree.idx)) ||
                                (tree.lat && tree.lon && singularCoords.has(`${Number(tree.lat).toFixed(6)},${Number(tree.lon).toFixed(6)}`)) ||
                                (tree.singular === true);
            }
            
            // El árbol debe cumplir al menos una de las condiciones especiales activadas
            if (!checkThreatened && !checkProtected && !checkSingular) {
                return false;
            }
        }
        
        return true;
    });

    currentFilteredTrees = filteredTrees;

    // Determinar tamaños adaptativos de visualización según el nivel de zoom actual
    const currentZoom = map.getZoom();
    let r = 0.5; // Muy pequeños (0.5px de radio -> 1px de diámetro) a gran escala
    if (currentZoom >= 17) r = 4.5;
    else if (currentZoom >= 16) r = 3.5;
    else if (currentZoom >= 15) r = 2.2;
    else if (currentZoom >= 14) r = 1.4;
    else if (currentZoom >= 13) r = 0.8;

    const markersToAdd = [];

    filteredTrees.forEach((tree, idx) => {
        if (!tree.lat || !tree.lon) {
            currentMarkers.push(null);
            return;
        }

        const isSingular = (tree.idx !== null && tree.idx !== undefined && singularIndices.has(tree.idx)) ||
                           (tree.lat && tree.lon && singularCoords.has(`${Number(tree.lat).toFixed(6)},${Number(tree.lon).toFixed(6)}`)) ||
                           (tree.singular === true);

        let singularName = '';
        if (isSingular) {
            const match = singularTrees.find(t => 
                (t.idx !== null && t.idx !== undefined && t.idx === tree.idx) ||
                (t.lat && t.lon && Number(t.lat).toFixed(6) === Number(tree.lat).toFixed(6) && Number(t.lon).toFixed(6) === Number(tree.lon).toFixed(6))
            );
            if (match) singularName = match.name;
        }

        const speciesName = (!tree.especie || tree.especie === "NO ASIGNADO" || tree.especie === "S/D") 
            ? "Especie desconocida" 
            : tree.especie;
            
        const searchName = speciesName.replace(/\s+sp\.?$/i, '').replace(/\s+L\.?$/i, '');
        const speciesLink = (speciesName !== "Especie desconocida")
            ? `<a href="https://es.wikipedia.org/wiki/Especial:Buscar?search=${encodeURIComponent(searchName)}" target="_blank" style="color: inherit; text-decoration: underline;">${speciesName}</a>`
            : speciesName;

        let showFlowers = false;
        
        // 1. Si estamos en modo Global y el toggle global está activo
        if (currentMode === 'global' && showGlobalFlowers) {
            showFlowers = true;
        }
        // 2. Si estamos en modo Distritos y este distrito tiene la flor activa
        else if (currentMode === 'district') {
            const meta = districtsMetadata.find(d => d.name === tree.distrito);
            if (meta && loadedDistrictsFlowers.has(meta.filename)) {
                showFlowers = true;
            }
        }
        
        // 3. O si la especie del árbol está seleccionada explícitamente como flor
        if (!showFlowers && selectedSpecies.length > 0) {
            const match = selectedSpecies.find(s => s.name === tree.especie);
            if (match && match.showFlower) {
                showFlowers = true;
            }
        }

        // Scale down size by 20%
        let finalRadius = r * 0.8;
        if (isSingular) finalRadius = r * 1.5 * 0.8;

        let marker;
        // Determine fill color
        let fillColor = "#4CAF50"; // Default: Street / Viario
        if (tree.tipologia && tree.tipologia.toLowerCase().includes('parque')) {
            fillColor = "#2E7D32"; // Park
        }
        if (isSingular) fillColor = "#FBBF24";
        if (tree.protegido) fillColor = "#3B82F6";
        if (tree.amenazado) fillColor = "#EF4444";

        if (showFlowers && tree.flower_color && !isSingular && !tree.protegido && !tree.amenazado) {
            marker = L.circleMarker([tree.lat, tree.lon], {
                radius: finalRadius * 1.5,
                fillColor: tree.flower_color,
                stroke: false,
                fillOpacity: 0.9,
                isFlower: true
            });
        } else {
            marker = L.circleMarker([tree.lat, tree.lon], {
                radius: finalRadius,
                fillColor: fillColor,
                color: "#ffffff",
                weight: (isSingular || tree.protegido || tree.amenazado) ? 1 : 0,
                stroke: (isSingular || tree.protegido || tree.amenazado) ? true : false,
                fillOpacity: 0.8,
                isFlower: false
            });
        }

        marker.on('click', (e) => {
            if (e && e.originalEvent) L.DomEvent.stop(e.originalEvent); // Prevent map click reliably
            
            // Flag to prevent map.on('click') from closing it immediately just in case
            window.suppressMapClick = true;
            setTimeout(() => window.suppressMapClick = false, 100);

            openBottomSheet(tree, isSingular, speciesLink, marker);
        });

        marker._originalOptions = { ...marker.options };
        if (marker.options.icon) marker._originalIconOpacity = '1';

        if (currentMode === 'global') {
            markersToAdd.push(marker);
        } else {
            markerLayerGroup.addLayer(marker);
        }
        currentMarkers.push(marker);
    });

    if (currentMode === 'global') {
        markerLayerGroup.addLayers(markersToAdd);
    }

    statTotal.textContent = filteredTrees.length.toLocaleString('es-ES');
    
    // Calculate stats
    let uniqueSpecies = new Set();
    let totalHeight = 0;
    let heightCount = 0;
    
    filteredTrees.forEach(t => {
        if (t.especie && t.especie !== "NO ASIGNADO" && t.especie !== "S/D") {
            uniqueSpecies.add(t.especie);
        }
    });
    
    if (statSpecies) {
        statSpecies.textContent = uniqueSpecies.size.toLocaleString('es-ES');
    }
}


function hasFlowerColor(speciesName) {
    const dataToCheck = fullTreesCache || allTrees;
    return dataToCheck.some(t => t.especie === speciesName && t.flower_color);
}

// Pintar tags de especies seleccionadas en el sidebar
function renderTags() {
    tagsContainer.innerHTML = '';
    selectedSpecies.forEach((specieObj, index) => {
        const tag = document.createElement('div');
        tag.className = 'tag';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = specieObj.name;
        tag.appendChild(nameSpan);

        if (hasFlowerColor(specieObj.name)) {
            const flowerBtn = document.createElement('span');
            flowerBtn.className = 'tag-flower-btn';
            flowerBtn.innerHTML = specieObj.showFlower ? '🌸' : '❀';
            flowerBtn.title = "Alternar icono de flor";
            flowerBtn.style.cursor = 'pointer';
            flowerBtn.style.marginLeft = '0.5rem';
            flowerBtn.style.opacity = specieObj.showFlower ? '1' : '0.5';

            flowerBtn.addEventListener('click', () => {
                specieObj.showFlower = !specieObj.showFlower;
                renderTags();
                renderTrees();
            });
            tag.appendChild(flowerBtn);
        }

        const closeBtn = document.createElement('span');
        closeBtn.className = 'tag-close';
        closeBtn.innerHTML = '×';
        closeBtn.style.marginLeft = '0.5rem';
        closeBtn.addEventListener('click', () => {
            selectedSpecies.splice(index, 1);
            renderTags();
            renderTrees();
        });

        tag.appendChild(closeBtn);
        tagsContainer.appendChild(tag);
    });
}

// Configurar todos los manejadores de eventos
function setupEvents() {
    // Selectores de Modo en el sidebar
    // Handled in DOMContentLoaded now
    // btnModeGlobal.addEventListener('click', enterModeGlobal);
    // btnModeDistrict.addEventListener('click', enterModeDistrict);

    // Toggle global de flores en modo Global
    globalFlowerToggle.addEventListener('change', (e) => {
        showGlobalFlowers = e.target.checked;
        renderTrees();
    });

    // Filtros de formulario
    livingOnlyFilter.addEventListener('change', renderTrees);
    singularFilter.addEventListener('change', renderTrees);

    threatenedFilter.addEventListener('change', renderTrees);
    protectedFilter.addEventListener('change', renderTrees);

    // Input autocomplete buscador especies
    speciesSearch.addEventListener('input', function (e) {
        const val = this.value.trim().toLowerCase();
        autocompleteList.innerHTML = '';

        if (!val) {
            autocompleteList.classList.add('hidden');
            return;
        }

        autocompleteList.classList.remove('hidden');

        const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const searchVal = normalize(val);

        const suggestions = speciesList
            .filter(s => normalize(s.toLowerCase()).includes(searchVal) && !selectedSpecies.some(selected => selected.name === s))
            .slice(0, 50);

        suggestions.forEach(suggestion => {
            const div = document.createElement('div');
            // Accent-insensitive highlight
            let htmlContent = suggestion;
            if (searchVal) {
                // Find start index of match using normalized strings
                const matchIndex = normalize(suggestion.toLowerCase()).indexOf(searchVal);
                if (matchIndex !== -1) {
                    const before = suggestion.substring(0, matchIndex);
                    const matchText = suggestion.substring(matchIndex, matchIndex + searchVal.length);
                    const after = suggestion.substring(matchIndex + searchVal.length);
                    htmlContent = `${before}<strong>${matchText}</strong>${after}`;
                }
            }
            div.innerHTML = htmlContent;

            div.addEventListener('click', function () {
                speciesSearch.value = '';
                autocompleteList.classList.add('hidden');
                selectedSpecies.push({ name: suggestion, showFlower: false });
                renderTags();
                renderTrees();
            });
            autocompleteList.appendChild(div);
        });
    });

    document.addEventListener('click', function (e) {
        if (e.target !== speciesSearch && e.target !== autocompleteList) {
            autocompleteList.classList.add('hidden');
        }
    });

    // Buscador por IDX
    const idSearchInput = document.getElementById('id-search');
    const btnIdSearch = document.getElementById('btn-id-search');
    
    if (idSearchInput && btnIdSearch) {
        btnIdSearch.addEventListener('click', async () => {
            const idxStr = idSearchInput.value.trim();
            if (!idxStr) return;
            
            const originalText = btnIdSearch.textContent;
            btnIdSearch.textContent = '...';
            
            try {
                if (!censusData) {
                    alert("La base de datos global aún se está cargando en segundo plano. Por favor, inténtalo de nuevo en un par de segundos.");
                    return;
                }
                
                const targetIdx = parseInt(idxStr, 10);
                const tree = censusData.find(t => t.idx === targetIdx);
                
                if (!tree) {
                    alert("No se encontró ningún árbol con ese identificador.");
                    return;
                }
                
                if (tree) {
                    
                    // Asegurarnos de que el mapa está en modo distrito o global (si es distrito, cargarlo si no lo está)
                    if (currentMode === 'district' && tree.distrito) {
                        const meta = districtsMetadata.find(d => d.name === tree.distrito);
                        if (meta && !loadedDistricts.has(meta.filename)) {
                            await loadDistrictAndAppend(meta.name, meta.filename);
                        }
                    } else if (currentMode === 'global' && !fullTreesCache) {
                        // En modo global asegurarnos de que está cargado todo
                        await enterModeGlobal();
                    }
                    
                    // Flag para map click
                    window.suppressMapClick = true;
                    setTimeout(() => window.suppressMapClick = false, 100);

                    // Buscar el marcador correspondiente (debe estar visible según los filtros)
                    const markerIndex = currentFilteredTrees.findIndex(t => t.idx === tree.idx);
                    
                    if (markerIndex !== -1 && currentMarkers[markerIndex]) {
                        let isSingular = singularTrees.some(t => t.idx === tree.idx || (tree.nombre_comun && t.nombre_comun === tree.nombre_comun));
                        let speciesName = tree.especie || 'Desconocida';
                        let searchName = speciesName.replace(/\s+sp\.?$/i, '').replace(/\s+L\.?$/i, '');
                        let speciesLink = (speciesName !== 'Desconocida')
                            ? `<a href="https://es.wikipedia.org/wiki/Especial:Buscar?search=${encodeURIComponent(searchName)}" target="_blank" title="Ver en Wikipedia" class="species-link">${speciesName}</a>`
                            : speciesName;

                        const doFlyAndOpen = () => {
                            openBottomSheet(tree, isSingular, speciesLink, currentMarkers[markerIndex]);
                            // Volar hacia el árbol con offset para la tarjeta
                            const mapHeight = map.getSize().y;
                            const offset = mapHeight * 0.25;
                            const point = map.project([tree.lat, tree.lon], 20);
                            point.y += offset;
                            const latlng = map.unproject(point, 20);
                            map.flyTo(latlng, 20, { duration: 1.0 });
                        };

                        // En caso de que haya clustering, hay que revelar el marcador primero
                        if (currentMode === 'global' && markerLayerGroup) {
                            try { markerLayerGroup.zoomToShowLayer(currentMarkers[markerIndex]); } catch(e) {}
                        }
                        
                        // Always open the sheet and fly to the point, bypassing MarkerCluster's buggy callback
                        setTimeout(doFlyAndOpen, 50);
                    } else {
                        alert(`El árbol ${tree.idx} se encuentra aquí, pero actualmente está oculto por tus filtros.`);
                    }
                }
            } catch (err) {
                console.error(err);
                alert("Error al buscar el árbol: " + err.message);
            } finally {
                btnIdSearch.textContent = originalText;
            }
        });
        
        idSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') btnIdSearch.click();
        });
    }
}

// Parse Semicolon CSV
function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(';').map(h => h.trim().replace(/^\uFEFF/, ''));
    const results = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = line.split(';').map(v => v.trim());
        const row = {};
        headers.forEach((header, idx) => {
            row[header] = values[idx] || '';
        });
        
        results.push({
            num: row['Nº Ejemplar (Guía)'] || '',
            code: row['Código'] || '',
            name: row['Nombre Singular (Guía)'] || '',
            especie: row['Especie Científica'] || '',
            lat: row['Latitud'] ? parseFloat(row['Latitud'].replace(',', '.')) : null,
            lon: row['Longitud'] ? parseFloat(row['Longitud'].replace(',', '.')) : null,
            idx: row['IDX'] ? parseInt(row['IDX'], 10) : null
        });
    }
    return results;
}

// Load Census Data in background to enrich CSV trees lacking details
async function loadCensusDataBackground() {
    try {
        const response = await fetch(`trees.json?v=${Date.now()}`);
        if (response.ok) {
            censusData = await response.json();
            console.log("Censo de Sevilla cargado en segundo plano.");
            // Re-render if filter is active
            if (singularFilter.checked) {
                renderTrees();
            }
        }
    } catch (e) {
        console.error("No se pudo cargar el censo en segundo plano", e);
    }
}

// Load singular trees from CSV
async function loadSingularTrees() {
    try {
        const response = await fetch(`data/singular_trees.csv?v=${Date.now()}`);
        if (response.ok) {
            const text = await response.text();
            singularTrees = parseCSV(text);
            console.log(`Cargados ${singularTrees.length} árboles singulares del CSV.`);
            renderTrees();
        }
    } catch (e) {
        console.error("Error al cargar singular_trees.csv", e);
    }
}

// Enrich Singular tree with census metadata if available
function enrichTreeFromOfficial(st) {
    if (st.idx === null || st.idx === undefined) return st;
    
    let officialTree = null;
    // 1. Check currently loaded district/global data
    if (allTrees && allTrees.length > 0) {
        officialTree = allTrees.find(t => t.idx === st.idx);
    }
    // 2. Check full background censusData
    if (!officialTree && censusData) {
        officialTree = censusData[st.idx];
    }
    
    if (officialTree) {
        return {
            ...st,
            especie: st.especie || officialTree.especie || 'Desconocida',
            lat: st.lat !== null ? st.lat : officialTree.lat,
            lon: st.lon !== null ? st.lon : officialTree.lon,
            distrito: officialTree.distrito || '',
            barrio: (officialTree.barrio || '').replace(/\n/g, ' '),
            altura: officialTree.altura || '',
            estado: officialTree.estado || '',
            tipologia: officialTree.tipologia || '',
            amenazado: officialTree.amenazado || false,
            protegido: officialTree.protegido || false,
            categoria_amenaza: officialTree.categoria_amenaza || '',
            categoria_proteccion: officialTree.categoria_proteccion || ''
        };
    }
    return st;
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupEvents();
    loadInitialMetadata();
    enterModeGlobal(); // Cargar modo global por defecto al arrancar
    loadSingularTrees(); // Cargar árboles singulares del CSV
    loadCensusDataBackground(); // Cargar censo de Sevilla en segundo plano

    // Lógica para colapsar el menú lateral (Responsive)
    const toggleBtn = document.getElementById('toggle-sidebar-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('sidebar-collapsed');
            
            if (document.body.classList.contains('sidebar-collapsed')) {
                toggleBtn.title = "Mostrar Menú";
                toggleBtn.innerHTML = '<i data-lucide="chevron-right"></i>';
            } else {
                toggleBtn.title = "Ocultar Menú";
                toggleBtn.innerHTML = '<i data-lucide="chevron-left"></i>';
            }
            lucide.createIcons();

            // Recalcular tamaño del mapa tras la animación
            setTimeout(() => {
                if (map) map.invalidateSize();
            }, 300);
        });
    }

    // Lógica del modal "Acerca de"
    const aboutBtn = document.getElementById('about-btn');
    const aboutModal = document.getElementById('about-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');

    if (aboutBtn && aboutModal && closeModalBtn) {
        aboutBtn.addEventListener('click', () => {
            aboutModal.classList.remove('hidden');
        });

        closeModalBtn.addEventListener('click', () => {
            aboutModal.classList.add('hidden');
        });

        // Cerrar al hacer clic fuera del contenido
        aboutModal.addEventListener('click', (e) => {
            if (e.target === aboutModal) {
                aboutModal.classList.add('hidden');
            }
        });
    }
});

// ==========================================
// NEW UI LOGIC (Apple Maps Aesthetic)
// ==========================================

let currentlySelectedMarker = null;

function resetSelectedMarker() {
    if (currentlySelectedMarker && currentlySelectedMarker.setStyle) {
        currentlySelectedMarker.setStyle({
            stroke: currentlySelectedMarker.options.originalWeight > 0,
            weight: currentlySelectedMarker.options.originalWeight !== undefined ? currentlySelectedMarker.options.originalWeight : 0,
            color: currentlySelectedMarker.options.originalColor || "#ffffff"
        });
        currentlySelectedMarker = null;
    }
}

function openBottomSheet(tree, isSingular, speciesLink, marker) {
    try {
        resetSelectedMarker();
        if (marker && marker.setStyle) {
            currentlySelectedMarker = marker;
            marker.options.originalWeight = marker.options.weight;
            marker.options.originalColor = marker.options.color;
            marker.setStyle({
                stroke: true,
                weight: 4,
                color: "#ffffff"
            });
            if (marker.bringToFront) {
                try { marker.bringToFront(); } catch(e) {}
            }
        }

        const sheet = document.getElementById('tree-bottom-sheet');
        const title = document.getElementById('sheet-title');
        const subtitle = document.getElementById('sheet-subtitle');
        const badges = document.getElementById('sheet-badges');
        const loc = document.getElementById('sheet-location');
        const height = document.getElementById('sheet-height');
        const status = document.getElementById('sheet-status');

        if (isSingular) {
            if (tree.nombre_comun && tree.nombre_comun !== tree.especie) {
                title.innerHTML = tree.nombre_comun;
                subtitle.innerHTML = `Especie: ${speciesLink}`;
                subtitle.style.display = 'block';
            } else {
                title.innerHTML = speciesLink;
                subtitle.style.display = 'none';
            }
        } else {
            title.innerHTML = speciesLink;
            subtitle.innerHTML = tree.familia ? `Familia: ${tree.familia}` : (tree.nombre_comun || '');
            subtitle.style.display = subtitle.innerHTML ? 'block' : 'none';
        }

        // Build Badges in multiple lines
        let html = '<div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">';
        
        // Line 1: ID
        if (tree.idx) {
            html += `<div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                        <span class="tag" style="background: rgba(255,255,255,0.08); color: var(--text-muted);"># ${tree.idx}</span>
                     </div>`;
        }
        
        // Line 2: Status
        let statusBadges = [];
        if (isSingular) {
            statusBadges.push(`<span class="tag" style="background: rgba(251,191,36,0.2); color: #FBBF24;">Singular</span>`);
        }
        if (tree.protegido) {
            let protText = tree.figura_proteccion ? `Protegido (${tree.figura_proteccion})` : `Protegido`;
            statusBadges.push(`<span class="tag" style="background: rgba(59,130,246,0.2); color: #3B82F6;">${protText}</span>`);
        }
        if (tree.amenazado) {
            let threatText = tree.categoria_amenaza ? `Amenazado (${tree.categoria_amenaza})` : `Amenazado`;
            statusBadges.push(`<span class="tag" style="background: rgba(239,68,68,0.2); color: #EF4444;">${threatText}</span>`);
        }
        if (statusBadges.length > 0) {
            html += `<div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">${statusBadges.join('')}</div>`;
        }
        
        // Line 3: Type
        if (tree.tipologia) {
            html += `<div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                        <span class="tag" style="background: rgba(255,255,255,0.1); color: var(--text-main);">${tree.tipologia}</span>
                     </div>`;
        }
        
        html += '</div>';
        badges.innerHTML = html;
        
        loc.textContent = `${tree.distrito || 'Sin distrito'}, ${tree.barrio || 'Sin barrio'}`;
        height.textContent = tree.altura ? `${tree.altura} m` : 'Desconocida';
        status.textContent = tree.estado || 'Normal';



        sheet.classList.remove('hidden');
    } catch (err) {
        alert("Error en openBottomSheet: " + err.message);
        console.error(err);
    }
}

// Event Listeners for new UI
document.addEventListener('DOMContentLoaded', () => {
    // Mode toggles
    const rGlobal = document.getElementById('mode-global');
    const rDistrict = document.getElementById('mode-district');
    
    if (rGlobal && rDistrict) {
        rGlobal.addEventListener('change', () => {
            if (rGlobal.checked) enterModeGlobal();
        });
        rDistrict.addEventListener('change', () => {
            if (rDistrict.checked) enterModeDistrict();
        });
    }

    // Bottom sheet close
    const closeSheetBtn = document.getElementById('close-sheet-btn');
    if (closeSheetBtn) {
        closeSheetBtn.addEventListener('click', () => {
            document.getElementById('tree-bottom-sheet').classList.add('hidden');
            resetSelectedMarker();
        });
    }

    // Also close sheet and reset marker when map is clicked
    map.on('click', () => {
        if (window.suppressMapClick) return;
        document.getElementById('tree-bottom-sheet').classList.add('hidden');
        resetSelectedMarker();
    });

    // FAB Buttons
    const fabHome = document.getElementById('fab-home');
    const fabLayers = document.getElementById('fab-layers');
    const fabGps = document.getElementById('fab-gps');

    if (fabHome) {
        fabHome.addEventListener('click', () => {
            map.setView([37.3891, -5.9845], 13);
        });
    }

    if (fabLayers) {
        fabLayers.addEventListener('click', () => {
            if (map.hasLayer(satelliteLayer)) {
                map.removeLayer(satelliteLayer);
                darkLayer.addTo(map);
                fabLayers.classList.remove('active-layer');
            } else {
                map.removeLayer(darkLayer);
                satelliteLayer.addTo(map);
                fabLayers.classList.add('active-layer');
            }
        });
    }

    if (fabGps) {
        fabGps.addEventListener('click', () => {
            if (!navigator.geolocation) {
                alert('Tu navegador no soporta geolocalización.');
                return;
            }
            fabGps.style.color = '#FBBF24'; // Loading state
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    fabGps.style.color = '';
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    map.flyTo([lat, lng], 17, { duration: 1.5 });
                    
                    if (window.userLocationMarker) {
                        window.userLocationMarker.setLatLng([lat, lng]);
                    } else {
                        window.userLocationMarker = L.marker([lat, lng], {
                            icon: L.divIcon({
                                className: 'user-location-custom',
                                html: '<div class="gps-pulse"></div><div class="gps-core"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg></div>',
                                iconSize: [28, 28],
                                iconAnchor: [14, 14]
                            })
                        }).addTo(map);
                    }
                },
                (error) => {
                    fabGps.style.color = '';
                    console.warn('Error GPS:', error);
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        });
    }
});

