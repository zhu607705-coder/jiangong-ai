# Third-party notices

This local prototype includes the following bounded source ports and adaptations. Original license notices are retained next to vendored files. Exact upstream refs, file hashes, modified targets and test references are recorded in `research/upstream.lock.json`.

| Upstream | License file | Included or adapted source |
|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | `vendor/dsh/LICENSE` (MIT) | Published runtime packages pinned in package-lock.json; two original test/helper files retained for the baseline |
| [CRE Acquisition Orchestrator](https://github.com/ahacker-1/cre-acquisition-orchestrator) | `vendor/cre/LICENSE` (Apache-2.0) | Original selected component/parser/report sources; generic Python PDF/Excel extraction ports; WorkspaceFrame and LifecycleSpine adaptations; exposed generic parser functions; selectively ported table renderer |
| [RETQA](https://github.com/jensenw1/RETQA) | `licenses/RETQA-LICENSE.txt`, `vendor/retqa/LICENSE` (MIT) | `ported/retqa_slots.py`; Copyright (c) 2024 jensen-w. Enterprise-label and input-validation patches retained from the supplied package |
| [ReCoQA / HIRE](https://github.com/Husky-989/ReCoQA) | `vendor/hire/LICENSE` (MIT) | `vendor/hire/readonly.py`, derived cursor/headers/rows interface, with credentials removed, read-only parameterized execution and bounded resources |
| [GeoAgent](https://github.com/opengeos/GeoAgent) | `vendor/geoagent/LICENSE` (MIT) | GeoToolMeta and metadata helper functions; no Strands runtime copied |
| [STORM](https://github.com/stanford-oval/storm) | `vendor/storm/LICENSE` (MIT) | `construct_url_to_info` selective port; copies inputs and retains stable deduplication order |
| [Search-o1](https://github.com/RUC-NLPIR/Search-o1) | `vendor/search_o1/LICENSE` (MIT) | `extract_between` and `get_webpage_to_reasonchain_instruction`; no local model server or unrestricted search client |

Adaptations are identified in source comments. No upstream fixed acquisition verdicts, stock logic, hardcoded database credentials, model weights, fonts, or enterprise data are included in the product source.

The npm/Python libraries (including React, Express, PGlite, PostgreSQL client, FastAPI, Pydantic, Shapely, pyproj, rank-bm25, jieba and SQLGlot) retain their own package licenses. Dependency versions are pinned by `package-lock.json` and `requirements.lock.txt`; a top-level source license does not automatically cover third-party datasets, weights or transitive packages.

CityBench, PlanBench, LLM-Geo and BacktestBench remain design candidates and are not integrated or redistributed here. The public government-page snapshot is provenance for one HTTP acquisition smoke check, not enterprise data or a local-project legal determination.

Additional v0.2 dependencies include python-docx (MIT), pandas (BSD), openpyxl (MIT), pdfplumber/pdfminer.six (MIT), pypdfium2 (Apache-2.0/BSD with PDFium third-party notices), ReportLab (BSD), Mozilla Readability (Apache-2.0), and linkedom (ISC). Package distributions retain their own notices. The geocoding research adapter attributes location data to GeoNames via Open-Meteo; its default endpoint is for noncommercial research use, not an assertion of cadastral accuracy or unrestricted commercial access.

Map integration uses `@amap/amap-jsapi-loader` 1.0.1 and `@amap/amap-jsapi-types` 0.0.15 (MIT as declared by their published package metadata). AMap JS API 2.0 is loaded from the provider at runtime. Map tiles, buildings, satellite imagery, place information and photos remain provider content; map attribution is retained. The loader/type-package licenses do not grant rights to redistribute or train on map data. No provider SDK response or map credentials are vendored into this source distribution.

Object-boundary screening adds Turf boolean-point-in-polygon/boolean-valid 7.2.0 (MIT; npm distributions retain notices) and eviltransform 0.1.1 (BSD-2-Clause, Copyright 2015 GoogolLee and contributors; see licenses/eviltransform-LICENSE.txt). No coordinate-conversion implementation is copied into application code.

Administrative-name recognition uses `@province-city-china/province`, `city` and `area` 8.5.8, plus their `types` dependency (MIT, Copyright 2019 wabg; see `licenses/province-city-china-LICENSE.txt`). Published packages and integrity hashes are pinned in `package-lock.json`; upstream source commit is `c2180d384d6c6b332e01adeb0815ebd4a741be5f`. These names are a lexical reference for distinguishing addresses from object names and prose, not a current geocoder or proof of object identity. The selected address still comes from the live provider. Upstream describes historical administrative snapshots; absence from the vocabulary does not establish a matching location.

OpenStreetMap boundary data is queried on demand under ODbL 1.0; attribution and the copyright link remain visible when used. User-supplied project geometry is not sent to Overpass. The 50 public urban-renewal reference cases contain concise factual descriptions plus separately identified project analysis, with publisher links and page/case locators; no original publication PDF is redistributed.

## AIHOT — MIT selective source adaptation

AIHOT `KKKKhazix/AIHOT@589f79eff09470b31ba8a7f1d9eb62d36ff2be6c`, copyright (c) 2026 数字生命卡兹克. Selected JSON mapping and event relation functions are in `vendor/aihot/algorithms.ts`; the intake, double-score selection, source-group decay and evaluation workflow are adapted for construction research. Full license: `licenses/AIHOT-LICENSE.txt`. Exact source blobs, target hashes and static call edges: `research/aihot.upstream.lock.json`. The source ledger distinguishes copied functions from mechanism adaptation. No AIHOT brand/logo/fonts, entire web application or independent provider runtime is imported.


## Certbot deployment dependencies

The campus HTTPS service uses Certbot 5.8.0 and certbot-dns-aliyun 2.0.0 from their published Python packages (Apache-2.0), installed in a dedicated server venv at `/opt/certbot`. Aliyun plugin upstream: https://github.com/tengattack/certbot-dns-aliyun , inspected commit `c179a6e569ed70a78ec817fe839cdf26dfcdbfc0`. Their packages retain their upstream licenses and notices. No upstream source is vendored into the application.

`scripts/haizhizi-certbot.py` imports that plugin and wraps only its DNS transport and cleanup. The existing signer/authenticator remains upstream; cleanup matches the full TXT name, type and challenge value, and an explicitly configured existing loopback proxy applies only to the Aliyun API. The wrapper does not acquire broader DNS permissions.
