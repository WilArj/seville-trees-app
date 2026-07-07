// Elements
const speciesSearch = document.getElementById('species-search');
const autocompleteList = document.getElementById('autocomplete-list');
const tagsContainer = document.getElementById('selected-species-tags');
const districtFilter = document.getElementById('district-filter');
const livingOnlyFilter = document.getElementById('living-only-filter');
const threatenedFilter = document.getElementById('threatened-filter');
const statTotal = document.getElementById('stat-total');
const loader = document.getElementById('loader');
const visibleTreesList = document.getElementById('visible-trees-list');

let allTrees = [];
let speciesList = [];
let districts = new Set();
let map;
let markerLayerGroup;
// Now an array of objects: { name: string, showFlower: boolean }
let selectedSpecies = [];
let currentSearchTerm = '';

// Globals for list virtualization and hover
let currentFilteredTrees = [];
let currentMarkers = [];
let currentListIndex = 0;
const CHUNK_SIZE = 100;

// Flower SVG Template
const flowerSvg = (color) => `<svg viewBox="0 0 24 24" fill="${color}" stroke="rgba(0,0,0,0.5)" stroke-width="0.5" style="width:100%; height:100%;"><path d="M12 2.5C11 1.5 9 1 7.5 2.5C6 4 6.5 6 7.5 7C5.5 6.5 3.5 7 3 9C2.5 11 4.5 12.5 6 13C4.5 13.5 2.5 15 3 17C3.5 19 5.5 19.5 7.5 19C6.5 20 6 22 7.5 23.5C9 25 11 24.5 12 23.5C13 24.5 15 25 16.5 23.5C18 22 17.5 20 16.5 19C18.5 19.5 20.5 19 21 17C21.5 15 19.5 13.5 18 13C19.5 12.5 21.5 11 21 9C20.5 7 18.5 6.5 16.5 7C17.5 6 18 4 16.5 2.5C15 1 13 1.5 12 2.5Z"/></svg>`;

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

    // Initializing with MarkerCluster instead of regular layer group
    markerLayerGroup = L.markerClusterGroup({
        disableClusteringAtZoom: 17, // Detener clustering en zoom muy cercano
        chunkedLoading: true,        // Evita congelar el navegador al procesar miles de puntos
        chunkInterval: 50,           // Procesar en intervalos de 50ms
        maxClusterRadius: 80,        // Radio en píxeles para agrupar marcadores
        zoomToBoundsOnClick: false,
        spiderfyOnMaxZoom: false
    }).addTo(map);
    
    map.on('zoomend', function() {
        // No need to fully re-render, leaflet-markercluster manages markers zoom automatically
    });
}

// Load Data
async function loadData() {
    loader.classList.remove('hidden');
    try {
        const response = await fetch('trees.json?v=' + new Date().getTime());
        if (!response.ok) throw new Error("Failed to load data.");
        allTrees = await response.json();
        
        const speciesSet = new Set();
        
        allTrees.forEach(tree => {
            if (tree.distrito && tree.distrito.trim() !== '') districts.add(tree.distrito.trim());
            if (tree.especie && tree.especie.trim() !== '') speciesSet.add(tree.especie.trim());
        });
        
        speciesList = Array.from(speciesSet).sort();
        
        const sortedDistricts = Array.from(districts).sort();
        sortedDistricts.forEach(d => {
            const option = document.createElement('option');
            option.value = d;
            option.textContent = d;
            districtFilter.appendChild(option);
        });

        renderTrees();
    } catch (error) {
        console.error(error);
        alert("Error loading data: " + error.message);
    } finally {
        loader.classList.add('hidden');
    }
}

function isLiving(tree) {
    const estado = (tree.estado || '').toLowerCase();
    if (estado.includes('tocón') || estado.includes('vacío') || estado.includes('eliminada') || estado.includes('muerto') || estado.includes('no plantar')) return false;
    return true;
}

// Render Trees on Map
function renderTrees() {
    // Show loader during rendering since adding 197k elements (even clustered) takes 1-2 seconds
    loader.classList.remove('hidden');
    
    // We run it inside a setTimeout to let the DOM loader display first
    setTimeout(() => {
        markerLayerGroup.clearLayers();
        currentMarkers = [];
        
        const selectedDistrict = districtFilter.value;
        const livingOnly = livingOnlyFilter.checked;
        const threatenedOnly = threatenedFilter.checked;
        
        const filteredTrees = allTrees.filter(tree => {
            if (selectedDistrict !== 'all' && tree.distrito !== selectedDistrict) return false;
            if (livingOnly && !isLiving(tree)) return false;
            if (threatenedOnly && !tree.amenazado) return false;
            if (selectedSpecies.length > 0 && !selectedSpecies.some(s => s.name === tree.especie)) return false;
            return true;
        });
        
        currentFilteredTrees = filteredTrees;
        
        const currentZoom = map.getZoom();
        let r = 2.5;
        if (currentZoom >= 16) r = 4;
        else if (currentZoom >= 14) r = 2;
        
        const markersToAdd = [];
        
        filteredTrees.forEach((tree, idx) => {
            if (!tree.lat || !tree.lon) {
                currentMarkers.push(null);
                return;
            }
            
            const popupContent = `
                <div class="tree-popup">
                    <h3>${tree.especie || 'Desconocida'} ${tree.amenazado ? '⚠️' : ''}</h3>
                    <p><strong>Distrito:</strong> ${tree.distrito || '-'}</p>
                    <p><strong>Barrio:</strong> ${tree.barrio || '-'}</p>
                    <p><strong>Altura:</strong> ${tree.altura ? tree.altura + 'm' : '-'}</p>
                    <p><strong>Estado:</strong> ${tree.estado || 'Normal'}</p>
                    ${tree.categoria_amenaza ? `<p style="color: #ef4444;"><strong>Amenaza:</strong> ${tree.categoria_amenaza}</p>` : ''}
                </div>
            `;
            
            let showFlowers = false;
            if (selectedSpecies.length > 0) {
                const match = selectedSpecies.find(s => s.name === tree.especie);
                if (match && match.showFlower) {
                    showFlowers = true;
                }
            }
            
            let marker;
            if (showFlowers && tree.flower_color) {
                // If zoom is too out, use circle markers even in cluster to improve performance
                if (currentZoom < 15) {
                    marker = L.circleMarker([tree.lat, tree.lon], {
                        radius: r,
                        fillColor: tree.flower_color,
                        color: "#ffffff",
                        weight: 0.5,
                        opacity: 1,
                        fillOpacity: 0.9
                    });
                } else {
                    let size = currentZoom >= 17 ? 20 : (currentZoom >= 15 ? 12 : 8);
                    const icon = L.divIcon({
                        className: 'flower-icon',
                        html: flowerSvg(tree.flower_color),
                        iconSize: [size, size],
                        iconAnchor: [size/2, size/2]
                    });
                    marker = L.marker([tree.lat, tree.lon], { icon: icon });
                }
            } else {
                // Normal green tree marker
                marker = L.circleMarker([tree.lat, tree.lon], {
                    radius: r,
                    fillColor: "#228B22",
                    color: "#006400",
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                });
            }
            
            marker.bindPopup(popupContent);
            marker._originalOptions = marker.options;
            if (marker.options.icon) marker._originalIconOpacity = '1';
            
            // Collect in array for batch injection
            markersToAdd.push(marker);
            currentMarkers.push(marker);
        });
        
        // Add all markers in a single batch call (MUCH FASTER than single additions)
        markerLayerGroup.addLayers(markersToAdd);
        
        statTotal.textContent = filteredTrees.length.toLocaleString();
        
        // Reset and render list
        visibleTreesList.innerHTML = '';
        currentListIndex = 0;
        renderTreeListChunk();
        
        loader.classList.add('hidden');
    }, 50);
}

function renderTreeListChunk() {
    const end = Math.min(currentListIndex + CHUNK_SIZE, currentFilteredTrees.length);
    for (let i = currentListIndex; i < end; i++) {
        const tree = currentFilteredTrees[i];
        const marker = currentMarkers[i];
        
        const item = document.createElement('div');
        item.className = 'tree-item';
        
        const title = document.createElement('div');
        title.className = 'tree-item-title';
        title.innerHTML = `${tree.especie || 'Desconocida'} ${tree.amenazado ? '⚠️' : ''}`;
        
        const subtitle = document.createElement('div');
        subtitle.className = 'tree-item-subtitle';
        subtitle.textContent = `${tree.barrio || '-'}, ${tree.distrito || '-'}`;
        
        item.appendChild(title);
        item.appendChild(subtitle);
        
        // Hover Events
        item.addEventListener('mouseenter', () => {
            if (!marker) return;
            
            // Highlight hovered node (using leaflet-markercluster's zoom/pan if it's currently clustered)
            // Or if it's visible, temporarily make it stand out.
            // Let's dim others only if they are not in a cluster.
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
            // Restore all
            currentMarkers.forEach(m => {
                if (!m) return;
                if (m.setStyle) m.setStyle(m._originalOptions);
                if (m._icon) {
                    m._icon.style.opacity = m._originalIconOpacity || '1';
                    m._icon.style.transform = m._icon.style.transform.replace(' scale(1.5)', '');
                }
            });
        });
        
        // Click to pan map and zoom to the marker (automatic cluster unfolding)
        item.addEventListener('click', () => {
            if (tree.lat && tree.lon && marker) {
                // markerClusterGroup has a built-in helper zoomToShowLayer
                markerLayerGroup.zoomToShowLayer(marker, () => {
                    map.setView([tree.lat, tree.lon], 18);
                    marker.openPopup();
                });
            }
        });
        
        visibleTreesList.appendChild(item);
    }
    
    currentListIndex = end;
}

function hasFlowerColor(speciesName) {
    return allTrees.some(t => t.especie === speciesName && t.flower_color);
}

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

function setupEvents() {
    districtFilter.addEventListener('change', renderTrees);
    livingOnlyFilter.addEventListener('change', renderTrees);
    
    threatenedFilter.addEventListener('change', function() {
        if (this.checked) {
            const threatenedNames = [...new Set(allTrees.filter(t => t.amenazado).map(t => t.especie))];
            threatenedNames.forEach(name => {
                if (!selectedSpecies.some(s => s.name === name)) {
                    selectedSpecies.push({ name: name, showFlower: false });
                }
            });
        } else {
            const threatenedNames = [...new Set(allTrees.filter(t => t.amenazado).map(t => t.especie))];
            selectedSpecies = selectedSpecies.filter(s => !threatenedNames.includes(s.name));
        }
        renderTags();
        renderTrees();
    });
    
    speciesSearch.addEventListener('input', function(e) {
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
            
            div.addEventListener('click', function() {
                speciesSearch.value = '';
                autocompleteList.classList.add('hidden');
                selectedSpecies.push({ name: suggestion, showFlower: false });
                renderTags();
                renderTrees();
            });
            autocompleteList.appendChild(div);
        });
    });
    
    document.addEventListener('click', function(e) {
        if (e.target !== speciesSearch && e.target !== autocompleteList) {
            autocompleteList.classList.add('hidden');
        }
    });
    
    visibleTreesList.addEventListener('scroll', function() {
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
    loadData();
});
