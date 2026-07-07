# Inventario de Árboles - Sevilla

Una aplicación web interactiva y de altísimo rendimiento para explorar el inventario arbóreo completo de la ciudad de Sevilla.

👉 **[Ver el Mapa en Vivo](https://wilarj.github.io/seville-trees-app/)**

## Características Principales
- **Rendimiento extremo:** Visualiza más de 197.000 árboles simultáneamente gracias al renderizado en Canvas con Leaflet.js, sin necesidad de agruparlos (*clustering*), permitiendo ver el tapiz verde real de la ciudad.
- **Limpieza de datos:** El conjunto de datos original de más de 220.000 árboles ha sido depurado eliminando cerca de 23.000 registros duplicados (árboles registrados a menos de 11 centímetros de distancia).
- **Filtro de Especies Amenazadas:** Integración con la API biológica internacional (GBIF) para cruzar el inventario con el **Catálogo de Especies Amenazadas de Andalucía**. Muestra categorías de amenaza como *Vulnerable* o *En peligro de extinción*.
- **Identidad Botánica:** Los árboles con floración llamativa (como las Jacarandas o los Naranjos) se pueden destacar en el mapa con su color y forma característica en lugar del genérico punto verde.
- **Navegación Intuitiva:** Buscador predictivo, filtros por distrito, estado de vitalidad, y un panel de scroll infinito sincronizado con el mapa (hacer *hover* en la lista ilumina el árbol exacto en el mapa atenuando el resto de la ciudad).

## Estructura del Proyecto
Tras la última refactorización para optimizar la web:
- **La aplicación web (HTML, CSS, JS)** reside en la raíz del repositorio, haciendo que la URL de GitHub Pages sea limpia y directa.
- **Los datos compilados (`trees.json`, `data/`)** también se encuentran listos para consumo en la raíz.
- **`data_processing/`**: Contiene todos los *scripts* de Python y los datos en crudo (PDFs oficiales del Ayuntamiento, CSVs sin procesar) utilizados en la fase de ingeniería de datos para generar el inventario final.

## Fuentes de Datos
1. **Ayuntamiento de Sevilla (Parques y Jardines):** Inventarios oficiales de arbolado viario, colegios, zonas verdes, árboles sin recepcionar y árboles singulares. (Formatos originales en PDF).
2. **Junta de Andalucía:** Listado Andaluz de Especies Silvestres en Régimen de Protección Especial (LAESRPE).
3. **GBIF (Global Biodiversity Information Facility):** Base de datos taxonómica utilizada por los scripts para clasificar e identificar nombres científicos y familias botánicas.
