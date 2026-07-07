import json
import os

json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'trees.json')

with open(json_path, 'r', encoding='utf-8') as f:
    trees = json.load(f)

for tree in trees:
    # Clean district
    if 'distrito' in tree:
        d = tree['distrito'].replace('\n', '')
        if d == 'Este-Alcosa-Torreblanca' or 'Este' in d and 'Alcosa' in d:
            tree['distrito'] = 'Este-Alcosa-Torreblanca'
        elif 'Bellavista' in d:
            tree['distrito'] = 'Bellavista-La Palmera'
        elif 'Pablo' in d and 'Justa' in d:
            tree['distrito'] = 'San Pablo-Santa Justa'
        else:
            tree['distrito'] = d
            
    # Clean estado (marras)
    if 'estado' in tree:
        e = tree['estado'].replace('\n', ' ')
        if 'vacio' in e.lower() or 'vacío' in e.lower() or 'reponer' in e.lower():
            tree['estado'] = 'Alcorque vacío/Posición a reponer'
        elif 'sellado' in e.lower() or 'eliminada' in e.lower():
            tree['estado'] = 'Alcorque sellado/eliminado'
        elif 'tocón' in e.lower() or 'tocon' in e.lower():
            tree['estado'] = 'Tocón'
        elif 'muerto' in e.lower() or 'anular' in e.lower() or 'no plantar' in e.lower():
            tree['estado'] = 'Árbol muerto / No plantar'
        else:
            tree['estado'] = e

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(trees, f, ensure_ascii=False)
    
print("Data cleaned successfully.")
