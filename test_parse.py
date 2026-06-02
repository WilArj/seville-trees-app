import pdfplumber
import json
import os

pdf_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'arboles-viario.pdf')

with pdfplumber.open(pdf_path) as pdf:
    first_page = pdf.pages[0]
    table = first_page.extract_table()
    
    if table:
        print(f"Columns: {table[0]}")
        print(f"First row: {table[1]}")
    else:
        print("No table found")
