# Skin Disease Detection

A local website that looks at a dermoscopy photo of a skin lesion and suggests which of 7 lesion
types it shows, using an **EfficientNet-B0** model trained on the HAM10000 dataset. It also warns
when melanoma can't be ruled out. Runs on any laptop: no GPU, no internet, no API key.

**Photos are never saved.** Each upload is checked in memory and discarded straight after; nothing is
written to disk, stored in a database or sent anywhere.

The model was chosen from a fair comparison of four architectures:
[Skin-Disease-Model-Comparison](https://github.com/NikithPrasad/Skin-Disease-Model-Comparison).

## What a result shows

1. **This might be...**: the most likely of 7 lesion types, in plain words, with how sure the model is.
2. **What the model is looking at**: the photo with the areas the model ignored dimmed (Grad-CAM), next to
   what that condition usually looks like. If the bright area is not on the spot, the answer is less trustworthy.
3. **What to do**: how it is usually treated and what you can do now. Serious results (melanoma, the melanoma
   warning, or an unsure model) say to see a doctor; harmless ones give self-care steps.
4. **See a doctor straight away if...**: warning signs shown with every result.

The advice is general information only (no medicines are named) and is not a diagnosis.

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

Measured on photos the model never saw in training, using exactly the weights shipped here.

| | HAM10000 test (2,004 photos, split by lesion) | ISIC 2018 test (1,511 photos, separate collection) |
|---|---|---|
| Macro F1 | 0.722 | 0.711 |
| Balanced accuracy | 0.736 | 0.706 |
| Accuracy | 0.848 | 0.817 |
| Macro ROC-AUC | 0.941 | 0.928 |

Correct answers by lesion type (recall):

| Lesion type | HAM10000 test | ISIC 2018 test |
|---|---|---|
| Actinic keratosis | 77% | 67% |
| Basal cell carcinoma | 79% | 72% |
| Benign keratosis | 72% | 70% |
| Dermatofibroma | 70% | 68% |
| Melanoma | 51% | 56% |
| Melanocytic nevus (mole) | 94% | 92% |
| Vascular lesion | 72% | 69% |

### The melanoma warning

On its own the model names only 51% of melanomas as its top answer. Missing a melanoma
is far worse than an unnecessary check-up, so the site also warns whenever the melanoma probability is
5.3% or more. That threshold was picked on the separate validation set (to catch at least
80% of melanomas there), then checked on the test sets:

| | HAM10000 test | ISIC 2018 test |
|---|---|---|
| Melanomas caught by the top answer | 51% | 56% |
| Melanomas caught with the warning | 77% | 87% |
| Other lesions that also get a warning | 17% | 22% |

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
app/predictor.py    loads the model, classifies an in-memory image, melanoma warning
app/models/         model.pt (EfficientNet-B0, float16, 8.2 MB) and meta.json (scores, threshold)
app/static/         the web page, sample photos, confusion matrix
tests/              automated tests
```

The model and its scores are exported from the comparison project with `src/export_single_model.py`.

## Limits

Trained on dermoscopy photos (taken through a skin magnifier), so ordinary phone photos will be less
reliable. It only knows 7 lesion types. This is a student project for education, **not a medical
device**: anyone worried about a skin lesion should see a doctor.

Data: HAM10000 (Tschandl et al., 2018, CC BY-NC 4.0) and the ISIC 2018 Task 3 test set.
