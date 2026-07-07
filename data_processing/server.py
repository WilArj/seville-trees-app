import http.server
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import urllib.parse
import csv
import tempfile

PORT = 8001

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == '/api/tree':
            query_components = urllib.parse.parse_qs(parsed_url.query)
            idx_str = query_components.get('idx', [None])[0]
            if idx_str:
                try:
                    idx = int(idx_str)
                    master_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'trees.json')
                    with open(master_path, 'r', encoding='utf-8') as f:
                        trees = json.load(f)
                    
                    found_tree = next((t for t in trees if t.get('idx') == idx), None)
                    if found_tree:
                        self.send_response(200)
                        self.send_header('Content-type', 'application/json')
                        self.end_headers()
                        self.wfile.write(json.dumps({'status': 'success', 'tree': found_tree}).encode('utf-8'))
                        return
                    else:
                        self.send_response(404)
                        self.send_header('Content-type', 'application/json')
                        self.end_headers()
                        self.wfile.write(json.dumps({'status': 'error', 'message': 'Tree not found'}).encode('utf-8'))
                        return
                except ValueError:
                    pass
            self.send_response(400)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'error', 'message': 'Invalid IDX'}).encode('utf-8'))
            return
            
        super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == '/api/save-singular':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                
                # Save to CSV file 'seville-trees-app/data/singular_trees.csv'
                csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'seville-trees-app', 'data', 'singular_trees.csv')
                
                # Format to save
                es_headers = [
                    'Nº Ejemplar (Guía)', 'Código', 'Nombre Singular (Guía)', 'Especie Científica',
                    'Latitud', 'Longitud', 'IDX'
                ]
                
                os.makedirs(os.path.dirname(csv_path), exist_ok=True)
                with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
                    writer = csv.writer(f, delimiter=';')
                    writer.writerow(es_headers)
                    for item in data:
                        writer.writerow([
                            item.get('num', ''),
                            item.get('code', ''),
                            item.get('name', ''),
                            item.get('especie', ''),
                            item.get('lat', ''),
                            item.get('lon', ''),
                            item.get('idx', '')
                        ])
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success'}).encode('utf-8'))
                print("Saved singular trees to CSV successfully.")
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
        elif parsed_url.path == '/api/save-district':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                payload = json.loads(post_data.decode('utf-8'))
                filename = payload.get('filename')
                district_trees = payload.get('trees', [])
                
                if not filename:
                    raise Exception("Missing filename")
                
                # Atomic save for specific district JSON file
                data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'seville-trees-app', 'data')
                district_path = os.path.join(data_dir, filename)
                
                temp_fd, temp_path = tempfile.mkstemp(dir=data_dir)
                with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                    json.dump(district_trees, f, ensure_ascii=False)
                os.replace(temp_path, district_path)
                
                # Rebuild trees.json by merging all districts
                districts_metadata_path = os.path.join(data_dir, 'districts.json')
                all_merged_trees = []
                
                if os.path.exists(districts_metadata_path):
                    with open(districts_metadata_path, 'r', encoding='utf-8') as f:
                        districts_meta = json.load(f)
                    
                    for dist in districts_meta:
                        dist_filename = dist.get('filename')
                        dist_file_path = os.path.join(data_dir, dist_filename)
                        if os.path.exists(dist_file_path):
                            with open(dist_file_path, 'r', encoding='utf-8') as df:
                                dist_trees = json.load(df)
                                all_merged_trees.extend(dist_trees)
                
                # Atomic save for master trees.json
                master_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'trees.json')
                temp_fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(master_path))
                with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                    json.dump(all_merged_trees, f, ensure_ascii=False)
                os.replace(temp_path, master_path)
                
                # Synchronize singular_trees.csv by extracting trees with singular=True
                singular_csv_path = os.path.join(data_dir, 'singular_trees.csv')
                es_headers = [
                    'Nº Ejemplar (Guía)', 'Código', 'Nombre Singular (Guía)', 'Especie Científica',
                    'Latitud', 'Longitud', 'IDX'
                ]
                
                singular_list = []
                for tree in all_merged_trees:
                    if tree.get('singular') is True:
                        singular_list.append(tree)
                
                temp_fd, temp_path = tempfile.mkstemp(dir=data_dir)
                with os.fdopen(temp_fd, 'w', encoding='utf-8-sig', newline='') as f:
                    writer = csv.writer(f, delimiter=';')
                    writer.writerow(es_headers)
                    for item in singular_list:
                        writer.writerow([
                            item.get('num', ''),
                            item.get('code', ''),
                            item.get('name', ''),
                            item.get('especie', ''),
                            item.get('lat', ''),
                            item.get('lon', ''),
                            item.get('idx', '')
                        ])
                os.replace(temp_path, singular_csv_path)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', 'count': len(district_trees)}).encode('utf-8'))
                print(f"Saved district {filename} and rebuilt trees.json and singular_trees.csv successfully.")
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

import socketserver

if __name__ == '__main__':
    # Change working dir to script directory to ensure relative paths work
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    
    # Allow port reuse to avoid 'Address already in use' errors on quick restarts
    ThreadingHTTPServer.allow_reuse_address = True
    with ThreadingHTTPServer(("", PORT), CustomHTTPRequestHandler) as httpd:
        print(f"Serving HTTP on port {PORT} with Custom API Handler (Multi-threaded)...")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
