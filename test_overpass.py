import requests
import json

query = """
[out:json][timeout:30];
relation["name"="Sevilla"]["admin_level"="8"];
out tags;
"""
url = "https://overpass-api.de/api/interpreter"
headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://overpass-api.de/"
}
try:
    response = requests.post(url, data={"data": query}, headers=headers, timeout=30)
    print("Status:", response.status_code)
    print(json.dumps(response.json(), indent=2))
except Exception as e:
    print("Error:", e)
