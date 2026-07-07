import pdfplumber
import json
import pyproj
import os
import multiprocessing as mp
import time

PDF_FILES = [
    'arboles-colegios.pdf',
    'arboles-colegios (1).pdf',
    'arboles-sin-recepcionar.pdf',
    'arboles-viario.pdf',
    'arboles-zonas-verdes.pdf'
]

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def process_page(args):
    pdf_path, page_num = args
    trees = []
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            page = pdf.pages[page_num]
            table = page.extract_table()
            
            if not table or len(table) < 2:
                return trees
                
            # The first row might be headers or empty, let's assume if it has 'ESPECIE' it's header
            start_idx = 0
            if 'ESPECIE' in str(table[0]):
                start_idx = 1
                
            for row in table[start_idx:]:
                # Check if it has enough columns (we need at least X and Y)
                if len(row) < 11:
                    continue
                
                # 'ESPECIE ARBOLES\nVIARIO', 'ALTURA TOTAL', 'TIPOLOGÍA', 'UG', 'BARRIO', 'DISTRITO', 'ELEMENTO', 'FECHAPLANT', 'MARRAS', 'X', 'Y'
                especie = row[0].replace('\n', ' ').strip() if row[0] else ''
                altura = row[1].strip() if row[1] else ''
                tipologia = row[2].strip() if row[2] else ''
                barrio = row[4].strip() if row[4] else ''
                distrito = row[5].strip() if row[5] else ''
                marras = row[8].replace('\n', ' ').strip() if row[8] else ''
                
                x_str = row[9].strip() if row[9] else ''
                y_str = row[10].strip() if row[10] else ''
                
                # If especie contains header stuff, skip
                if 'ESPECIE' in especie:
                    continue
                    
                if not x_str or not y_str:
                    continue
                    
                try:
                    x = float(x_str)
                    y = float(y_str)
                    
                    trees.append({
                        'especie': especie,
                        'altura': altura,
                        'tipologia': tipologia,
                        'barrio': barrio,
                        'distrito': distrito,
                        'estado': marras,
                        'x': x,
                        'y': y
                    })
                except ValueError:
                    continue
    except Exception as e:
        print(f"Error on {os.path.basename(pdf_path)} page {page_num}: {e}")
        pass
        
    return trees

def process_pdf(pdf_filename):
    pdf_path = os.path.join(BASE_DIR, pdf_filename)
    if not os.path.exists(pdf_path):
        print(f"File not found: {pdf_path}")
        return []
        
    print(f"Processing {pdf_filename}...")
    with pdfplumber.open(pdf_path) as pdf:
        num_pages = len(pdf.pages)
        
    args = [(pdf_path, i) for i in range(num_pages)]
    
    # Process in parallel
    pool = mp.Pool(mp.cpu_count())
    results = pool.map(process_page, args)
    pool.close()
    pool.join()
    
    # Flatten list of lists
    all_trees = [item for sublist in results for item in sublist]
    print(f"Found {len(all_trees)} trees in {pdf_filename}")
    return all_trees

if __name__ == '__main__':
    start_time = time.time()
    all_trees = []
    
    for pdf_file in PDF_FILES:
        trees = process_pdf(pdf_file)
        all_trees.extend(trees)
        
    print(f"Total trees extracted: {len(all_trees)}")
    print("Converting coordinates...")
    
    # Convert EPSG:25830 to EPSG:4326
    utm = pyproj.CRS('EPSG:25830')
    wgs84 = pyproj.CRS('EPSG:4326')
    transformer = pyproj.Transformer.from_crs(utm, wgs84, always_xy=True) # Output lon, lat
    
    valid_trees = []
    
    for tree in all_trees:
        lon, lat = transformer.transform(tree['x'], tree['y'])
        
        # Check if coordinates make sense for Seville (lat ~37, lon ~-5)
        if 36.5 < lat < 38.5 and -6.5 < lon < -5.0:
            # We don't need X and Y anymore, just lat and lon
            del tree['x']
            del tree['y']
            tree['lat'] = round(lat, 6)
            tree['lon'] = round(lon, 6)
            
            # Clean up empty values to save space
            tree_clean = {k: v for k, v in tree.items() if v}
            valid_trees.append(tree_clean)
            
    print(f"Total valid trees after coordinate conversion: {len(valid_trees)}")
    
    output_path = os.path.join(BASE_DIR, 'trees.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(valid_trees, f, ensure_ascii=False)
        
    print(f"Saved to {output_path} in {time.time() - start_time:.2f} seconds.")
