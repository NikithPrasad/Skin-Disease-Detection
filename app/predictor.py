"""Loads the trained EfficientNet-B0 and classifies an image held in memory.

Images arrive as bytes, are decoded in memory and discarded after prediction; nothing
here writes to disk.
"""
import io
import json
import threading
import time
import warnings
from pathlib import Path

import numpy as np
import timm
import torch
import torch.nn.functional as F
from PIL import Image

APP = Path(__file__).resolve().parent
CLASSES = ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]
CACHE_SIZE, IMG = 256, 224  # same preprocessing as training
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
Image.MAX_IMAGE_PIXELS = 50_000_000  # refuse absurdly large images (decompression bombs)

CLASS_INFO = {
    "akiec": ("Actinic keratosis", "Rough, scaly patch from sun damage. Pre-cancerous and can turn into skin cancer."),
    "bcc": ("Basal cell carcinoma", "The most common skin cancer. Grows slowly and rarely spreads, but needs treatment."),
    "bkl": ("Benign keratosis", "Harmless growth such as a seborrheic keratosis or sun spot."),
    "df": ("Dermatofibroma", "Harmless firm bump in the skin, often on the legs."),
    "mel": ("Melanoma", "The most dangerous skin cancer. Early detection matters a lot."),
    "nv": ("Melanocytic nevus", "An ordinary mole. Almost always harmless."),
    "vasc": ("Vascular lesion", "Growth made of blood vessels, such as a cherry angioma. Usually harmless."),
}
SERIOUS = {"mel", "bcc", "akiec"}


class InvalidImage(Exception):
    pass


def preprocess(image_bytes):
    """RGB -> 256x256 bicubic -> 224x224 antialiased -> ImageNet normalise (as in training)."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(image_bytes)) as im:
                img = im.convert("RGB").resize((CACHE_SIZE, CACHE_SIZE), Image.BICUBIC)
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as e:
        raise InvalidImage(str(e)) from None
    x = torch.from_numpy(np.asarray(img).copy()).permute(2, 0, 1).float().div(255).unsqueeze(0)
    x = F.interpolate(x, size=(IMG, IMG), mode="bilinear", antialias=True, align_corners=False)
    return (x - MEAN) / STD


class Predictor:
    def __init__(self, device=torch.device("cpu"), models_dir=APP / "models"):
        self.device = device
        self.meta = json.loads((models_dir / "meta.json").read_text())
        self.model = timm.create_model(self.meta["timm_id"], pretrained=False, num_classes=len(CLASSES))
        state = torch.load(models_dir / "model.pt", map_location="cpu", weights_only=True)
        self.model.load_state_dict({k: v.float() if v.is_floating_point() else v for k, v in state.items()})
        self.model.eval().to(device)
        self.lock = threading.Lock()  # one prediction at a time keeps memory use flat
        with torch.no_grad():  # warm-up so the first real request is not slow
            self.model(torch.zeros(1, 3, IMG, IMG, device=device))

    @torch.no_grad()
    def predict(self, image_bytes):
        x = preprocess(image_bytes).to(self.device)
        with self.lock:
            t = time.perf_counter()
            probs = self.model(x).softmax(1)[0].tolist()
            ms = (time.perf_counter() - t) * 1000
        del x
        order = sorted(range(len(CLASSES)), key=lambda i: -probs[i])
        return {
            "top": CLASSES[order[0]],
            "ms": round(ms, 1),
            # Screening flag: melanoma probability above the threshold chosen on validation data
            "melanoma_warning": probs[CLASSES.index("mel")] >= self.meta["melanoma_threshold"],
            "probs": [{"code": CLASSES[i], "p": round(probs[i], 4)} for i in order],
        }
