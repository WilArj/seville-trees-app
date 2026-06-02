import os
import csv
import requests
import concurrent.futures

INPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'especies amenazadas andalucia/Todas las especies.csv')
PLANTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'plantas_amenazadas.csv')
ANIMALS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'animales_amenazados.csv')

def get_kingdom(row):
    name = row[1].strip()
    try:
        url = f"https://api.gbif.org/v1/species/match?name={name}"
        # using verify=False just in case the same SSL error occurs with requests
        response = requests.get(url, verify=False, timeout=5)
        if response.status_code == 200:
            data = response.json()
            kingdom = data.get('kingdom', 'Unknown')
            return row, kingdom
    except Exception as e:
        pass
    
    # Simple heuristic fallback
    if 'sp' in name or 'subsp' in name or ' var ' in name:
        return row, 'Plantae' # usually botanical taxonomy in this list uses subsp
    return row, 'Unknown'

if __name__ == '__main__':
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        headers = next(reader)
        rows = list(reader)
        
    plants = []
    animals = []
    unknowns = []

    print(f"Total rows to process: {len(rows)}")
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        results = executor.map(get_kingdom, rows)
        
        for i, (row, kingdom) in enumerate(results):
            if kingdom == 'Plantae':
                plants.append(row)
            elif kingdom == 'Animalia':
                animals.append(row)
            else:
                # If unknown, let's put it in animals just so it doesn't pollute plants list unless it's a plant.
                # Actually, fungi might appear, but let's just group them in animals/others
                unknowns.append(row)
                
    print(f"Plants: {len(plants)}, Animals: {len(animals)}, Unknown/Others: {len(unknowns)}")
    
    # Save plants
    with open(PLANTS_FILE, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(plants)
        
    # Save animals (and unknowns)
    with open(ANIMALS_FILE, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(animals + unknowns)
        
    print("Files created successfully.")