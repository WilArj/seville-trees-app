import pdfplumber
import pyproj
import os
import csv
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

utm = pyproj.CRS('EPSG:25830')
wgs84 = pyproj.CRS('EPSG:4326')
transformer = pyproj.Transformer.from_crs(utm, wgs84, always_xy=True)

def process_page(args):
    pdf_path, page_num = args
    rejected = []
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            page = pdf.pages[page_num]
            table = page.extract_table()
            
            if not table or len(table) < 2:
                return rejected
                
            start_idx = 0
            if 'ESPECIE' in str(table[0]):
                start_idx = 1
                
            for row in table[start_idx:]:
                if len(row) < 11:
                    rejected.append({
                        'archivo': os.path.basename(pdf_path),
                        'motivo': 'Columnas incompletas',
                        'datos_crudos': ' | '.join([str(c).replace('\n', ' ') for c in row if c])
                    })
                    continue
                
                especie = row[0].replace('\n', ' ').strip() if row[0] else ''
                altura = row[1].strip() if row[1] else ''
                tipologia = row[2].strip() if row[2] else ''
                barrio = row[4].strip() if row[4] else ''
                distrito = row[5].strip() if row[5] else ''
                marras = row[8].replace('\n', ' ').strip() if row[8] else ''
                x_str = row[9].strip() if row[9] else ''
                y_str = row[10].strip() if row[10] else ''
                
                if 'ESPECIE' in especie:
                    continue
                    
                datos_crudos = f"{especie} | {altura} | {tipologia} | {barrio} | {distrito} | {marras} | X:{x_str} | Y:{y_str}"
                
                if not x_str or not y_str:
                    rejected.append({
                        'archivo': os.path.basename(pdf_path),
                        'motivo': 'Coordenadas faltantes',
                        'datos_crudos': datos_crudos
                    })
                    continue
                    
                try:
                    x = float(x_str)
                    y = float(y_str)
                    lon, lat = transformer.transform(x, y)
                    
                    if not (36.5 < lat < 38.5 and -6.5 < lon < -5.0):
                        rejected.append({
                            'archivo': os.path.basename(pdf_path),
                            'motivo': f'Coordenadas fuera de Sevilla (Lat: {lat:.4f}, Lon: {lon:.4f})',
                            'datos_crudos': datos_crudos
                        })
                except ValueError:
                    rejected.append({
                        'archivo': os.path.basename(pdf_path),
                        'motivo': 'Coordenadas no numéricas',
                        'datos_crudos': datos_crudos
                    })
                    continue
                    
    except Exception as e:
        pass
        
    return rejected

def process_pdf(pdf_filename):
    pdf_path = os.path.join(BASE_DIR, pdf_filename)
    if not os.path.exists(pdf_path):
        return []
        
    with pdfplumber.open(pdf_path) as pdf:
        num_pages = len(pdf.pages)
        
    args = [(pdf_path, i) for i in range(num_pages)]
    pool = mp.Pool(mp.cpu_count())
    results = pool.map(process_page, args)
    pool.close()
    pool.join()
    
    return [item for sublist in results for item in sublist]

if __name__ == '__main__':
    all_rejected = []
    
    for pdf_file in PDF_FILES:
        print(f"Buscando en {pdf_file}...")
        rejected = process_pdf(pdf_file)
        all_rejected.extend(rejected)
        
    output_path = os.path.join(BASE_DIR, 'arboles_borrados.csv')
    with open(output_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['archivo', 'motivo', 'datos_crudos'])
        writer.writeheader()
        writer.writerows(all_rejected)
        
    print(f"Completado. Guardado en {output_path}")
