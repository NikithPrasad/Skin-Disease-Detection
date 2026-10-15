# SkinCheck: skin concern awareness

A calm, simple local website that helps people understand a skin concern. Upload an ordinary photo of
skin, nails or scalp and an **EfficientNet-B0** model gives an AI-based indication of which of
**23 groups of common skin, hair and nail conditions** (or healthy skin) it most closely matches,
explained in plain language with practical next steps. Runs on any laptop with no GPU, no internet
and no API key; an optional second opinion from Google Gemini can be switched on per photo.

**This is an awareness tool, not a medical diagnosis.** It never tells anyone they have a disease, and it
never decides for them whether to see a doctor.

**Images are never saved.** Each upload is analysed in memory on the same computer and discarded straight
after; nothing is written to disk or stored in a database. Nothing is sent anywhere unless the person
ticks the optional Gemini second opinion for that photo (see below).

The model was chosen from a fair comparison of four architectures:
[Skin-Disease-Model-Comparison](https://github.com/NikithPrasad/Skin-Disease-Model-Comparison).

## What it recognises

The groups were chosen to cover the example photos our teacher shared (everyday clinical photos of
leprosy, pellagra, acne, ringworm, shingles, vitiligo, nail and hair problems, moles, melanoma and more):

| Group | Includes, for example | Teacher's examples in this group |
|---|---|---|
| Acne, rosacea and clogged pores | acne, truncal acne, blackheads, rosacea | trunkal acne, sebaceous gland clogging, topical steroid abuse |
| Bacterial skin infection | impetigo, folliculitis, cellulitis | impetigo contagiosa |
| Blistering skin disease | pemphigus, pemphigoid, Hailey-Hailey | pemphigus |
| Eczema and dermatitis | eczema, contact / seborrhoeic / stasis dermatitis | peri-orbital dermatitis, stasis dermatitis |
| Fungal infection (ringworm) | tinea corporis / faciei, athlete's foot | tinea corporis, tinea faciei |
| Granulomatous skin disease | granuloma annulare, sarcoidosis | chronic granuloma |
| Hair loss | pattern balding, alopecia areata, hair pulling | androgenic alopecia, trichotillomania |
| Herpes, shingles and chickenpox | cold sores, shingles, chickenpox | herpes simplex, herpes zoster |
| Leprosy (Hansen's disease) | tuberculoid, borderline, lepromatous | nodular / histoid leprosy |
| Sun-related and pigment changes | vitiligo, sun allergy, sun damage | lip vitiligo, UV-ray allergy |
| Lupus and connective-tissue disease | lupus, scleroderma, dermatomyositis | |
| Melanoma | melanoma, lentigo maligna | melanoma, malignant melanoma |
| Mole or birthmark | moles, congenital / Becker's nevus | clear cell nevus, congenital nevus, giant mole, nevus of Ota |
| Nail condition | fungal nail, claw nail, dystrophy, paronychia | claw nail, nail dystrophy |
| Psoriasis, lichen planus and similar | psoriasis, lichen planus, pityriasis rosea | oral lichen planus |
| Scabies, bites and infestations | scabies, insect-bite reactions, lice | papular urticaria (mosquito-bite allergy) |
| Skin cancer or pre-cancer | basal / squamous cell carcinoma, actinic keratosis | |
| Benign growth, cyst or scar | skin tags, syringoma, cysts, keloid | giant acrochordon, syringoma, trichoblastoma, mucinous cyst, hypertrophic scar |
| Nutritional or systemic disease signs | pellagra, zinc deficiency, acanthosis nigricans | pellagra |
| Hives (urticaria) | acute urticaria | acute urticaria |
| Vascular lesion | cherry angioma, pyogenic granuloma, port-wine stain | |
| Drug reaction, viral rash or vasculitis | drug eruptions, measles, HFMD, vasculitis | |
| Warts and molluscum | warts, molluscum contagiosum | |
| Healthy skin | | |

Two of the teacher's examples have no matching training data in any public dataset we found: a foot
callus, and a few uncaptioned photos that were only identifiable as "a rash". The model will still give
its closest group for them.

Each result shows the closest group, the top answers with their percentages, what the group means,
how it is usually managed and what the person can do now.

## Optional second opinion from Google Gemini

Each check can also ask **Google Gemini** (a general AI that can read images). It is **off unless the
person ticks the box for that photo**, because the photo is then sent over the internet to Google (Google's
terms apply). Photos the photo check turns away are never sent. Gemini is asked independently (it is not
told the model's answer) and must reply in a fixed format: one of the same 24 groups, the most likely
specific condition, a plain-language description, how harmful it usually is, and its confidence.

The person sees **one combined answer** with **one estimated-accuracy figure**, not two competing opinions.
Measured on 72 test photos (3 per group) the AI never trained on, with `gemini-flash-lite-latest`:

| | Right answer |
|---|---|
| SkinCheck model alone | 71% |
| Gemini alone | 47% |
| Combined (model + 0.1 x Gemini's confidence on its group; weight chosen on 72 validation photos) | 69% |
| Combined answer when both point to the same group (half of the photos) | 86% |
| Combined answer when they point to different groups | 53% |

So Gemini does not make the answer more accurate on its own: the specialised model is better at these 24
groups (the full Gemini Flash scored similarly, 8 of 17 photos, before its free daily limit of 20 requests
ran out). What it adds is a reliable sign of how much to trust each answer (the "estimated accuracy"
shown with the result), the name of the most likely specific condition and a description of the photo.
Without Gemini, the estimated accuracy comes from the model's own confidence, measured on validation
photos (top answer right 90% of the time at 50%+, 53% at 30 to 50%, 30% below 30%).

**Harmfulness**: every result shows how harmful the condition usually is on a 4-step scale (harmless,
mild, moderate, serious) with a one-line reason; if Gemini rates the photo as more serious than usual for
that group, the more serious rating is shown.

**The API key** is never in this repository: `setup.bat` asks for it once and saves it in
`app/data/gemini_api_key.txt` (excluded from git; a test checks this), or set the `GEMINI_API_KEY`
environment variable. Without a key the site works exactly as before, with the Gemini box hidden.
Evaluation script: `src/gemini_eval.py` in the comparison project.

## Design

Designed for people who may already be worried, including older adults and non-technical users:

- **Light and calm**: soft neutral background, white cards, one teal-green accent; no red screens.
  All text meets WCAG AA contrast (body text 13:1); 18px text and 52px+ buttons.
- **Four clear steps**, shown as a progress bar: Upload, AI analysis, Your result, What to do next.
  While the image is analysed, the page says what is happening.
- **No medical imagery**: the interface shows no images of skin conditions. Example images are offered by
  name only, and the "where the AI looked" view is folded away until the user asks for it.
- **Reassurance built in**: "You're in control", "Results in simple language", "Your privacy matters",
  "One piece of information", plus an exact, honest privacy section.

## What a result shows

0. **Image check first**: if the image doesn't look like a photo of skin (a landscape, an object, a
   screenshot), the site says so and gives no result instead of guessing.
1. **"Your image most closely matches: ..."** with a confidence level in words (high, moderate, low).
2. **What this means**: a short plain-language explanation of that group and the conditions it includes.
3. **What to do next**: for groups that usually need a doctor's treatment, for the melanoma check, or when the AI is
   unsure, *"Consider discussing this result with a qualified healthcare professional"* (soft blue box);
   otherwise *"This result appears less concerning, but changes in your skin should still be
   monitored"* (soft green box). Both include practical steps, plus how it is usually managed.
4. **When to talk to a doctor**: signs worth discussing whatever the result.
5. Optional, folded away: where in the image the AI looked (Grad-CAM) and all possibilities.

Photos: Ato Aikins, Sarah Sheedy, Asal Davletyarovaasss and Nate Johnston on [Unsplash](https://unsplash.com) (Unsplash License).

Every result ends with: *"This is an AI-based prediction, not a medical diagnosis."* The guidance is
general information only (no medicines are named).

## Run it

**Windows**
1. Install Python 3.10+ from python.org (tick "Add python.exe to PATH").
2. Double-click `setup.bat` once (downloads CPU-only PyTorch, about 200 MB).
3. Double-click `run.bat`. The website opens at http://localhost:8000.

**Mac / Linux**
```
python3 -m venv .venv && source .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r app/requirements.txt
python app/server.py
```

After setup it works offline. Create an account on the page, then upload a photo or click a sample.

## How accurate is it

<!-- numbers:start -->
Measured on 5,308 test photos the model never saw in training (no duplicate or same-patient
photo was in both), using exactly the weights shipped here (seed 0 of 1 training runs,
chosen by validation score). Dataset: 24,792 training / 5,310 validation / 5,308 test photos.

| | Test set |
|---|---|
| Accuracy (closest group is right) | 65% |
| Right group among the top 3 answers | 79% |
| Macro F1 (every group counts equally) | 0.631 |
| Balanced accuracy | 0.647 |
| Macro ROC-AUC | 0.937 |
| Skin conditions wrongly called healthy skin | 0.3% |
| Healthy skin wrongly given a condition | 0.8% |

Correct answers by group (recall):

| Group | Test set |
|---|---|
| Acne, rosacea and clogged pores | 79% |
| Bacterial skin infection | 69% |
| Blistering skin disease | 51% |
| Eczema and dermatitis | 62% |
| Fungal infection (ringworm) | 66% |
| Granulomatous skin disease | 46% |
| Hair loss | 81% |
| Healthy skin | 99% |
| Herpes, shingles and chickenpox | 73% |
| Leprosy (Hansen's disease) | 82% |
| Sun-related and pigment changes | 44% |
| Lupus and connective-tissue disease | 39% |
| Melanoma | 62% |
| Mole or birthmark | 70% |
| Nail condition | 93% |
| Psoriasis, lichen planus and similar | 57% |
| Scabies, bites and infestations | 58% |
| Skin cancer or pre-cancer | 70% |
| Benign growth, cyst or scar | 67% |
| Nutritional or systemic disease signs | 45% |
| Hives (urticaria) | 60% |
| Vascular lesion | 64% |
| Drug reaction, viral rash or vasculitis | 49% |
| Warts and molluscum | 69% |

Accuracy by source collection:

| Source | Accuracy |
|---|---|
| Atlas (31 classes) | 84% |
| DermNet | 62% |
| Fitzpatrick17k | 56% |
| Skin-infection set | 92% |
| MSLD (healthy + rashes) | 73% |
| Normal skin types | 100% |

### The melanoma warning

The top answer alone names 62% of melanomas. The site also flags a photo whenever
the melanoma probability is 7.5% or more (threshold picked on validation data to catch
at least 80% of validation melanomas): that catches 78% of test melanomas, and
1.9% of other photos also get the flag, to be safe.

### The photo check

Before any result, a general ImageNet-trained EfficientNet-B0 (it knows everyday objects and scenes)
describes the photo, and a small classifier trained on skin photos versus 6,000 everyday non-skin photos
decides whether it is a photo of skin. If not, the site says "this doesn't look like a photo of skin" and
gives no result. Threshold: keep 99.5% of validation skin photos.

| | Turned away |
|---|---|
| Real test photos | 0.5% |
| Healthy-face test photos | 1.4% |
| Everyday non-skin photos held out from fitting (1,500 objects, animals, landscapes, streets) | 100% |
| Non-skin images (45 built-in Windows wallpapers and images (landscapes, abstract art), never used for fitting) | 100% |
<!-- numbers:end -->

## Accounts and privacy

- Photos are processed in memory only. `tests/test_app.py` uploads a photo carrying a unique marker
  and scans the app folder and system temp folder to prove no copy is written.
- The database (`app/data/users.db`, not in git) holds only usernames, salted scrypt password hashes and
  hashed session tokens; it has no column that could hold an image.
- 5 failed logins lock an account for 5 minutes; cookies are `HttpOnly` + `SameSite=Strict`; every POST
  needs a custom header (blocks cross-site request forgery); a strict Content-Security-Policy blocks
  injected scripts; the server only accepts connections from the same computer.

## Tests

```
python -m unittest discover -s tests -v
```

## Files

```
app/server.py       web server (routes, cookies, security headers)
app/auth.py         accounts and sessions (SQLite)
app/predictor.py    photo check, classification of an in-memory image, Grad-CAM, melanoma warning
app/conditions.py   plain-language information, harmfulness and next steps for each of the 24 groups
app/gemini.py       optional Gemini second opinion (standard-library HTTPS call) and the combination rule
app/models/         model.pt (24-group EfficientNet-B0, float16), general.pt (ImageNet EfficientNet-B0 for
                    the photo check), ood.npz (photo-check statistics), meta.json (scores, thresholds)
app/static/         the web page, sample photos, confusion matrix
tests/              automated tests
```

The dataset is built with `src/clinical_prepare.py`, the models are trained with
`src/clinical_run_all.py`, and the chosen model and its scores are exported with
`src/export_clinical_model.py`, all in the comparison project.

## Limits

- It knows 23 broad groups and healthy skin, nothing else, and only says which group a photo looks most
  like. Many skin conditions look alike, so the top answers together are more informative than the first.
- Most training photos come from medical image libraries and textbooks (DermNet, Fitzpatrick17k, a
  dermatology atlas); everyday phone photos, poor light or unusual angles can be harder.
- The healthy-skin examples are mostly stock photos of faces and close-ups of normal skin.
- This is a student project for education, **not a medical device**: anyone worried about their skin
  should see a doctor.

Data: DermNet (Kaggle `shubhamgoel27/dermnet`), Fitzpatrick17k (Groh et al., 2021), "31 classes of skin
disease" (Kaggle `kelixo25`, atlas + ISIC 2019 images, incl. leprosy), Skin-Disease-Dataset (Kaggle
`subirbiswas19`), MSLD v2.0 (Kaggle `joydippaul`) and Oily/Dry/Normal skin types (Kaggle
`shakyadissanayake`). These datasets are for research and education.
