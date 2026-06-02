// Elements
const speciesSearch = document.getElementById('species-search');
const autocompleteList = document.getElementById('autocomplete-list');
const tagsContainer = document.getElementById('selected-species-tags');
const livingOnlyFilter = document.getElementById('living-only-filter');
const threatenedFilter = document.getElementById('threatened-filter');
const protectedFilter = document.getElementById('protected-filter');
const singularFilter = document.getElementById('singular-filter');
const statTotal = document.getElementById('stat-total');
const loader = document.getElementById('loader');
const loaderText = document.getElementById('loader-text');
const visibleTreesList = document.getElementById('visible-trees-list');

// Panels
const controlsPanel = document.getElementById('controls-panel');
const statsPanel = document.getElementById('stats-panel');
const listPanel = document.getElementById('list-panel');

// Mode selectors
const btnModeGlobal = document.getElementById('btn-mode-global');
const btnModeDistrict = document.getElementById('btn-mode-district');

// Global Flower Elements
const globalFlowerToggle = document.getElementById('global-flower-toggle');
const globalFlowerControl = document.getElementById('global-flower-control');

// App State
let currentMode = 'district'; // Default to district mode on startup
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
function initMap() {
    map = L.map('map', {
        zoomControl: false,
        preferCanvas: true
    }).setView([37.3891, -5.9845], 13);
    
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OSM contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

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
        if (speciesResponse.ok) speciesList = await speciesResponse.json();

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
    btnModeGlobal.classList.remove('active');
    btnModeDistrict.classList.remove('active');

    if (currentMode === 'global') btnModeGlobal.classList.add('active');
    else if (currentMode === 'district') btnModeDistrict.classList.add('active');
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
            const response = await fetch(`../trees.json?v=${Date.now()}`);
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
    
    map.setView([37.3891, -5.9845], 13);
    
    statTotal.textContent = "0";
    visibleTreesList.innerHTML = '';
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
    if (estado.includes('tocón') || estado.includes('vacío') || estado.includes('eliminada') || estado.includes('muerto') || estado.includes('no plantar')) return false;
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
        if (livingOnly && !isLiving(tree)) return false;
        if (threatenedOnly && !tree.amenazado) return false;
        if (protectedOnly && !tree.protegido) return false;
        if (selectedSpecies.length > 0 && !selectedSpecies.some(s => s.name === tree.especie)) return false;
        
        if (isSingularFilterActive) {
            const isSingular = (tree.idx !== null && tree.idx !== undefined && singularIndices.has(tree.idx)) ||
                               (tree.lat && tree.lon && singularCoords.has(`${Number(tree.lat).toFixed(6)},${Number(tree.lon).toFixed(6)}`)) ||
                               (tree.singular === true);
            if (!isSingular) return false;
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

        const titleText = isSingular 
            ? `Árbol Singular: ${singularName || tree.especie || 'Singular'}` 
            : `${tree.especie || 'Desconocida'} ${tree.amenazado ? '⚠️' : ''} ${tree.protegido && !tree.amenazado ? '🛡️' : ''}`;

        const popupContent = `
            <div class="tree-popup">
                <h3 style="${isSingular ? 'color: #ca8a04; font-weight: 700;' : ''}">${titleText}</h3>
                ${isSingular ? `<p style="color: #eab308; font-weight: 600;">Especie: ${tree.especie || '-'}</p>` : ''}
                <p><strong>Distrito:</strong> ${tree.distrito || '-'}</p>
                <p><strong>Barrio:</strong> ${tree.barrio || '-'}</p>
                <p><strong>Altura:</strong> ${tree.altura ? tree.altura + 'm' : '-'}</p>
                <p><strong>Estado:</strong> ${tree.estado || 'Normal'}</p>
                ${tree.categoria_amenaza ? `<p style="color: #ef4444;"><strong>Amenaza:</strong> ${tree.categoria_amenaza}</p>` : ''}
                ${tree.categoria_proteccion && !tree.categoria_amenaza ? `<p style="color: #3b82f6;"><strong>Protección:</strong> ${tree.categoria_proteccion}</p>` : ''}
                ${tree.idx !== null && tree.idx !== undefined ? `<p style="color: #94a3b8; font-size: 0.75rem;">IDX Censo: ${tree.idx}</p>` : ''}
            </div>
        `;

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

        // Optimized Vector Drawing on HTML5 Canvas:
        // We always use L.circleMarker (which renders on Canvas without creating DOM nodes).
        let marker;
        if (isSingular) {
            // Render singular tree in Gold
            marker = L.circleMarker([tree.lat, tree.lon], {
                radius: r * 1.8, // Slightly larger
                fillColor: "#EAB308", // Gold
                color: "#FFFFFF",
                weight: 1.5,
                stroke: true,
                fillOpacity: 1,
                isFlower: false
            });
        } else if (showFlowers && tree.flower_color) {
            marker = L.circleMarker([tree.lat, tree.lon], {
                radius: r * 1.5,
                fillColor: tree.flower_color,
                stroke: false,
                fillOpacity: 0.9,
                isFlower: true
            });
        } else {
            marker = L.circleMarker([tree.lat, tree.lon], {
                radius: r,
                fillColor: "#228B22", // Forest Green
                stroke: false,
                fillOpacity: 0.8,
                isFlower: false
            });
        }

        marker.bindPopup(popupContent);
        marker._originalOptions = marker.options;
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

    statTotal.textContent = filteredTrees.length.toLocaleString();

    // Resetear lista sidebar
    visibleTreesList.innerHTML = '';
    currentListIndex = 0;
    renderTreeListChunk();
}

// Pintar fragmento virtualizado en la lista del sidebar
function renderTreeListChunk() {
    const singularIndices = new Set(singularTrees.filter(t => t.idx !== null && t.idx !== undefined).map(t => t.idx));
    const singularCoords = new Set(singularTrees.filter(t => t.idx === null && t.lat && t.lon).map(t => `${Number(t.lat).toFixed(6)},${Number(t.lon).toFixed(6)}`));

    const end = Math.min(currentListIndex + CHUNK_SIZE, currentFilteredTrees.length);
    for (let i = currentListIndex; i < end; i++) {
        const tree = currentFilteredTrees[i];
        const marker = currentMarkers[i];

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

        const item = document.createElement('div');
        item.className = 'tree-item';
        if (isSingular) {
            item.style.borderColor = 'rgba(234, 179, 8, 0.4)';
            item.style.background = 'rgba(234, 179, 8, 0.05)';
        }

        const title = document.createElement('div');
        title.className = 'tree-item-title';
        if (isSingular) {
            title.innerHTML = `${singularName || tree.especie || 'Singular'}`;
            title.style.color = '#eab308';
        } else {
            title.innerHTML = `${tree.especie || 'Desconocida'} ${tree.amenazado ? '⚠️' : ''} ${tree.protegido && !tree.amenazado ? '🛡️' : ''}`;
        }

        const subtitle = document.createElement('div');
        subtitle.className = 'tree-item-subtitle';
        subtitle.textContent = `[ID: ${tree.idx || '-'}] ${tree.barrio || '-'}, ${tree.distrito || '-'}`;

        item.appendChild(title);
        item.appendChild(subtitle);

        // Hover events para destacar el marcador
        item.addEventListener('mouseenter', () => {
            if (!marker) return;
            currentMarkers.forEach(m => {
                if (!m) return;
                if (m === marker) {
                    if (m.setStyle) {
                        m.setStyle({ fillColor: '#FDE047', color: '#EAB308', fillOpacity: 1, radius: (m.options.radius || 4) + 3 });
                    }
                    if (m._icon) m._icon.style.opacity = '1';
                    if (m._icon) m._icon.style.transform += ' scale(1.5)';
                } else {
                    if (m.setStyle) {
                        m.setStyle({ fillOpacity: 0.15, opacity: 0.15 });
                    }
                    if (m._icon) m._icon.style.opacity = '0.2';
                }
            });
        });

        item.addEventListener('mouseleave', () => {
            currentMarkers.forEach(m => {
                if (!m) return;
                if (m.setStyle) m.setStyle(m._originalOptions);
                if (m._icon) {
                    m._icon.style.opacity = m._originalIconOpacity || '1';
                    m._icon.style.transform = m._icon.style.transform.replace(' scale(1.5)', '');
                }
            });
        });

        // Click para enfocar
        item.addEventListener('click', () => {
            if (tree.lat && tree.lon && marker) {
                if (currentMode === 'global') {
                    markerLayerGroup.zoomToShowLayer(marker, () => {
                        map.setView([tree.lat, tree.lon], 18);
                        marker.openPopup();
                    });
                } else {
                    map.setView([tree.lat, tree.lon], 18);
                    marker.openPopup();
                }
            }
        });

        visibleTreesList.appendChild(item);
    }

    currentListIndex = end;
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
    btnModeGlobal.addEventListener('click', enterModeGlobal);
    btnModeDistrict.addEventListener('click', enterModeDistrict);

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

        const suggestions = speciesList
            .filter(s => s.toLowerCase().includes(val) && !selectedSpecies.some(selected => selected.name === s))
            .slice(0, 50);

        suggestions.forEach(suggestion => {
            const div = document.createElement('div');
            const regex = new RegExp(`(${val})`, "gi");
            div.innerHTML = suggestion.replace(regex, "<strong>$1</strong>");

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

    // Scroll infinito lista
    visibleTreesList.addEventListener('scroll', function () {
        if (this.scrollTop + this.clientHeight >= this.scrollHeight - 50) {
            if (currentListIndex < currentFilteredTrees.length) {
                renderTreeListChunk();
            }
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
                    
                    // Volar hacia el árbol
                    map.flyTo([tree.lat, tree.lon], 20, { duration: 1.5 });
                    
                    // Esperar a que termine el vuelo y abrir el popup
                    map.once('moveend', () => {
                        // Buscar el marcador correspondiente (debe estar visible según los filtros)
                        const markerIndex = currentFilteredTrees.findIndex(t => t.idx === tree.idx);
                        
                        if (markerIndex !== -1 && currentMarkers[markerIndex]) {
                            // En caso de que haya clustering, hay que revelar el marcador primero
                            if (currentMode === 'global' && markerLayerGroup) {
                                markerLayerGroup.zoomToShowLayer(currentMarkers[markerIndex], () => {
                                    currentMarkers[markerIndex].openPopup();
                                });
                            } else {
                                currentMarkers[markerIndex].openPopup();
                            }
                        } else {
                            alert(`El árbol ${tree.idx} se encuentra aquí, pero actualmente está oculto por tus filtros.`);
                        }
                    });
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
        const response = await fetch(`../trees.json?v=${Date.now()}`);
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
    enterModeDistrict(); // Cargar modo distritos por defecto al arrancar
    loadSingularTrees(); // Cargar árboles singulares del CSV
    loadCensusDataBackground(); // Cargar censo de Sevilla en segundo plano

    // Lógica para colapsar el menú lateral
    const toggleBtn = document.getElementById('toggle-sidebar-btn');
    const sidebar = document.getElementById('sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            // Recalcular tamaño del mapa tras la animación (0.3s)
            setTimeout(() => {
                if (map) map.invalidateSize();
            }, 300);
        });
    }
});
