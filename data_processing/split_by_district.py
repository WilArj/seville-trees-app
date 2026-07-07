import os
import json
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TREES_JSON = os.path.join(BASE_DIR, 'trees.json')
DATA_DIR = os.path.join(BASE_DIR, 'seville-trees-app', 'data')

# Crear el directorio de datos si no existe
os.makedirs(DATA_DIR, exist_ok=True)

def sanitize_filename(name):
    # Reemplazar caracteres no permitidos por guiones
    s = name.strip().lower()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s]+', '-', s)
    return s

def split_data():
    if not os.path.exists(TREES_JSON):
        print(f"File not found: {TREES_JSON}")
        return

    print("Reading trees.json...")
    with open(TREES_JSON, 'r', encoding='utf-8') as f:
        trees = json.load(f)

    print(f"Total trees read: {len(trees)}")

    # Agrupar árboles por distrito
    by_district = {}
    all_species = set()
    district_metadata = []

    for tree in trees:
        distrito = tree.get('distrito', 'Desconocido').strip()
        if not distrito:
            distrito = 'Desconocido'
            
        especie = tree.get('especie', '').strip()
        if especie:
            all_species.add(especie)

        if distrito not in by_district:
            by_district[distrito] = []
        by_district[distrito].append(tree)

    print("Writing district-specific JSON files...")
    for distrito, district_trees in by_district.items():
        filename = sanitize_filename(distrito) + '.json'
        filepath = os.path.join(DATA_DIR, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(district_trees, f, ensure_ascii=False)
        
        # Calcular tamaño del archivo en MB para reporte
        size_mb = os.path.getsize(filepath) / (1024 * 1024)
        print(f"  {distrito}: {len(district_trees)} árboles -> {filename} ({size_mb:.2f} MB)")

        district_metadata.append({
            'name': distrito,
            'filename': filename,
            'count': len(district_trees)
        })

    # Guardar metadatos generales
    print("Writing metadata index files...")
    
    # 1. Lista de distritos ordenados con recuento
    district_metadata.sort(key=lambda x: x['name'])
    with open(os.path.join(DATA_DIR, 'districts.json'), 'w', encoding='utf-8') as f:
        json.dump(district_metadata, f, ensure_ascii=False)

    # 2. Lista ordenada de especies únicas para el autocompletado
    species_list = sorted(list(all_species))
    with open(os.path.join(DATA_DIR, 'species.json'), 'w', encoding='utf-8') as f:
        json.dump(species_list, f, ensure_ascii=False)

    print("Success! Data split into district chunks.")

if __name__ == '__main__':
    split_data()
