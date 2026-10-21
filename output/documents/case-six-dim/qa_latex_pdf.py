import hashlib
import json
import re
from pathlib import Path
from pypdf import PdfReader
from pdf2image import convert_from_path
from PIL import Image, ImageDraw, ImageFont

TASK = Path('D:/建工ai/output/documents/case-six-dim')
PDF = TASK / 'latex/case-six-dim.pdf'
TEX = Path('D:/建工ai/docs/老旧小区改造案例拆分与六维数据说明.tex')
POPPLER = 'C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin'
OUTPUT = TASK / 'latex/render'
OUTPUT.mkdir(parents=True,exist_ok=True)
reader = PdfReader(PDF)
assert len(reader.pages) == 11
text = '\n'.join(page.extract_text() for page in reader.pages)
source = TEX.read_text(encoding='utf-8')
index = json.loads((TASK / 'case-card-index.json').read_text(encoding='utf-8'))
assert len(index) == 23
assert set(re.findall(r'\\decision\{(D\d+)\}',source)) == {f'D{x}' for x in range(1,11)}
assert all(f'full_id={card["id"]}' in source for card in index)
assert all(card['id'] in reader.named_destinations for card in index)
assert all(label in text for label in ['居民需求','公共服务','居住工程','实施协同','长效维护','资金交付'])
assert all(f'C{x:02d}' in text for x in range(1,24))
assert all(phrase not in source for phrase in ['不能解释为','不能用于估计','尚不能视为','不足以支撑'])
assert '\\input{' not in source
assert not re.search(r'Overfull|undefined|Missing character',(TASK/'latex/case-six-dim.log').read_text(encoding='utf-8'))
images = convert_from_path(str(PDF),dpi=120,poppler_path=POPPLER)
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf',22)
contacts = []
for n,image in enumerate(images,1):
    image.save(OUTPUT/f'page-{n:02d}.png')
    (OUTPUT/f'page-{n:02d}.txt').write_text(reader.pages[n-1].extract_text(),encoding='utf-8')
for start in range(0,len(images),2):
    subset = images[start:start+2]
    scaled = [image.resize((800,round(image.height*800/image.width))) for image in subset]
    canvas = Image.new('RGB',(len(scaled)*824+24,max(x.height for x in scaled)+70),'#e9e9e9')
    draw = ImageDraw.Draw(canvas)
    for offset,image in enumerate(scaled):
        left = 24+offset*824
        draw.text((left,12),f'Page {start+offset+1}',fill='black',font=font)
        canvas.paste(image,(left,48))
    target = OUTPUT/f'contact-{start//2+1:02d}.png'
    canvas.save(target)
    contacts.append(str(target))
result = {'pages':len(reader.pages),'saved_cards':23,'existing_rule_cards':4,'decision_items':10,
    'case_destinations_verified':23,'self_contained_tex':True,'model_calls':0,
    'pdf_sha256':hashlib.sha256(PDF.read_bytes()).hexdigest(),'contacts':contacts,
    'page_text_sizes':[len(p.extract_text()) for p in reader.pages],
    'visual_review':'pending'}
(TASK/'latex/qa.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
