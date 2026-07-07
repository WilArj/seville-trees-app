import requests
import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(BASE_DIR, 'seville-trees-app', 'data', 'district-boundaries.json')

def fetch_osm_districts():
    print("Querying Overpass API for official Seville districts...")
    
    # Overpass query to find admin_level=9 relations inside Sevilla municipal boundary (relation ID 342563 -> Area 3600342563)
    query = """
    [out:json][timeout:30];
    area(3600342563)->.searchArea;
    (
      relation["admin_level"="9"]["boundary"="administrative"](area.searchArea);
    );
    out geom;
    """
    
    url = "https://overpass-api.de/api/interpreter"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://overpass-api.de/"
    }
    try:
        response = requests.post(url, data={"data": query}, headers=headers, timeout=30)
        if response.status_code != 200:
            print(f"Error querying Overpass API: HTTP {response.status_code}")
            return None
        return response.json()
    except Exception as e:
        print(f"Connection error to Overpass API: {e}")
        return None

def process_and_save():
    data = fetch_osm_districts()
    if not data or 'elements' not in data:
        print("No elements found in Overpass API response.")
        return

    print(f"Found {len(data['elements'])} boundary elements. Matching names...")
    
    # We will map OSM names to our normalized district names in trees.json
    name_mapping = {
        "Casco Antiguo": "Casco Antiguo",
        "Distrito Casco Antiguo": "Casco Antiguo",
        
        "Macarena": "Macarena",
        "Distrito Macarena": "Macarena",
        
        "Nervión": "Nervión",
        "Distrito Nervión": "Nervión",
        
        "Cerro - Amate": "Cerro-Amate",
        "Cerro-Amate": "Cerro-Amate",
        "Distrito Cerro - Amate": "Cerro-Amate",
        
        "Sur": "Sur",
        "Distrito Sur": "Sur",
        
        "Triana": "Triana",
        "Distrito Triana": "Triana",
        
        "Los Remedios": "Los Remedios",
        "Distrito Los Remedios": "Los Remedios",
        
        "Bellavista - La Palmera": "Bellavista-La Palmera",
        "Bellavista-La Palmera": "Bellavista-La Palmera",
        "Distrito Bellavista - La Palmera": "Bellavista-La Palmera",
        
        "San Pablo - Santa Justa": "San Pablo-Santa Justa",
        "San Pablo-Santa Justa": "San Pablo-Santa Justa",
        "Distrito San Pablo - Santa Justa": "San Pablo-Santa Justa",
        
        "Este - Alcosa - Torreblanca": "Este-Alcosa-Torreblanca",
        "Este-Alcosa-Torreblanca": "Este-Alcosa-Torreblanca",
        "Distrito Este - Alcosa - Torreblanca": "Este-Alcosa-Torreblanca",
        
        "Norte": "Norte",
        "Distrito Norte": "Norte"
    }

    # Helper to clean/sanitize names for files
    def sanitize_filename(name):
        import re
        s = name.strip().lower()
        s = re.sub(r'[^\w\s-]', '', s)
        s = re.sub(r'[\s]+', '-', s)
        return s

    boundaries = {}

    for el in data['elements']:
        tags = el.get('tags', {})
        osm_name = tags.get('name', '')
        
        # Resolve clean name
        clean_name = name_mapping.get(osm_name)
        if not clean_name:
            # Try matching by prefix or substring
            for k, v in name_mapping.items():
                if k in osm_name or osm_name in k:
                    clean_name = v
                    break
        
        if not clean_name:
            print(f"  Unmatched OSM name: '{osm_name}'")
            continue

        # Extract coordinates of the polygon
        # OSM relations consist of members (ways)
        # We need to assemble the outer boundary from the geometry of ways
        members = el.get('members', [])
        
        # Let's extract points from members. Since out geom is requested,
        # OSM elements contain way geometries in CCW or CW order.
        # Let's collect all nodes coordinates.
        polygons = []
        
        # A relation has members that are ways.
        # We can construct the loops by connecting the coordinates of ways.
        # Let's write a simple way assembler.
        segments = []
        for member in members:
            if member.get('type') == 'way' and member.get('role') == 'outer':
                geom = member.get('geometry', [])
                if len(geom) >= 2:
                    # Convert to lat-lon point lists
                    pts = [[pt['lat'], pt['lon']] for pt in geom]
                    segments.append(pts)
        
        # Chaining segments into closed loops
        loops = []
        while segments:
            # Pick first segment
            curr_loop = segments.pop(0)
            
            # Try to connect other segments to this loop
            changed = True
            while changed:
                changed = False
                for i, seg in enumerate(segments):
                    # Check connection at ends (with small tolerance)
                    tol = 1e-6
                    
                    # Loop end matches Segment start
                    if abs(curr_loop[-1][0] - seg[0][0]) < tol and abs(curr_loop[-1][1] - seg[0][1]) < tol:
                        curr_loop.extend(seg[1:])
                        segments.pop(i)
                        changed = True
                        break
                    # Loop end matches Segment end (reversed)
                    elif abs(curr_loop[-1][0] - seg[-1][0]) < tol and abs(curr_loop[-1][1] - seg[-1][1]) < tol:
                        curr_loop.extend(reversed(seg[:-1]))
                        segments.pop(i)
                        changed = True
                        break
                    # Loop start matches Segment end
                    elif abs(curr_loop[0][0] - seg[-1][0]) < tol and abs(curr_loop[0][1] - seg[-1][1]) < tol:
                        curr_loop = seg[:-1] + curr_loop
                        segments.pop(i)
                        changed = True
                        break
                    # Loop start matches Segment start (reversed)
                    elif abs(curr_loop[0][0] - seg[0][0]) < tol and abs(curr_loop[0][1] - seg[0][1]) < tol:
                        curr_loop = list(reversed(seg[1:])) + curr_loop
                        segments.pop(i)
                        changed = True
                        break
            
            loops.append(curr_loop)
            
        if loops:
            filename = sanitize_filename(clean_name) + '.json'
            
            # Simple fallback to read actual tree count for this district from districts.json
            count = 0
            districts_metadata_path = os.path.join(BASE_DIR, 'seville-trees-app', 'data', 'districts.json')
            if os.path.exists(districts_metadata_path):
                with open(districts_metadata_path, 'r', encoding='utf-8') as df:
                    meta_list = json.load(df)
                    for m in meta_list:
                        if m['name'] == clean_name:
                            count = m['count']
                            break

            boundaries[clean_name] = {
                'name': clean_name,
                'filename': filename,
                'polygon': loops, # List of closed loops (lat, lon)
                'count': count
            }
            total_vertices = sum(len(l) for l in loops)
            print(f"  Mapped '{osm_name}' to '{clean_name}' -> {len(loops)} loops, {total_vertices} total vertices")

    print(f"Saving official boundaries to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(boundaries, f, ensure_ascii=False)
    print("Success!")

if __name__ == '__main__':
    process_and_save()
