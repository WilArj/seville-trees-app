import os
import pdfplumber
import multiprocessing as mp

PDF_FILES = [
    'arboles-colegios.pdf',
    'arboles-colegios (1).pdf',
    'arboles-sin-recepcionar.pdf',
    'arboles-viario.pdf',
    'arboles-zonas-verdes.pdf'
]

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def process_page_count(args):
    pdf_path, page_num = args
    total_rows = 0
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[page_num]
        table = page.extract_table()
        if table:
            total_rows += len(table)
    return total_rows

def process_pdf_count(pdf_filename):
    pdf_path = f"{BASE_DIR}/{pdf_filename}"
    with pdfplumber.open(pdf_path) as pdf:
        num_pages = len(pdf.pages)
    
    args = [(pdf_path, i) for i in range(num_pages)]
    pool = mp.Pool(mp.cpu_count())
    results = pool.map(process_page_count, args)
    pool.close()
    pool.join()
    
    return sum(results)

if __name__ == '__main__':
    total = 0
    for pdf_file in PDF_FILES:
        total += process_pdf_count(pdf_file)
    print(f"Total raw rows in PDFs: {total}")