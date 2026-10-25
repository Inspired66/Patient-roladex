# Vocabulary report: Vosk small-en-us-0.15 vs vellum-terms-combined.txt

No audio was run. Model zip verified against its pins (size, SHA-256, MD5) and unpacked with Python
`zipfile` into the git-ignored `android/third_party/vosk/model/`. Vocabulary: 152,217 words, read from the
output symbol table in `graph/Gr.fst`. A multi-word term is OOV if any of its words is, and
"in vocabulary" does **not** mean "will be recognised correctly".

## 1. Overall and per-category OOV

**154 of 477 terms OOV (32.3%).**

| Category | OOV / terms | Rate |
|---|---|---|
| drug | 56 / 103 | 54.4% |
| procedure | 28 / 56 | 50.0% |
| implant | 5 / 11 | 45.5% |
| instrument | 4 / 9 | 44.4% |
| fluid | 4 / 11 | 36.4% |
| technique | 12 / 36 | 33.3% |
| condition | 9 / 32 | 28.1% |
| equipment | 6 / 25 | 24.0% |
| anatomy | 15 / 66 | 22.7% |
| complication | 8 / 39 | 20.5% |
| phrase | 4 / 39 | 10.3% |
| assessment | 3 / 31 | 9.7% |
| abbrev | 0 / 9 | 0% |
| unit | 0 / 10 | 0% |

## 2. OOV terms by category

Spelling flag: **US-in-vocab** means only the British spelling is missing and the American variant is
present. Your list already contains some UK/US pairs, so some entries are duplicates of one concept.

### drug (56)
thiopentone (**US-in-vocab**: thiopental), etomidate, dexmedetomidine, sevoflurane, desflurane, isoflurane,
remifentanil, alfentanil, sufentanil, parecoxib, ketorolac, ondansetron, granisetron, droperidol, cyclizine,
prochlorperazine, aprepitant, rocuronium, vecuronium, atracurium, cisatracurium, suxamethonium, succinylcholine,
sugammadex, neostigmine, glycopyrrolate, atropine, metaraminol, dobutamine, glyceryl trinitrate, esmolol,
labetalol, metoprolol, amiodarone, hydralazine, bupivacaine, levobupivacaine, ropivacaine,
lignocaine (**US-in-vocab**: lidocaine), prilocaine, chloroprocaine, tranexamic acid, protamine, enoxaparin,
dantrolene, flumazenil, cefazolin, metronidazole, clindamycin, piperacillin, tazobactam, ceftriaxone, apixaban,
rivaroxaban, prednisolone, povidone iodine

### procedure (28)
cholecystectomy, laparoscopic cholecystectomy, appendicectomy (**US-in-vocab**: appendectomy), herniorrhaphy,
laparotomy, colectomy, hemicolectomy, Hartmann's procedure (**US-in-vocab**: "hartmann" present, "hartmann's" is not),
oesophagectomy, esophagectomy, splenectomy, haemorrhoidectomy, hemorrhoidectomy, fistulotomy, thyroidectomy,
parathyroidectomy, fasciotomy, abdominoplasty, blepharoplasty, septoplasty, arthroplasty, meniscectomy,
intramedullary nailing, laminectomy, discectomy, cystoscopy, nephrectomy, salpingectomy

### technique (12)
interscalene block, supraclavicular block, popliteal block, transversus abdominis plane block, erector spinae
plane block, paravertebral block, rectus sheath block, ilioinguinal block, pudendal block,
awake fibreoptic intubation (**US-in-vocab**: fiberoptic), extubation, inhalational induction

### anatomy (15)
subarachnoid space, intrathecal, ligamentum flavum, cricoid pressure, cricothyroid membrane, bronchus,
phrenic nerve, popliteal fossa, peritoneum, omentum, mesentery, jejunum,
caecum (**US-in-vocab**: cecum), saphenous vein, acetabulum

### condition (9)
cholecystitis, cholelithiasis, necrotising fasciitis (**US-in-vocab**: necrotizing), haematoma (**US-in-vocab**:
hematoma), seroma, wound dehiscence, anastomotic leak, ascites, ischaemia (**US-in-vocab**: ischemia)

### equipment (6)
laryngoscope, videolaryngoscope, supraglottic airway, nasopharyngeal airway,
fibreoptic bronchoscope (**US-in-vocab**: fiberoptic), capnography

### complication (8)
laryngospasm, bronchospasm, hypercapnia, post dural puncture headache, hypovolaemia, hypovolemia (both
spellings OOV), pneumothorax, pruritus

### implant (5)
intramedullary nail, cannulated screw, Vicryl, Prolene, Monocryl

### instrument (4)
retractor, trocar, laparoscope, haemostat (both haemostat and hemostat are OOV)

### fluid (4)
Hartmann's solution (**US-in-vocab**: hartmann), crystalloid, gelofusine, cryoprecipitate

### phrase (4)
maintained with sevoflurane, reversed with sugammadex, extubated awake, right interscalene block
(each OOV only through its drug, technique or block word)

### assessment (3)
Mallampati, thyromental distance, premedication

**Spelling-only OOV: 11 terms** (thiopentone, lignocaine, appendicectomy, caecum, necrotising fasciitis,
haematoma, ischaemia, fibreoptic bronchoscope, awake fibreoptic intubation, Hartmann's solution,
Hartmann's procedure). Removing them leaves 143 / 477 = 30.0% OOV, so spelling is not the main cause.
Terms with no US variant in vocabulary (esophagectomy, hemorrhoidectomy, hypovolemia, hemostat) are
genuinely missing.

## 3. Drug names

**OOV share: 56 / 103 = 54.4%.** In vocabulary (47): propofol, thiopental, ketamine, midazolam, nitrous oxide,
fentanyl, morphine, hydromorphone, oxycodone, tramadol, methadone, tapentadol, paracetamol, acetaminophen,
diclofenac, ibuprofen, clonidine, magnesium sulphate/sulfate, dexamethasone, metoclopramide, phenylephrine,
ephedrine, noradrenaline, norepinephrine, adrenaline, epinephrine, vasopressin, adenosine, lidocaine, heparin,
naloxone, salbutamol, hydrocortisone, lipid emulsion, gentamicin, vancomycin, flucloxacillin, amoxicillin,
warfarin, celecoxib, gabapentin, pregabalin, chlorhexidine, metformin, aspirin, clopidogrel.

### Likely substitutions for OOV drugs

**Caveat: these are best guesses from string similarity to in-vocabulary words, plus my judgement of sound.
There is no pronunciation lexicon here, so they are unvalidated. The audio test is what shows what actually
happens.** The decoder can also emit several short words instead of one word.

| OOV drug | Most likely in-vocab output (guess) |
|---|---|
| dexmedetomidine | dexamethasone (a different, in-vocab drug) |
| rocuronium | pancuronium (a different drug), uranium, cranium |
| vecuronium | pancuronium, europium |
| atracurium | atrium, terrarium |
| cisatracurium | sanitarium, "sis" + atrium |
| suxamethonium | strontium, ruthenium |
| succinylcholine | acetylcholine, "succinct" + choline |
| ketorolac | tortola, kerouac; ketamine is a risk |
| remifentanil | fentanyl (a different drug), regimental |
| alfentanil / sufentanil | fentanyl |
| bupivacaine | "privacies", "vaccine", procaine |
| levobupivacaine | no close single word; several words |
| ropivacaine | procaine, novocaine, tropicana |
| lignocaine | lidocaine (same drug, fine) |
| prilocaine / chloroprocaine | procaine, lidocaine |
| enoxaparin | heparin (a different drug) |
| protamine | procaine, prominent |
| labetalol | label, "la bella" |
| metoprolol | meteorology, metropole |
| esmolol | "is" + "moll", solo |
| atropine | atrophies, latrine |
| neostigmine | intestine, "nee" + vestige |
| glycopyrrolate | glycoprotein, glyphosate |
| dobutamine | dopamine (a different drug), obtained |
| hydralazine | hydrazine |
| prednisolone | prednisone (a different drug) |
| cefazolin | "sef" + colin |
| clindamycin | clinician |
| piperacillin | penicillin (a different drug class) |
| metronidazole | metronome, letrozole |
| flumazenil | lumenis, influential |
| ondansetron | magnetron |
| sevoflurane | severance, shelburne |
| desflurane | esurance, derange |
| isoflurane | insurance, isoflavone |
| tranexamic acid | "tranquil" and similar, "anemic acid" |

### Your named sound-alike pairs

| Pair | Vocabulary status | Risk |
|---|---|---|
| ropivacaine / bupivacaine / levobupivacaine | all three OOV; lidocaine in vocab | Cannot be told apart by the model. Any of them may come out as lidocaine, procaine or novocaine. High risk. |
| rocuronium / vecuronium | both OOV; pancuronium in vocab | Both likely collapse into one word such as pancuronium, so the two are indistinguishable. High risk. |
| atracurium / cisatracurium | both OOV | Likely non-drug words (atrium, sanitarium); at best the pair is indistinguishable. High risk. |
| dexmedetomidine / dexamethasone | dexamethasone in vocab, dexmedetomidine OOV | A spoken dexmedetomidine will very probably be written as dexamethasone, a different drug. The model cannot output the other word. Highest risk. |
| morphine / hydromorphone | both in vocab | No vocabulary barrier; the confusion risk is acoustic only. Needs audio testing. |
| ketamine / ketorolac | ketamine in vocab, ketorolac OOV | Ketorolac may be written as ketamine or as an unrelated word. High risk. |

Other silent drug swaps from the list above that matter: enoxaparin→heparin, remifentanil/alfentanil/sufentanil→fentanyl,
dobutamine→dopamine, prednisolone→prednisone.

## 4. Digits and abbreviations

- **Terms containing digits: 0.** None of the 477 terms contains a digit, so there is nothing to flag. The model
  emits spoken numbers, so any digits in your sample audio references must be written as words.
- **abbrev: 9 terms, all in vocabulary (0 OOV):** r s i, e c g, n i b p, f i o two, e t c o two, p o n v, t i v a,
  b i s, peep. They are spoken-letter forms and every letter is a valid word. This shows only that the words exist.
  Letter sequences ("t i v a") are often misheard, and "peep" competes with similar words. Audio is needed.
- **unit: 10 terms, 0 OOV.**

## 5. Gate row: terms out of vocabulary

Proposed gate row 5 is pass ≤ 10%, conditional 10–20%, fail > 20% (these criteria are not yet approved).

- All terms: **32.3%, FAIL.**
- Excluding the 11 spelling-only terms: 30.0%, still FAIL.
- Drug names: 54.4%, FAIL.
- Procedure names: 50.0%, FAIL.
- Only the phrase, assessment, abbrev and unit categories are under 10%.

Row 6 (in-vocabulary terms reproduced exactly) is not testable without audio, and the 323 in-vocabulary
terms include unknown acoustic failures.

## What the OOV result does and does not mean

- **No fix without engine changes.** Spoken-form output cannot contain an OOV word. The model will write a real
  English word or word sequence. Post-correction can recover some of these, but it fixes the output only if the
  substitution is predictable. The dexmedetomidine→dexamethasone and rocuronium/vecuronium→pancuronium cases
  are not safe to fix by glossary alone, because the engine output is itself a valid, different drug.
- **Realistic routes if you keep Vosk:**
  - Add the missing words to the model's language model and lexicon. This needs the Vosk dynamic-graph model
    (`vosk-model-en-us-0.22-lgraph`, 124.5 MiB), which supports runtime vocabulary changes, plus pronunciations
    for each term. I have not tested this.
  - Match the output against the glossary by sound (phonetic fuzzy matching), then flag every match for review.
  - Use a larger general model. This does not reliably contain these drug names either, so I would not expect it to fix this.
- **whisper.cpp:** Whisper's subword vocabulary can emit unseen drug names, so it does not have the closed-vocabulary
  limit. Its size and speed costs are in the plan. I have not measured its accuracy on these terms.
