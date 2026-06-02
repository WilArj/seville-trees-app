// Global State
let map;
let editorMode = 'menu'; // 'menu' | 'create' | 'edit'
let districtsMeta = [];   
let districtBoundaries = {}; 
let loadedDistrictsData = {}; // Cache of loaded district trees: { 'Sur': [...], 'Macarena': [...] }
let loadedDistrictTrees = []; // Flattened array of all currently loaded trees
let activeTreeIdx = null;     // Currently selected tree's idx

let canvasLayerGroup = null;
let activeDragMarker = null;
let boundariesLayerGroup = null;

let fullTreesCache = null;
let globalTreesClusterGroup = null;

// UI Elements
const inputLat = document.getElementById('input-lat');
const inputLon = document.getElementById('input-lon');
const inputEspecie = document.getElementById('input-especie');
const inputDistrict = document.getElementById('input-district');
const inputSingular = document.getElementById('input-singular');

const btnDelete = document.getElementById('btn-delete');
const btnClear = document.getElementById('btn-clear');
const btnSaveAll = document.getElementById('btn-save-all');
const singularTreesList = document.getElementById('singular-trees-list');
const countRegistered = document.getElementById('count-registered');
const selectedIndicator = document.getElementById('selected-indicator');
const loader = document.getElementById('loader');
const loaderText = document.getElementById('loader-text');
const toastEl = document.getElementById('toast');

// Mode buttons and panels
const btnModeCreate = document.getElementById('btn-mode-create');
const btnModeEdit = document.getElementById('btn-mode-edit');
const btnTopBack = document.getElementById('btn-top-back');

const menuView = document.getElementById('menu-view');
const activeEditorView = document.getElementById('active-editor-view');
const editModeControls = document.getElementById('edit-mode-controls');
const loadedDistrictsTags = document.getElementById('loaded-districts-tags');
const editorDescription = document.getElementById('editor-description');

// Viewport-based List Chunk variables
let currentFilteredTrees = [];
let currentListIndex = 0;
const CHUNK_SIZE = 100;

// Track modified districts to sync only what changed
const modifiedDistricts = new Set();

function trackModifiedDistrict(districtName) {
    if (!districtName || districtName === 'Desconocido') return;
    modifiedDistricts.add(districtName);
    console.log(`Distrito marcado para guardar: ${districtName}`);
}

// Custom Circle style for draggable active marker
function getMarkerIcon(singular, selected = false) {
    const color = singular ? '#eab308' : (selected ? '#22c55e' : '#228B22');
    const shadowColor = singular ? 'rgba(234, 179, 8, 0.8)' : (selected ? 'rgba(34, 197, 94, 0.8)' : 'rgba(0,0,0,0.5)');
    const scale = singular ? 'scale(1.15)' : 'none';
    const border = '2px solid #ffffff';
    
    return L.divIcon({
        html: `<div class="editor-tree-marker ${selected ? 'selected' : ''}" style="
            width: 14px;
            height: 14px;
            background-color: ${color};
            border: ${border};
            border-radius: 50%;
            box-shadow: 0 0 10px ${shadowColor};
            transform: ${scale};
            cursor: move;
        "></div>`,
        className: 'custom-tree-icon-container',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });
}

// Find district name by coordinates using turf.js
function findDistrictForCoords(lat, lon) {
    if (typeof turf === 'undefined') return 'Desconocido';
    
    const pt = turf.point([lon, lat]); // turf uses [lon, lat]
    
    for (const [districtName, info] of Object.entries(districtBoundaries)) {
        if (!info.polygon) continue;
        
        try {
            const isMulti = Array.isArray(info.polygon[0]) && Array.isArray(info.polygon[0][0]);
            let poly;
            
            if (isMulti) {
                const multiCoords = info.polygon.map(ring => {
                    let r = ring.map(p => [p[1], p[0]]); // Leaflet is [lat, lon], Turf is [lon, lat]
                    if (r.length > 0 && (r[0][0] !== r[r.length-1][0] || r[0][1] !== r[r.length-1][1])) {
                        r.push([...r[0]]);
                    }
                    return [r]; // Each ring is wrapped in an array for polygon holes spec
                });
                poly = turf.multiPolygon(multiCoords);
            } else {
                let ring = info.polygon.map(p => [p[1], p[0]]);
                if (ring.length > 0 && (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1])) {
                    ring.push([...ring[0]]);
                }
                poly = turf.polygon([ring]);
            }
            
            if (turf.booleanPointInPolygon(pt, poly)) {
                return districtName;
            }
        } catch(e) {
            console.error("Turf spatial check error:", e);
        }
    }
    return 'Desconocido';
}

// Display unified toast message
function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    setTimeout(() => {
        toastEl.classList.remove('show');
    }, 3500);
}

function computeLoadedDistrictTrees() {
    loadedDistrictTrees = Object.values(loadedDistrictsData).flat();
}

// Initialize Leaflet Map
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

    map.on('click', (e) => {
        if (editorMode === 'menu') return;
        const lat = parseFloat(e.latlng.lat.toFixed(6));
        const lon = parseFloat(e.latlng.lng.toFixed(6));
        selectNewPosition(lat, lon);
    });

    map.on('moveend', () => {
        updateVisibleMarkers();
    });
}

// Load metadata lists
async function loadInitialMetadata() {
    try {
        const distResp = await fetch(`data/districts.json?v=${Date.now()}`);
        if (distResp.ok) {
            districtsMeta = await distResp.json();
        }
        
        const boundResp = await fetch(`data/district-boundaries.json?v=${Date.now()}`);
        if (boundResp.ok) {
            districtBoundaries = await boundResp.json();
            if (editorMode !== 'menu') {
                drawDistrictBoundaries();
            }
        }
    } catch (e) {
        console.error("Error cargando metadatos iniciales", e);
    }
}

// Draw boundary outlines of all districts on the map
function drawDistrictBoundaries() {
    if (boundariesLayerGroup) {
        map.removeLayer(boundariesLayerGroup);
    }
    boundariesLayerGroup = L.layerGroup().addTo(map);

    for (const [districtName, info] of Object.entries(districtBoundaries)) {
        if (!info.polygon) continue;

        const isLoaded = !!loadedDistrictsData[districtName];
        
        const polygon = L.polygon(info.polygon, {
            color: isLoaded ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255, 255, 255, 0.15)',
            fillColor: '#22c55e',
            fillOpacity: isLoaded ? 0.0 : 0.01,
            weight: 1.5,
            dashArray: isLoaded ? '' : '3, 3'
        });
        
        polygon.on('mouseover', () => {
            if (editorMode === 'menu' || !!loadedDistrictsData[districtName]) return;
            polygon.setStyle({
                color: 'rgba(34, 197, 94, 0.5)',
                fillOpacity: 0.05
            });
        });
        
        polygon.on('mouseout', () => {
            if (editorMode === 'menu' || !!loadedDistrictsData[districtName]) return;
            polygon.setStyle({
                color: 'rgba(255, 255, 255, 0.15)',
                fillOpacity: 0.01
            });
        });
        
        polygon.on('click', (e) => {
            if (editorMode === 'edit') {
                L.DomEvent.stopPropagation(e);
                if (!loadedDistrictsData[districtName]) {
                    loadDistrictByName(districtName, info.filename);
                }
            }
        });
        
        const tooltipText = isLoaded ? `<strong>${districtName}</strong> (Cargado)` : `<strong>${districtName}</strong><br>Clic para cargar`;
        polygon.bindTooltip(tooltipText, { sticky: true, className: 'district-tooltip' });
        boundariesLayerGroup.addLayer(polygon);
    }
}

// Load a specific district by clicking on the map
async function loadDistrictByName(districtName, filename) {
    if (loadedDistrictsData[districtName]) return; // Already loaded or loading
    
    loadedDistrictsData[districtName] = []; // Lock to prevent race condition
    
    loader.classList.remove('hidden');
    loaderText.textContent = `Descargando árboles del distrito ${districtName}...`;
    
    try {
        const response = await fetch(`data/${filename}?v=${Date.now()}`);
        if (response.ok) {
            loadedDistrictsData[districtName] = await response.json();
            computeLoadedDistrictTrees();
            renderDistrictTags();
            drawDistrictBoundaries(); // Redraw to update colors
            updateVisibleMarkers();
        } else {
            throw new Error(`No se pudo cargar el archivo data/${filename}`);
        }
    } catch (e) {
        console.error(e);
        delete loadedDistrictsData[districtName]; // Release lock
        alert("Error cargando distrito: " + e.message);
    } finally {
        loader.classList.add('hidden');
    }
}

function unloadDistrict(districtName) {
    delete loadedDistrictsData[districtName];
    // If the active tree was in this district, clear it
    if (activeTreeIdx) {
        const activeTree = loadedDistrictTrees.find(t => t.idx === activeTreeIdx);
        if (activeTree && activeTree.distrito === districtName) {
            clearForm();
        }
    }
    computeLoadedDistrictTrees();
    renderDistrictTags();
    drawDistrictBoundaries();
    updateVisibleMarkers();
}

function renderDistrictTags() {
    loadedDistrictsTags.innerHTML = '';
    const loadedNames = Object.keys(loadedDistrictsData);
    
    if (loadedNames.length === 0) {
        loadedDistrictsTags.innerHTML = '<span class="no-tags-placeholder">Ningún distrito cargado.</span>';
        return;
    }
    
    loadedNames.forEach(name => {
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.style.background = 'rgba(34, 139, 34, 0.2)';
        tag.style.borderColor = 'rgba(34, 139, 34, 0.5)';
        tag.style.color = 'var(--text-main)';
        tag.style.padding = '0.3rem 0.6rem';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;
        tag.appendChild(nameSpan);

        const closeBtn = document.createElement('span');
        closeBtn.className = 'tag-close';
        closeBtn.style.color = 'var(--accent)';
        closeBtn.innerHTML = '×';
        closeBtn.style.marginLeft = '0.5rem';
        closeBtn.addEventListener('click', () => {
            unloadDistrict(name);
        });
        tag.appendChild(closeBtn);

        loadedDistrictsTags.appendChild(tag);
    });
}

// Switch Sidebar View & Lock Map if needed
function switchMode(mode) {
    editorMode = mode;
    
    menuView.classList.add('hidden');
    activeEditorView.classList.add('hidden');
    editModeControls.classList.add('hidden');
    
    clearForm();
    if (canvasLayerGroup) {
        map.removeLayer(canvasLayerGroup);
        canvasLayerGroup = null;
    }
    
    if (btnTopBack) {
        btnTopBack.textContent = mode === 'menu' ? '⬅ Volver a la App' : '⬅ Volver al Menú';
    }
    
    if (mode === 'menu') {
        menuView.classList.remove('hidden');
        editorDescription.textContent = 'Elige una opción para empezar a gestionar el censo.';
        
        // Reset everything
        loadedDistrictsData = {};
        computeLoadedDistrictTrees();
        modifiedDistricts.clear();
        
        fullTreesCache = null;
        if (globalTreesClusterGroup) {
            if (map.hasLayer(globalTreesClusterGroup)) {
                map.removeLayer(globalTreesClusterGroup);
            }
            globalTreesClusterGroup = null;
        }
        
        if (boundariesLayerGroup) {
            map.removeLayer(boundariesLayerGroup);
            boundariesLayerGroup = null;
        }
        
        map.dragging.disable();
        map.touchZoom.disable();
        map.doubleClickZoom.disable();
        map.scrollWheelZoom.disable();
        map.boxZoom.disable();
        map.keyboard.disable();
        if (map.tap) map.tap.disable();
        
        disableCreateModeGuidance();
        
        map.setView([37.3891, -5.9845], 13);
    } else {
        map.dragging.enable();
        map.touchZoom.enable();
        map.doubleClickZoom.enable();
        map.scrollWheelZoom.enable();
        map.boxZoom.enable();
        map.keyboard.enable();
        if (map.tap) map.tap.enable();
        
        drawDistrictBoundaries();
        
        if (mode === 'create') {
            activeEditorView.classList.remove('hidden');
            editorDescription.textContent = 'Haz clic en cualquier parte del mapa para añadir un árbol nuevo.';
            
            selectedIndicator.textContent = "Creando Nuevo Árbol";
            selectedIndicator.style.color = '#10b981';
            btnDelete.classList.add('hidden');
            
            enableCreateModeGuidance();
            updateList([]);
        } else if (mode === 'edit') {
            disableCreateModeGuidance();
            activeEditorView.classList.remove('hidden');
            editModeControls.classList.remove('hidden');
            renderDistrictTags();
            editorDescription.textContent = 'Haz clic en un distrito para cargar sus árboles y editarlos.';
        }
    }
}

async function enableCreateModeGuidance() {
    if (globalTreesClusterGroup) {
        map.addLayer(globalTreesClusterGroup);
        return;
    }
    
    loader.classList.remove('hidden');
    loaderText.textContent = "Descargando árboles de referencia...";
    
    try {
        const response = await fetch(`../trees.json?v=${Date.now()}`);
        if (!response.ok) throw new Error("Network error");
        
        fullTreesCache = await response.json();
        
        globalTreesClusterGroup = L.markerClusterGroup({
            maxClusterRadius: 150,
            disableClusteringAtZoom: 17,
            chunkedLoading: true,
            chunkInterval: 50,
            iconCreateFunction: function (cluster) {
                const childCount = cluster.getChildCount();
                let c = ' marker-cluster-';
                let size = 26;
                if (childCount < 100) { c += 'small'; size = 30; } 
                else if (childCount < 1000) { c += 'medium'; size = 38; } 
                else { c += 'large'; size = 46; }
                return new L.DivIcon({ 
                    html: `<div><span>${childCount}</span></div>`, 
                    className: 'marker-cluster' + c, 
                    iconSize: new L.Point(size, size) 
                });
            }
        });
        
        fullTreesCache.forEach(tree => {
            if (!tree.lat || !tree.lon) return;
            const marker = L.circleMarker([tree.lat, tree.lon], {
                radius: 4,
                fillColor: tree.singular ? "#EAB308" : "rgba(34, 139, 34, 0.5)",
                stroke: tree.singular,
                color: "#FFFFFF",
                weight: 1,
                fillOpacity: 0.5,
                interactive: false
            });
            globalTreesClusterGroup.addLayer(marker);
        });
        
        map.addLayer(globalTreesClusterGroup);
    } catch(e) {
        console.error(e);
    } finally {
        loader.classList.add('hidden');
    }
}

function disableCreateModeGuidance() {
    if (globalTreesClusterGroup && map.hasLayer(globalTreesClusterGroup)) {
        map.removeLayer(globalTreesClusterGroup);
    }
}

// Update Map markers based on viewport bounds
function updateVisibleMarkers() {
    if ((editorMode !== 'edit' && editorMode !== 'create') || loadedDistrictTrees.length === 0) {
        if (canvasLayerGroup) {
            map.removeLayer(canvasLayerGroup);
            canvasLayerGroup = null;
        }
        updateList([]);
        return;
    }
    
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    
    if (canvasLayerGroup) {
        map.removeLayer(canvasLayerGroup);
    }
    canvasLayerGroup = L.layerGroup();
    
    if (zoom >= 14) {
        currentFilteredTrees = loadedDistrictTrees.filter(t => t.lat && t.lon && bounds.contains([t.lat, t.lon]));
        
        currentFilteredTrees.forEach(tree => {
            if (activeTreeIdx === tree.idx && activeDragMarker) return; // Skip drawing canvas circle if it's the active draggable marker
            
            const marker = L.circleMarker([tree.lat, tree.lon], {
                radius: 4,
                fillColor: tree.singular ? "#EAB308" : "#228B22",
                stroke: tree.singular ? true : false,
                color: "#FFFFFF",
                weight: 1,
                fillOpacity: 0.85
            });
            
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                if (editorMode === 'edit') {
                    selectTreeByIdx(tree.idx);
                }
            });
            
            canvasLayerGroup.addLayer(marker);
        });
        
        updateList(currentFilteredTrees);
    } else {
        currentFilteredTrees = [];
        const singularTreesInLoaded = loadedDistrictTrees.filter(t => t.singular === true);
        singularTreesInLoaded.forEach(tree => {
            if (activeTreeIdx === tree.idx && activeDragMarker) return;
            const marker = L.circleMarker([tree.lat, tree.lon], {
                radius: 5,
                fillColor: "#EAB308",
                stroke: true,
                color: "#FFFFFF",
                weight: 1,
                fillOpacity: 0.9
            });
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                if (editorMode === 'edit') {
                    selectTreeByIdx(tree.idx);
                }
            });
            canvasLayerGroup.addLayer(marker);
        });
        updateList([]);
    }
    
    canvasLayerGroup.addTo(map);
}

// Select a tree from viewport and show draggable marker
function selectTreeByIdx(idx) {
    const tree = loadedDistrictTrees.find(t => t.idx === idx);
    if (!tree) return;
    
    activeTreeIdx = idx;
    
    selectedIndicator.textContent = `Editando: ${tree.especie || 'Árbol sin especie'}`;
    selectedIndicator.style.color = '#22c55e';
    
    inputLat.value = tree.lat || '';
    inputLon.value = tree.lon || '';
    inputEspecie.value = tree.especie || '';
    inputDistrict.value = tree.distrito || '';
    inputSingular.checked = tree.singular === true;
    
    btnDelete.classList.remove('hidden');
    
    updateList(currentFilteredTrees); // Highlights list selection
    
    if (activeDragMarker) {
        map.removeLayer(activeDragMarker);
    }
    
    activeDragMarker = L.marker([tree.lat, tree.lon], {
        icon: getMarkerIcon(tree.singular === true, true),
        draggable: true,
        zIndexOffset: 1000
    }).addTo(map);
    
    activeDragMarker.on('dragend', async () => {
        const isOriginal = tree.idx !== undefined && tree.idx < 1000000000000;
        if (isOriginal) {
            if (!confirm("Este árbol constaba originalmente en la base de datos, ¿seguro que quieres realizar este cambio?")) {
                activeDragMarker.setLatLng([tree.lat, tree.lon]);
                return;
            }
        }
        
        const newLatLng = activeDragMarker.getLatLng();
        const lat = parseFloat(newLatLng.lat.toFixed(6));
        const lon = parseFloat(newLatLng.lng.toFixed(6)); // Corrected .lng
        
        const oldDistrict = tree.distrito;
        const newDistrict = findDistrictForCoords(lat, lon);
        
        tree.lat = lat;
        tree.lon = lon;
        tree.distrito = newDistrict;
        
        inputLat.value = lat;
        inputLon.value = lon;
        inputDistrict.value = newDistrict;
        
        if (oldDistrict !== newDistrict) {
            await moveTreeToNewDistrict(tree, oldDistrict, newDistrict);
        } else {
            if (oldDistrict) trackModifiedDistrict(oldDistrict);
        }
        
        updateVisibleMarkers();
    });
    
    updateVisibleMarkers(); // Hides canvas dot for this tree
}

// Move tree from one district to another by modifying in-memory caches
async function moveTreeToNewDistrict(tree, oldDistrict, newDistrict) {
    if (!oldDistrict || !newDistrict || oldDistrict === newDistrict) return;
    
    // Remove from old district
    if (loadedDistrictsData[oldDistrict]) {
        const idx = loadedDistrictsData[oldDistrict].findIndex(t => t.idx === tree.idx);
        if (idx >= 0) {
            loadedDistrictsData[oldDistrict].splice(idx, 1);
        }
    }
    
    // Check if new district is loaded
    if (!loadedDistrictsData[newDistrict]) {
        const distMeta = districtsMeta.find(d => d.name === newDistrict);
        if (distMeta) {
            try {
                loader.classList.remove('hidden');
                loaderText.textContent = `Cargando destino (${newDistrict})...`;
                const resp = await fetch(`data/${distMeta.filename}?v=${Date.now()}`);
                if (resp.ok) {
                    loadedDistrictsData[newDistrict] = await resp.json();
                } else {
                    loadedDistrictsData[newDistrict] = [];
                }
            } catch (e) {
                loadedDistrictsData[newDistrict] = [];
            } finally {
                loader.classList.add('hidden');
            }
        } else {
            loadedDistrictsData[newDistrict] = [];
        }
        renderDistrictTags();
        drawDistrictBoundaries();
    }
    
    // Add to new district
    loadedDistrictsData[newDistrict].push(tree);
    
    computeLoadedDistrictTrees();
    trackModifiedDistrict(oldDistrict);
    trackModifiedDistrict(newDistrict);
    
    // Do not clear form since we are still editing this active tree
}

// Place a marker on map click, resolving district
function selectNewPosition(lat, lon) {
    // Only allow creating a new marker by clicking in 'create' mode
    if (editorMode !== 'create') return;

    inputLat.value = lat;
    inputLon.value = lon;
    
    const resolvedDistrict = findDistrictForCoords(lat, lon);
    inputDistrict.value = resolvedDistrict;
    
    // Create new tree logic
    activeTreeIdx = null; 
    selectedIndicator.textContent = "Creando Nuevo Árbol";
    selectedIndicator.style.color = '#10b981';
    btnDelete.classList.add('hidden');
    inputEspecie.value = '';
    inputSingular.checked = false;
    
    if (activeDragMarker) {
        map.removeLayer(activeDragMarker);
    }
    
    activeDragMarker = L.marker([lat, lon], {
        icon: getMarkerIcon(false, true),
        draggable: true,
        zIndexOffset: 1000
    }).addTo(map);
    
    activeDragMarker.on('dragend', () => {
        const newLatLng = activeDragMarker.getLatLng();
        const newLat = parseFloat(newLatLng.lat.toFixed(6));
        const newLon = parseFloat(newLatLng.lng.toFixed(6));
        
        inputLat.value = newLat;
        inputLon.value = newLon;
        
        inputDistrict.value = findDistrictForCoords(newLat, newLon);
    });
    
    inputEspecie.focus();
}

function clearForm() {
    activeTreeIdx = null;
    selectedIndicator.textContent = editorMode === 'create' ? "Creando Nuevo Árbol (Haz clic en el mapa)" : "Selecciona un árbol en el mapa o haz clic para crear uno nuevo.";
    selectedIndicator.style.color = 'var(--text-main)';
    
    inputLat.value = '';
    inputLon.value = '';
    inputEspecie.value = '';
    inputDistrict.value = '';
    inputSingular.checked = false;
    
    btnDelete.classList.add('hidden');
    
    if (activeDragMarker) {
        map.removeLayer(activeDragMarker);
        activeDragMarker = null;
    }
    
    updateVisibleMarkers();
}

async function saveFormToMemory() {
    const lat = parseFloat(inputLat.value);
    const lon = parseFloat(inputLon.value);
    const especie = inputEspecie.value.trim();
    const isSingular = inputSingular.checked;
    
    if (isNaN(lat) || isNaN(lon)) {
        alert("Por favor, selecciona una posición en el mapa haciendo clic.");
        return false;
    }
    
    if (!especie) {
        alert("La Especie Científica es un campo obligatorio.");
        return false;
    }
    
    const distrito = inputDistrict.value.trim() || 'Desconocido';
    
    if (activeTreeIdx !== null) {
        // Edit existing
        const tree = loadedDistrictTrees.find(t => t.idx === activeTreeIdx);
        if (tree) {
            const isOriginal = tree.idx !== undefined && tree.idx < 1000000000000;
            const hasChanges = tree.especie !== especie || !!tree.singular !== isSingular;
            
            if (isOriginal && hasChanges) {
                if (!confirm("Este árbol constaba originalmente en la base de datos, ¿seguro que quieres realizar este cambio?")) {
                    inputEspecie.value = tree.especie || '';
                    inputSingular.checked = !!tree.singular;
                    return false;
                }
            }
            
            const oldDistrict = tree.distrito;
            
            tree.especie = especie;
            tree.lat = lat;
            tree.lon = lon;
            tree.distrito = distrito;
            tree.singular = isSingular;
            
            if (isSingular) tree.flower_color = "#EAB308";
            else if (tree.flower_color === "#EAB308") delete tree.flower_color;
            
            if (oldDistrict !== distrito) {
                await moveTreeToNewDistrict(tree, oldDistrict, distrito);
            } else {
                trackModifiedDistrict(oldDistrict);
            }
        }
    } else {
        // Add new
        const finalIdx = Date.now();
        // Construct the full object required by app.js so it appears immediately!
        const treeData = {
            idx: finalIdx,
            especie: especie,
            lat: lat,
            lon: lon,
            distrito: distrito,
            barrio: 'Sin asignar', // Provide defaults for new normal trees
            estado: 'Normal',
            altura: 5,
            singular: isSingular
        };
        
        if (isSingular) treeData.flower_color = "#EAB308";
        
        // Load target district if not loaded
        if (!loadedDistrictsData[distrito]) {
            const distMeta = districtsMeta.find(d => d.name === distrito);
            if (distMeta) {
                try {
                    loader.classList.remove('hidden');
                    loaderText.textContent = `Cargando distrito...`;
                    const resp = await fetch(`data/${distMeta.filename}?v=${Date.now()}`);
                    if (resp.ok) loadedDistrictsData[distrito] = await resp.json();
                    else loadedDistrictsData[distrito] = [];
                } catch (e) {
                    loadedDistrictsData[distrito] = [];
                } finally {
                    loader.classList.add('hidden');
                }
            } else {
                loadedDistrictsData[distrito] = [];
            }
            if (editorMode === 'edit') {
                renderDistrictTags();
                drawDistrictBoundaries();
            }
        }
        
        loadedDistrictsData[distrito].push(treeData);
        computeLoadedDistrictTrees();
        trackModifiedDistrict(distrito);
        
        if (editorMode === 'create') {
            clearForm();
        } else {
            activeTreeIdx = finalIdx;
        }
        showToast("Nuevo árbol añadido");
    }
    
    updateVisibleMarkers();
    return true;
}

function deleteSelectedTree() {
    if (activeTreeIdx === null) return;
    
    const tree = loadedDistrictTrees.find(t => t.idx === activeTreeIdx);
    if (!tree) return;
    
    const isOriginal = tree.idx !== undefined && tree.idx < 1000000000000;
    const msg = isOriginal 
        ? "Este árbol constaba originalmente en la base de datos, ¿seguro que quieres realizar este cambio?"
        : `¿Estás seguro de que deseas eliminar el árbol "${tree.especie || 'Desconocido'}" del distrito ${tree.distrito}?`;
        
    if (confirm(msg)) {
        const district = tree.distrito;
        
        if (loadedDistrictsData[district]) {
            const idx = loadedDistrictsData[district].findIndex(t => t.idx === activeTreeIdx);
            if (idx >= 0) loadedDistrictsData[district].splice(idx, 1);
        }
        
        trackModifiedDistrict(district);
        computeLoadedDistrictTrees();
        clearForm();
    }
}

async function saveAllChanges() {
    // Sync current inputs if editing
    if (inputEspecie.value.trim()) {
        const saved = await saveFormToMemory();
        if (!saved) return;
    }
    
    if (modifiedDistricts.size === 0) {
        alert("No se han realizado modificaciones para guardar.");
        return;
    }
    
    loader.classList.remove('hidden');
    loaderText.textContent = "Guardando cambios en la base de datos municipal...";
    
    try {
        let successCount = 0;
        
        for (const districtName of modifiedDistricts) {
            const distMeta = districtsMeta.find(d => d.name === districtName);
            if (!distMeta) continue;
            
            const districtTreesList = loadedDistrictsData[districtName] || [];
            
            const response = await fetch('/api/save-district', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: distMeta.filename,
                    trees: districtTreesList
                })
            });
            
            if (response.ok) successCount++;
            else throw new Error(`Error en distrito ${districtName}`);
        }
        
        showToast("Base de datos actualizada");
        modifiedDistricts.clear();
        
        // Update any visual indicators of unsaved changes if they exist
        renderDistrictTags();
        
    } catch (e) {
        alert("Error al guardar: " + e.message);
    } finally {
        loader.classList.add('hidden');
    }
}

// Sidebar list management
function updateList(trees) {
    singularTreesList.innerHTML = '';
    currentListIndex = 0;
    currentFilteredTrees = trees;
    countRegistered.textContent = trees.length.toLocaleString();
    
    if (editorMode === 'menu') return;
    
    const zoom = map.getZoom();
    if (zoom < 14) {
        singularTreesList.innerHTML = '<span class="no-tags-placeholder">Acerca el mapa para ver la lista de árboles. (Zoom mínimo: 14)</span>';
        return;
    }
    if (trees.length === 0) {
        singularTreesList.innerHTML = '<span class="no-tags-placeholder">Ningún árbol visible en esta área.</span>';
        return;
    }
    
    renderTreeListChunk();
}

function renderTreeListChunk() {
    const end = Math.min(currentListIndex + CHUNK_SIZE, currentFilteredTrees.length);
    for (let i = currentListIndex; i < end; i++) {
        const tree = currentFilteredTrees[i];
        const item = document.createElement('div');
        
        item.className = `tree-item ${tree.idx === activeTreeIdx ? 'active' : ''}`;
        if (tree.idx === activeTreeIdx) {
            item.style.borderColor = '#22c55e';
            item.style.background = 'rgba(34, 197, 94, 0.1)';
        }
        
        const title = document.createElement('div');
        title.className = 'tree-item-title';
        title.innerHTML = `${tree.singular ? '⭐ ' : '🌳 '}${tree.especie || 'Sin especie'}`;
        
        const subtitle = document.createElement('div');
        subtitle.className = 'tree-item-subtitle';
        subtitle.textContent = `${tree.distrito || 'Sin distrito'} (${tree.lat.toFixed(5)}, ${tree.lon.toFixed(5)})`;
        
        item.appendChild(title);
        item.appendChild(subtitle);
        
        item.addEventListener('click', () => {
            selectTreeByIdx(tree.idx);
            map.setView([tree.lat, tree.lon], 18);
        });
        
        singularTreesList.appendChild(item);
    }
    currentListIndex = end;
}

function setupEvents() {
    btnModeCreate.addEventListener('click', () => switchMode('create'));
    btnModeEdit.addEventListener('click', () => switchMode('edit'));
    btnTopBack.addEventListener('click', (e) => {
        if (editorMode !== 'menu') {
            e.preventDefault();
            switchMode('menu');
        }
    });

    const syncFields = () => {
        const isSingular = inputSingular.checked;
        if (activeDragMarker) {
            activeDragMarker.setIcon(getMarkerIcon(isSingular, true));
        }
        
        if (activeTreeIdx !== null) {
            const tree = loadedDistrictTrees.find(t => t.idx === activeTreeIdx);
            if (tree) {
                tree.especie = inputEspecie.value.trim();
                tree.singular = isSingular;
                
                if (tree.distrito) trackModifiedDistrict(tree.distrito);
                
                if (tree.singular) tree.flower_color = "#EAB308";
                else if (tree.flower_color === "#EAB308") delete tree.flower_color;
                
                updateList(currentFilteredTrees);
            }
        }
    };
    
    inputEspecie.addEventListener('input', syncFields);
    inputSingular.addEventListener('change', syncFields);

    btnDelete.addEventListener('click', deleteSelectedTree);
    btnClear.addEventListener('click', clearForm);
    btnSaveAll.addEventListener('click', saveAllChanges);

    singularTreesList.parentElement.addEventListener('scroll', function () {
        if (this.scrollTop + this.clientHeight >= this.scrollHeight - 50) {
            if (currentListIndex < currentFilteredTrees.length) {
                renderTreeListChunk();
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupEvents();
    loadInitialMetadata();
    switchMode('menu');
});
