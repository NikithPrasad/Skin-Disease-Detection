# Skin Disease Detection

A local website that looks at a dermoscopy photo of skin and suggests which of 7 lesion types it
shows, or that it is healthy skin, using an **EfficientNet-B0** model trained on the HAM10000 dataset. It also warns
when melanoma can't be ruled out. Runs on any laptop: no GPU, no internet, no API key.

**Photos are never saved.** Each upload is checked in memory and discarded straight after; nothing is
written to disk, stored in a database or sent anywhere.

The model was chosen from a fair comparison of four architectures:
[Skin-Disease-Model-Comparison](https://github.com/NikithPrasad/Skin-Disease-Model-Comparison).

## What a result shows

0. **Photo check first**: if the photo doesn't look like a close-up skin photo (a normal snapshot, a
   face, an object), the site says so and gives no diagnosis instead of guessing.
1. **This might be...**: the most likely of 7 lesion types, or healthy skin, in plain words, with how
   sure the model is.
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

<!-- numbers:start -->
Measured on photos the model never saw in training, using exactly the weights shipped here
(seed 1 of 2 training runs, chosen by validation score).

| | HAM10000 test (lesions + healthy-skin patches, split by lesion) | ISIC 2018 test (1,511 lesion photos, separate collection) |
|---|---|---|
| Macro F1 | 0.751 | 0.721 |
| Balanced accuracy | 0.750 | 0.708 |
| Accuracy | 0.888 | 0.825 |
| Lesions wrongly called healthy skin | 0.1% | 0% |

Correct answers by type (recall):

| Type | HAM10000 test | ISIC 2018 test |
|---|---|---|
| Actinic keratosis | 62% | 67% |
| Basal cell carcinoma | 79% | 75% |
| Benign keratosis | 74% | 68% |
| Dermatofibroma | 65% | 66% |
| Melanoma | 54% | 60% |
| Melanocytic nevus (mole) | 94% | 93% |
| Vascular lesion | 72% | 66% |
| Healthy skin | 99% | not in this set |

Healthy-skin examples are patches cut from around the lesions in HAM10000 photos (using the dataset's lesion
outlines), so they are dermoscopy close-ups too. The healthy score above is therefore optimistic for other
kinds of photos; those are handled by the photo check below.

### The melanoma warning

The top answer alone names 54% of melanomas. The site also warns whenever the melanoma
probability is 5.1% or more (threshold picked on validation data to catch at least
80% of validation melanomas):

| | HAM10000 test | ISIC 2018 test |
|---|---|---|
| Melanomas caught by the top answer | 54% | 60% |
| Melanomas caught with the warning | 82% | 85% |
| Other photos that also get a warning | 11% | 20% |

### The photo check

Before any diagnosis, the photo is compared with the training photos using a general ImageNet-trained
EfficientNet-B0 (it knows everyday objects and scenes). Photos too unlike the training photos get
"this doesn't look like a close-up skin photo" and no diagnosis. Threshold: keep 99.5% of validation photos.

| | Rejected |
|---|---|
| Real HAM10000 test lesion photos | 0.5% |
| Healthy-skin test patches | 0% |
| ISIC 2018 photos (separate collection) | 1.2% |
| Non-skin images (45 built-in Windows wallpapers and images (landscapes, abstract art)) | 100% |

The skin model's own features could not tell skin from non-skin (at most 58% of the non-skin images
rejected; see `src/ood_experiment.py` in the comparison repo), which is why a general model is used.
Ordinary phone photos of skin have not been tested, because no such labelled set was available.
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
app/models/         model.pt (8-class EfficientNet-B0, float16), general.pt (ImageNet EfficientNet-B0 for
                    the photo check), ood.npz (photo-check statistics), meta.json (scores, thresholds)
app/static/         the web page, sample photos, confusion matrix
tests/              automated tests
```

The model and its scores are exported from the comparison project with `src/export_single_model.py`.

## Limits

Trained only on dermoscopy photos (taken through a skin magnifier), including its healthy-skin
examples. Ordinary phone photos are usually turned away by the photo check rather than diagnosed, and
have not been formally tested. It knows 7 lesion types and healthy skin, nothing else. This is a student
project for education, **not a medical device**: anyone worried about a skin lesion should see a doctor.

Data: HAM10000 (Tschandl et al., 2018, CC BY-NC 4.0) and the ISIC 2018 Task 3 test set.
