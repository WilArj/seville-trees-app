import json
import csv
import os

RESOLVED_SUMMARY_PATH = '/Users/wili/.gemini/antigravity/brain/c9d9ac3c-4648-4d08-95f3-92370f72ee1e/scratch/resolved_summary.json'
CSV_OUTPUT_PATH = '/Users/wili/Desktop/projects/tree_maps/seville-trees-app/data/singular_trees.csv'

def restore_csv():
    with open(RESOLVED_SUMMARY_PATH, 'r', encoding='utf-8') as f:
        summary = json.load(f)
        
    all_rows = []
    
    for t in summary['unique']:
        c = t['candidates'][0]
        all_rows.append({
            'num': t['num'],
            'code': t['code'],
            'name': t['name'].replace('ejemplar ', '').strip(),
            'especie': t['especie'],
            'lat': c['tree'].get('lat'),
            'lon': c['tree'].get('lon'),
            'idx': c['idx']
        })
        
    for gm in summary['group']:
        t = gm['tree']
        for c in t['candidates']:
            all_rows.append({
                'num': t['num'],
                'code': t['code'],
                'name': t['name'].replace('ejemplar ', '').strip(),
                'especie': t['especie'],
                'lat': c['tree'].get('lat'),
                'lon': c['tree'].get('lon'),
                'idx': c['idx']
            })
            
    for t in summary['ambiguous']:
        # Taking the first best candidate for now as the restored data
        if t['candidates']:
            c = t['candidates'][0]
            all_rows.append({
                'num': t['num'],
                'code': t['code'],
                'name': t['name'].replace('ejemplar ', '').strip(),
                'especie': t['especie'],
                'lat': c['tree'].get('lat'),
                'lon': c['tree'].get('lon'),
                'idx': c['idx']
            })
            
    for t in summary['none']:
        all_rows.append({
            'num': t['num'],
            'code': t['code'],
            'name': t['name'].replace('ejemplar ', '').strip(),
            'especie': t['especie'],
            'lat': '',
            'lon': '',
            'idx': ''
        })
        
    # Append the user's manually added trees from the current CSV before overwriting
    user_trees = []
    if os.path.exists(CSV_OUTPUT_PATH):
        with open(CSV_OUTPUT_PATH, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f, delimiter=';')
            for row in reader:
                if row.get('IDX') == '1780397503008': # The test tree
                    user_trees.append({
                        'num': row.get('Nº Ejemplar (Guía)', ''),
                        'code': row.get('Código', ''),
                        'name': row.get('Nombre Singular (Guía)', ''),
                        'especie': row.get('Especie Científica', ''),
                        'lat': row.get('Latitud', ''),
                        'lon': row.get('Longitud', ''),
                        'idx': row.get('IDX', '')
                    })
                    
    all_rows.extend(user_trees)
        
    # Sort
    all_rows.sort(key=lambda x: str(x['num']))
    
    es_headers = [
        'Nº Ejemplar (Guía)', 'Código', 'Nombre Singular (Guía)', 'Especie Científica',
        'Latitud', 'Longitud', 'IDX'
    ]
    
    with open(CSV_OUTPUT_PATH, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f, delimiter=';')
        writer.writerow(es_headers)
        for r in all_rows:
            writer.writerow([
                r.get('num', ''), r.get('code', ''), r.get('name', ''), r.get('especie', ''),
                r.get('lat', ''), r.get('lon', ''), r.get('idx', '')
            ])
            
    print(f"Restored {len(all_rows)} singular trees to {CSV_OUTPUT_PATH}")

if __name__ == '__main__':
    restore_csv()
