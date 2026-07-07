import os
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TREES_JSON = os.path.join(BASE_DIR, 'trees.json')
OUTPUT_FILE = os.path.join(BASE_DIR, 'seville-trees-app', 'data', 'district-boundaries.json')

def generate_boundaries():
    if not os.path.exists(TREES_JSON):
        print(f"File not found: {TREES_JSON}")
        return

    print("Reading trees.json...")
    with open(TREES_JSON, 'r', encoding='utf-8') as f:
        trees = json.load(f)

    # Get bounds
    lats = [t['lat'] for t in trees if 'lat' in t]
    lons = [t['lon'] for t in trees if 'lon' in t]
    
    if not lats or not lons:
        print("No valid coordinates found in trees.json.")
        return

    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    
    # Pad bounds slightly to avoid index errors at exact borders
    padding_factor = 0.01
    lat_span = max_lat - min_lat
    lon_span = max_lon - min_lon
    min_lat -= lat_span * padding_factor
    max_lat += lat_span * padding_factor
    min_lon -= lon_span * padding_factor
    max_lon += lon_span * padding_factor

    # Grid dimensions (100x100 is high-res, smooth, and adjacent)
    H, W = 80, 80
    d_lat = (max_lat - min_lat) / H
    d_lon = (max_lon - min_lon) / W

    print(f"Grid size: {H}x{W}. Lat span: {min_lat:.4f} to {max_lat:.4f}, Lon span: {min_lon:.4f} to {max_lon:.4f}")

    # Build 3D counters for grid cells: grid_counts[r][c][district] = count
    grid_counts = [[{} for _ in range(W)] for _ in range(H)]
    district_counts = {}

    for tree in trees:
        distrito = tree.get('distrito', '').strip()
        if not distrito or distrito == 'Unknown':
            continue
        
        lat = tree.get('lat')
        lon = tree.get('lon')
        if lat and lon:
            r = int((lat - min_lat) / d_lat)
            c = int((lon - min_lon) / d_lon)
            
            # Clamp
            r = max(0, min(r, H - 1))
            c = max(0, min(c, W - 1))
            
            grid_counts[r][c][distrito] = grid_counts[r][c].get(distrito, 0) + 1
            district_counts[distrito] = district_counts.get(distrito, 0) + 1

    # Map each grid cell to its majority district
    grid = [[None for _ in range(W)] for _ in range(H)]
    for r in range(H):
        for c in range(W):
            counts = grid_counts[r][c]
            if counts:
                majority_district = max(counts, key=counts.get)
                grid[r][c] = majority_district

    # Morphological Fill: Fill empty cells surrounded by a single district
    # This smooths out parks, plazas and empty streets
    for _ in range(2): # 2 iterations of filling
        for r in range(1, H - 1):
            for c in range(1, W - 1):
                if grid[r][c] is None:
                    neighbors = [grid[r-1][c], grid[r+1][c], grid[r][c-1], grid[r][c+1]]
                    valid_neighbors = [n for n in neighbors if n is not None]
                    if valid_neighbors:
                        # Check if all neighbors belong to the exact same district
                        unique = set(valid_neighbors)
                        if len(unique) == 1:
                            grid[r][c] = list(unique)[0]

    # Helper to clean/sanitize names for files
    def sanitize_filename(name):
        import re
        s = name.strip().lower()
        s = re.sub(r'[^\w\s-]', '', s)
        s = re.sub(r'[\s]+', '-', s)
        return s

    boundaries = {}

    # Map grid vertex coordinates back to lat/lon
    def get_latlon(r, c):
        lat = min_lat + r * d_lat
        lon = min_lon + c * d_lon
        return [lat, lon]

    # For each district, trace its non-overlapping boundaries
    for distrito in district_counts.keys():
        # Trace outer edges
        # Edges are represented as directed segments between vertices: (v_start, v_end)
        # vertex is represented by tuple (r, c)
        edges = set()
        
        for r in range(H):
            for c in range(W):
                if grid[r][c] == distrito:
                    # Bottom neighbor
                    if r == 0 or grid[r-1][c] != distrito:
                        edges.add(((r, c), (r, c+1)))
                    # Right neighbor
                    if c == W-1 or grid[r][c+1] != distrito:
                        edges.add(((r, c+1), (r+1, c+1)))
                    # Top neighbor
                    if r == H-1 or grid[r+1][c] != distrito:
                        edges.add(((r+1, c+1), (r+1, c)))
                    # Left neighbor
                    if c == 0 or grid[r][c-1] != distrito:
                        edges.add(((r+1, c), (r, c)))

        # Trace directed loops from edges
        # Build adjacency mapping (graph)
        adj = {}
        for u, v in edges:
            if u not in adj:
                adj[u] = []
            adj[u].append(v)

        polygons = []
        visited = set()

        for u, v in list(edges):
            if (u, v) in visited:
                continue

            # Trace a closed loop
            loop = [u]
            curr = v
            visited.add((u, v))

            while curr != u:
                loop.append(curr)
                # Find outgoing edge from curr
                next_nodes = adj.get(curr, [])
                next_node = None
                for n in next_nodes:
                    if (curr, n) not in visited:
                        next_node = n
                        break
                if next_node is None:
                    break
                visited.add((curr, next_node))
                curr = next_node

            if len(loop) >= 3:
                # Convert vertex grid coords (r, c) to lat/lon
                latlon_loop = [get_latlon(pt[0], pt[1]) for pt in loop]
                polygons.append(latlon_loop)

        # We keep all closed loops. If there is a main one and smaller islands,
        # passing them as a list to L.polygon renders them as a MultiPolygon in Leaflet!
        if polygons:
            filename = sanitize_filename(distrito) + '.json'
            
            # Save the polygons list. We only take loops that have enough points.
            boundaries[distrito] = {
                'name': distrito,
                'filename': filename,
                'polygon': polygons, # List of loops (Array of Arrays of [lat, lon])
                'count': district_counts[distrito]
            }
            total_vertices = sum(len(p) for p in polygons)
            print(f"  {distrito}: {district_counts[distrito]} trees -> {len(polygons)} polygons, {total_vertices} total vertices")

    print(f"Saving boundaries to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(boundaries, f, ensure_ascii=False)

    print("Success! Perfect non-overlapping district boundaries generated.")

if __name__ == '__main__':
    generate_boundaries()
