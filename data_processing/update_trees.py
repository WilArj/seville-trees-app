import os
import json
import csv

TREES_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'trees.json')
PLANTS_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'plantas_amenazadas.csv')

FLOWER_COLORS = {
    'Jacaranda mimosifolia': '#8A2BE2', # Purple
    'Cercis siliquastrum': '#FF69B4', # Pink
    'Citrus aurantium': '#FFFFFF', # White
    'Prunus cerasifera': '#FFC0CB', # Light Pink
    'Magnolia grandiflora': '#FFFFFF', # White
    'Tipuana tipu': '#FFD700', # Yellow
    'Melia azedarach': '#DDA0DD', # Light Purple/Lilac
    'Hibiscus syriacus': '#FF69B4', # Pink
    'Brachychiton populneus': '#FFF8DC', # Cream
    'Brachychiton acerifolius': '#FF0000', # Red
    'Delonix regia': '#FF0000', # Red
    'Robinia pseudoacacia': '#FFFFFF', # White
    'Albizia julibrissin': '#FF69B4', # Pink
    'Bauhinia variegata': '#DA70D6', # Orchid
    'Grevillea robusta': '#FFA500', # Orange
    'Lagunaria patersonia': '#FFB6C1', # Light Pink
    'Plumeria rubra': '#FF69B4', # Pink
    'Acacia dealbata': '#FFD700', # Yellow
    'Acacia cyanophylla': '#FFD700', # Yellow
    'Citrus sp': '#FFFFFF', # White
    'Citrus limon': '#FFFFFF', # White
    'Citrus reticulata': '#FFFFFF', # White
    'Koelreuteria paniculata': '#FFD700', # Yellow
    'Sophora japonica': '#FFF8DC', # Cream
    'Hibiscus rosa-sinensis': '#FF0000', # Red
    'Punica granatum': '#FF4500', # OrangeRed
    'Nerium oleander': '#FF69B4', # Pink
    'Lagerstroemia indica': '#FF1493', # DeepPink
}

def load_species_status():
    status_dict = {}
    with open(PLANTS_CSV, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        next(reader) # skip headers
        for row in reader:
            if len(row) >= 3:
                name = row[1].strip()
                cat = row[2].strip()
                if cat and cat != '-' and cat != 'Categoría':
                    status_dict[name.lower()] = cat
    return status_dict

if __name__ == '__main__':
    status_dict = load_species_status()
    
    with open(TREES_JSON, 'r', encoding='utf-8') as f:
        trees = json.load(f)
        
    for tree in trees:
        especie = tree.get('especie', '')
        
        # Clear old status just in case
        for k in ['amenazado', 'categoria_amenaza', 'protegido', 'categoria_proteccion', 'flower_color']:
            if k in tree:
                del tree[k]
            
        # 1. Threatened & Protected status
        especie_lower = especie.strip().lower()
        if especie_lower in status_dict:
            cat = status_dict[especie_lower]
            if cat in ['En peligro de extinción', 'Vulnerable']:
                tree['amenazado'] = True
                tree['categoria_amenaza'] = cat
                tree['protegido'] = True
                tree['categoria_proteccion'] = cat
            elif cat == 'LAESRPE':
                tree['protegido'] = True
                tree['categoria_proteccion'] = cat
            
        # 2. Flower color
        if especie in FLOWER_COLORS:
            tree['flower_color'] = FLOWER_COLORS[especie]
            
    with open(TREES_JSON, 'w', encoding='utf-8') as f:
        json.dump(trees, f, ensure_ascii=False)
        
    print("Trees updated with threatened/protected status and flower colors.")