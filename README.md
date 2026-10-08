# SkinCheck: skin concern awareness

A calm, simple local website that helps people understand a skin concern. Upload a close-up image of a
skin spot and an **EfficientNet-B0** model (trained on the HAM10000 dataset) gives an AI-based indication
of what it most closely matches, out of 7 types of skin spots or healthy skin, explained in plain
language with practical next steps. Runs on any laptop: no GPU, no internet, no API key.

**This is an awareness tool, not a medical diagnosis.** It never tells anyone they have a disease, and it
never decides for them whether to see a doctor.

**Images are never saved.** Each upload is analysed in memory on the same computer and discarded straight
after; nothing is written to disk, stored in a database or sent anywhere.

The model was chosen from a fair comparison of four architectures:
[Skin-Disease-Model-Comparison](https://github.com/NikithPrasad/Skin-Disease-Model-Comparison).

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

0. **Image check first**: if the image doesn't look like a close-up of skin (a normal snapshot, a face, an
   object), the site says so and gives no result instead of guessing.
1. **"Your image most closely matches: ..."** with a confidence level in words (high, moderate, low).
2. **What this means**: a short plain-language explanation of that type of skin spot.
3. **What to do next**: for types that can need treatment, for the melanoma check, or when the AI is
   unsure, *"Consider discussing this result with a qualified healthcare professional"* (soft blue box);
   otherwise *"This result appears less concerning, but changes in a skin lesion should still be
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
