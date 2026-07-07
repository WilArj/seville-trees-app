import pyproj

# ETRS89 / UTM zone 30N
utm = pyproj.CRS('EPSG:25830')
wgs84 = pyproj.CRS('EPSG:4326')
transformer = pyproj.Transformer.from_crs(utm, wgs84)

lat, lon = transformer.transform(237424.63, 4144656.61)
print(f"Lat: {lat}, Lon: {lon}")
