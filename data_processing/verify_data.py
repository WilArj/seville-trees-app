import json
import os

json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'trees.json')

with open(json_path, 'r', encoding='utf-8') as f:
    trees = json.load(f)

print(f"Total trees in JSON: {len(trees)}")

# Let's count status
status_counts = {}
for tree in trees:
    status = tree.get('estado', 'Unknown')
    status_counts[status] = status_counts.get(status, 0) + 1
    
print("Status counts:")
for k, v in status_counts.items():
    print(f"  {k}: {v}")

# District counts
district_counts = {}
for tree in trees:
    d = tree.get('distrito', 'Unknown')
    district_counts[d] = district_counts.get(d, 0) + 1

print("\nDistrict counts:")
for k, v in district_counts.items():
    print(f"  {k}: {v}")
    
# Missing data check
missing_especie = sum(1 for t in trees if not t.get('especie'))
missing_latlon = sum(1 for t in trees if 'lat' not in t or 'lon' not in t)

print(f"\nMissing especie: {missing_especie}")
print(f"Missing coordinates: {missing_latlon}")
