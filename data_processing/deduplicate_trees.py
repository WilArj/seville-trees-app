import json
import math

def main():
    print("Loading trees.json...")
    with open('trees.json', 'r', encoding='utf-8') as f:
        trees = json.load(f)

    unique_trees = []
    seen = set()
    duplicates_removed = 0

    for t in trees:
        if not t.get('lat') or not t.get('lon'):
            unique_trees.append(t)
            continue
        
        # Round lat/lon to 6 decimal places (~11 cm precision)
        lat_r = round(t['lat'], 6)
        lon_r = round(t['lon'], 6)
        sp = t.get('especie', '')
        
        key = (lat_r, lon_r, sp)
        if key not in seen:
            seen.add(key)
            unique_trees.append(t)
        else:
            duplicates_removed += 1

    print(f"Original: {len(trees)}")
    print(f"Unique: {len(unique_trees)}")
    print(f"Duplicates removed: {duplicates_removed}")

    print("Saving back to trees.json...")
    with open('trees.json', 'w', encoding='utf-8') as f:
        json.dump(unique_trees, f, indent=4, ensure_ascii=False)
        
    print("Done!")

if __name__ == '__main__':
    main()
