# BUILD_03_CONTENT — load the real Booth 03 cases from the dentistry PDF

Work in the repo, folder `booth03/`. The dentistry team's PDF is `Read_the_Radiograph_.pdf` (5 pages, 10 cases). Put a copy at `booth03/source/Read_the_Radiograph_.pdf` if it is not there yet. Follow the existing schema in `booth03/data/keys.json` and the existing tools. Do not change the grading logic. Do not explain concepts in the output. UI text stays English.

## Task 1 — Build data/keys.json from the cases below
Replace the placeholder cases. Per case: findings points = 6, diagnosis points = 4, total exactly 10. Each case uses:
`id` ("case01".."case10"), `image` ("images/caseNN.jpg"), `question` ("Describe the radiographic findings and give your diagnosis."), `key{keyFindings[{finding,points,keywords[]}], diagnosis, diagnosisPoints:4, diagnosisKeywords[]}`, `expertExplanation`, `source`, `reviewStatus:"PENDING_REVIEW"`, `placeholder:false`, `aiReading:""`, `aiScore:null`.
Keywords: 4–8 lowercase short phrases and synonyms per finding/diagnosis that a student might write (e.g. "radiolucency", "radiolucent", "dark area"). Keep them specific enough not to match everything.

### Cases (finding → points)
01 Periapical inflammatory lesion (Endodontics)
- Periapical radiolucency around the roots → 3
- Loss of normal periapical trabecular pattern → 2
- Apical bone destruction → 1
- Diagnosis: Periapical inflammatory lesion; acute apical abscess only if supported by symptoms and examination
- Explanation: The image shows periapical radiolucency associated with a restored mandibular molar. Distinguishing an abscess from other apical inflammatory lesions requires clinical findings.
- Source: https://commons.wikimedia.org/wiki/File:Abscessed_tooth_periapical_radiograph.jpg

02 Proximal dental caries (Restorative Dentistry)
- Triangular radiolucency at the proximal surface → 3
- Lesion extending into the tooth structure → 2
- Location beneath the contact area → 1
- Diagnosis: Proximal dental caries
- Explanation: A proximal radiolucency is visible on the bitewing radiograph. Clinical assessment is needed to determine cavitation and treatment.
- Source: https://commons.wikimedia.org/wiki/File:Dental_Caries_.jpg

03 Extensive periodontal-endodontic lesion (Periodontology / Endodontics)
- Extensive radiolucent bone defect → 3
- Marked loss of supporting alveolar bone → 2
- Involvement extending toward the root/apical region → 1
- Diagnosis: Extensive periodontal-endodontic lesion, provisional
- Explanation: The radiograph shows extensive destruction of supporting bone adjacent to a compromised tooth. Pulp sensibility and periodontal probing are necessary to classify the lesion.
- Source: https://commons.wikimedia.org/wiki/File:Perio-endo_lesion.JPG

04 Dentigerous cyst associated with an unerupted premolar (Oral Radiology)
- Well-defined unilocular radiolucency → 2
- Association with the crown of an unerupted tooth → 2
- Displacement of the unerupted tooth → 2
- Diagnosis: Dentigerous cyst, reported case diagnosis
- Explanation: The lesion surrounds an unerupted mandibular premolar and displaces it. The published case identifies it as a dentigerous cyst; histopathology is needed for definitive cyst typing.
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC6970100/ (Figure 1A)

05 Impacted maxillary third molar (Oral Surgery)
- Unerupted upper third molar → 3
- Abnormal tooth orientation → 2
- Ectopic high position relative to the dental arch → 1
- Diagnosis: Impacted maxillary third molar
- Explanation: The panoramic radiograph shows an abnormally positioned, unerupted maxillary third molar. Further imaging may be needed when surgical planning requires detailed anatomy.
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC10520373/ (Figure 1)

06 Multiple impacted teeth (Orthodontics)
- Multiple unerupted teeth beyond expected positions → 3
- Abnormal eruption pathways → 2
- Displaced anterior tooth position → 1
- Diagnosis: Multiple impacted teeth
- Explanation: The pretreatment radiographs demonstrate multiple unerupted and displaced teeth. Clinical age and eruption history help distinguish impaction from normal developmental delay.
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC4109248/ (Figure 2)

07 Supernumerary teeth in the anterior maxilla (Pediatric Dentistry / Oral Radiology)
- Additional tooth-like structures → 3
- Location superior to permanent maxillary incisors → 2
- Altered eruption path / crowding potential → 1
- Diagnosis: Impacted supernumerary teeth
- Explanation: The arrows identify tooth-like radiopaque structures near the roots of maxillary incisors. These are consistent with impacted supernumerary teeth in the published case.
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC12397893/ (Figure 3)

08 Internal root resorption (Endodontics)
- Well-defined radiolucent enlargement within the root canal space → 3
- Balloon-like outline of the canal → 2
- Apparent continuity with the canal → 1
- Diagnosis: Internal root resorption, suspected
- Explanation: The root canal appears expanded by an intraradicular radiolucency. Angled radiographs or CBCT may help distinguish internal from external resorption.
- Source: https://n-clinic-dc.com/ (incomplete — exact URL missing)

09 Horizontal alveolar bone loss (Periodontology)
- Reduced interdental crestal bone height → 3
- Relatively even bone level across adjacent teeth → 2
- Alveolar crest approximately parallel to CEJ line → 1
- Diagnosis: Horizontal periodontal bone loss
- Explanation: The alveolar crest is reduced in height with a broadly horizontal pattern. Clinical periodontal measurements are needed to diagnose and stage periodontitis.
- Source: https://www.slideshare.net/ (incomplete — exact URL missing)

10 Vertical alveolar bone loss (Periodontology)
- Angular interdental bone defect → 3
- Unequal bone heights around adjacent roots → 2
- Oblique rather than horizontal bone-loss pattern → 1
- Diagnosis: Vertical/angular periodontal bone loss
- Explanation: The radiograph demonstrates an angular defect alongside the tooth root. Probing depth, attachment loss and full-mouth findings are required for periodontal diagnosis.
- Source: https://www.slideshare.net/ (incomplete — exact URL missing)

## Task 2 — Images
Extract the 10 radiographs from the PDF into `booth03/images/case01.jpg` … `case10.jpg` (use `pdfimages -all` or PyMuPDF; if extraction gives low quality, render the page at 300 dpi and crop by bounding box).
- Crop out white padding/black bars (cases 09, 10 have white borders; 06 has a composite — keep only the top panoramic; 04 is a 4-panel figure — keep panel A only if it can be cropped cleanly, otherwise keep all four).
- Keep red arrows as they are (cases 01, 07) and list those two in `booth03/review/image_notes.md` as "annotated image — dentistry to confirm or supply a clean one".
- Max width 1400 px, JPEG quality 85.
- Add `booth03/images/` to `.gitignore` ONLY IF the repo is public and licences are unchecked: create `booth03/images/LICENSES_TODO.md` listing each case's source URL and the rule "PMC/Wikimedia figures need licence check before public posting; 08/09/10 sources incomplete". Ask nothing; do the safe thing: add `booth03/images/*.jpg` to `.gitignore`, and note in the final report that images must be copied to laptops manually (not via GitHub).

## Task 3 — Pipeline
1. `python3 tools/validate_cases.py` — must pass (points sum to 10 per case).
2. `python3 tools/inject_cases.py` — inject into the booth page.
3. `python3 tools/prepare_ai_readings.py` using the Web App URL already in the config. If it cannot reach the network, stop at this step and report exactly the command to run.
4. `node tools/test_guard.js` — must pass.
5. Regenerate `booth03/review/booth03_review.html` and `export_review.py` output (PDF if possible) with the 10 cases, key, AI reading, explanation, source, and a status checkbox per case.
6. Run the existing mock test for booth03 end to end with `?mock=1`.

## Final report (max 12 lines)
Per case: image OK/needs attention. List what failed. List files created. Print the exact local run command for booth03 and the list of items blocked on dentistry review. Commit locally with message "Booth 03 real cases (pending review)" but do NOT push.
