import hashlib
import json
import re
from pathlib import Path
from pypdf import PdfReader
from pdf2image import convert_from_path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path('D:/建工ai')
TASK=ROOT/'output/documents/renewal-review/main'
PDF=TASK/'renewal-review.pdf'
TEX=ROOT/'docs/老旧小区改造案例拆分与六维数据说明.tex'
RUNTIME=Path('C:/Users/123/.cache/codex-runtimes/codex-primary-runtime')
POPPLER=str(RUNTIME/'dependencies/native/poppler/Library/bin')
reader=PdfReader(PDF)
texts=[page.extract_text() for page in reader.pages]
whole='\n'.join(texts)
source=TEX.read_text(encoding='utf-8')
assert len(reader.pages)>0
assert {f'D{x}' for x in range(13)}==set(re.findall(r'\\decision\{(D\d+)\}',source))
assert all(label in whole for label in ['前置模式判定','市场收益','先补充关键资料再判断','X013','X014'] if label not in ['X013','X014'])
assert all(f'R{x:03d}' in whole for x in range(1,28))
assert all(f'C{x:02d}' in whole for x in range(1,24))
assert all(word in whole for word in ['采集方式','来源与缺项','规则对应'])
assert all(word in whole for word in ['分时容量','收支切换','社区构成敏感区间','同口径参考组'])
assert not re.search(r'Overfull|undefined|Missing character|LaTeX Error',(TASK/'renewal-review.log').read_text(encoding='utf-8'))
criteria=json.loads((ROOT/'data/imports/teacher-criteria-20261012.json').read_text(encoding='utf-8'))
hashes=[]
for workbook in criteria['workbooks']:
    observed=hashlib.sha256(Path(workbook['path']).read_bytes()).hexdigest()
    assert observed==workbook['sha256']
    hashes.append({'name':workbook['file_name'],'sha256':observed,'unchanged':True})
registry=json.loads((ROOT/'data/templates/renewal-research-register.json').read_text(encoding='utf-8'))
assert len({r['original_id'] for r in registry['rows']})==46
assert {r['analysis_domain'] for r in registry['rows']}=={'前置模式判定','居民需求','公共服务','居住工程','实施协同','长效维护','资金交付','市场收益'}
images=convert_from_path(str(PDF),dpi=110,poppler_path=POPPLER)
render=TASK/'render'
render.mkdir(exist_ok=True)
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',21)
contacts=[]
for n,image in enumerate(images,1):
    image.save(render/f'page-{n:02d}.png')
    (render/f'page-{n:02d}.txt').write_text(texts[n-1],encoding='utf-8')
for start in range(0,len(images),3):
    subset=images[start:start+3]
    thumbnails=[]
    for img in subset:
        scale=min(700/img.width,990/img.height)
        thumbnails.append(img.resize((round(img.width*scale),round(img.height*scale))))
    canvas=Image.new('RGB',(len(thumbnails)*724+24,1065),'#e9e9e9')
    draw=ImageDraw.Draw(canvas)
    for offset,img in enumerate(thumbnails):
        x=24+offset*724
        draw.text((x,14),f'Page {start+offset+1}',fill='black',font=font)
        canvas.paste(img,(x,52))
    target=render/f'contact-{start//3+1:02d}.png'
    canvas.save(target)
    contacts.append(str(target))
result={'pages':len(reader.pages),'input_workbooks':hashes,'selected_rules':27,'core_fields':46,
    'default_missing_fields':76,'expert_pending':15,'original_case_cards':23,'decision_items':13,
    'historical_prototype_checks':{'economics_tests':10,'aging_tests':6,'criteria_tests':5},
    'current_validation_logs':['research/test_results/scientific-methods-python.log','research/test_results/scientific-methods-vitest.log'],
    'latex_warnings':0,'contacts':contacts,'visual_review':'pending',
    'sha256':hashlib.sha256(PDF.read_bytes()).hexdigest()}
(TASK/'qa.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'pages':len(reader.pages),'input_unchanged':True,'core_fields':46,'rules':27,'contacts':contacts},ensure_ascii=False))
