import json
import csv
import os

DATA_DIR = '/Users/wili/Desktop/projects/tree_maps/seville-trees-app/data'
CSV_PATH = os.path.join(DATA_DIR, 'singular_trees.csv')
DISTRICTS_META = os.path.join(DATA_DIR, 'districts.json')

def migrate():
    # 1. Read singular trees
    singular_indices = set()
    singular_coords = set()
    
    with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f, delimiter=';')
        for row in reader:
            idx = row.get('IDX')
            if idx:
                singular_indices.add(int(idx))
            else:
                lat = row.get('Latitud')
                lon = row.get('Longitud')
                if lat and lon:
                    singular_coords.add(f"{float(lat):.6f},{float(lon):.6f}")
                    
    print(f"Loaded {len(singular_indices)} indices and {len(singular_coords)} coords from CSV.")

    # 2. Iterate all district files
    with open(DISTRICTS_META, 'r', encoding='utf-8') as f:
        districts = json.load(f)
        
    all_merged = []
        
    for dist in districts:
        filename = dist['filename']
        filepath = os.path.join(DATA_DIR, filename)
        if not os.path.exists(filepath):
            continue
            
        with open(filepath, 'r', encoding='utf-8') as f:
            trees = json.load(f)
            
        modified = False
        for t in trees:
            is_singular = False
            t_idx = t.get('idx')
            if t_idx is not None and t_idx in singular_indices:
                is_singular = True
            elif t.get('lat') and t.get('lon'):
                coord_str = f"{float(t['lat']):.6f},{float(t['lon']):.6f}"
                if coord_str in singular_coords:
                    is_singular = True
                    
            if is_singular:
                t['singular'] = True
                modified = True
                
        if modified:
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(trees, f, ensure_ascii=False)
            print(f"Updated {filename} with singular flags.")
            
        all_merged.extend(trees)
        
    # 3. Update master trees.json
    master_path = '/Users/wili/Desktop/projects/tree_maps/trees.json'
    with open(master_path, 'w', encoding='utf-8') as f:
        json.dump(all_merged, f, ensure_ascii=False)
    print("Master trees.json updated.")

if __name__ == '__main__':
    migrate()
