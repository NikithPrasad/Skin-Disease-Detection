"""Loads the trained EfficientNet-B0 (23 skin-condition groups + healthy skin) and checks an image held in memory.

Images arrive as bytes, are decoded in memory and discarded after prediction; nothing
here writes to disk.
"""
import base64
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
from PIL import Image, ImageOps

from conditions import CONDITIONS

APP = Path(__file__).resolve().parent
IMG = 224  # same preprocessing as training: shorter side to 224, then the central 224x224
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
Image.MAX_IMAGE_PIXELS = 50_000_000  # refuse absurdly large images (decompression bombs)
CLASSES = json.loads((APP / "models" / "meta.json").read_text())["classes"]
assert set(CLASSES) == set(CONDITIONS), "meta.json and conditions.py must list the same groups"


class InvalidImage(Exception):
    pass


def load_image(image_bytes):
    """Decode in memory; shorter side to 224, then the central 224x224, as in training."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(image_bytes)) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")  # phone photos: honour the rotation flag
                w, h = im.size
                s = IMG / min(w, h)
                im = im.resize((max(IMG, round(w * s)), max(IMG, round(h * s))), Image.BICUBIC)
                w, h = im.size
                left, top = (w - IMG) // 2, (h - IMG) // 2
                return im.crop((left, top, left + IMG, top + IMG))
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as e:
        raise InvalidImage(str(e)) from None


def to_input(img):
    """224x224 RGB -> ImageNet normalise (as in training)."""
    x = torch.from_numpy(np.asarray(img).copy()).permute(2, 0, 1).float().div(255).unsqueeze(0)
    return (x - MEAN) / STD


def preprocess(image_bytes):
    return to_input(load_image(image_bytes))


def attention_image(img, cam):
    """Photo with the areas the model ignored dimmed, as an in-memory JPEG data URL."""
    weight = Image.fromarray(np.uint8(cam * 255)).resize(img.size, Image.BICUBIC)
    w = np.asarray(weight, dtype=np.float32)[..., None] / 255
    shown = np.asarray(img, dtype=np.float32) * (0.18 + 0.82 * w)  # dim, never black out, the rest
    buf = io.BytesIO()
    Image.fromarray(np.uint8(shown.clip(0, 255))).save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


class Predictor:
    def __init__(self, device=torch.device("cpu"), models_dir=APP / "models"):
        self.device = device
        self.meta = json.loads((models_dir / "meta.json").read_text())
        self.model = timm.create_model(self.meta["timm_id"], pretrained=False, num_classes=len(CLASSES))
        state = torch.load(models_dir / "model.pt", map_location="cpu", weights_only=True)
        self.model.load_state_dict({k: v.float() if v.is_floating_point() else v for k, v in state.items()})
        self.model.eval().to(device).requires_grad_(False)
        # "Is this a close-up skin photo?" check, see score_photo(): a general ImageNet-trained
        # EfficientNet-B0 that knows everyday objects and scenes, plus a skin-vs-everyday-photo classifier
        self.general = timm.create_model(self.meta["general_timm_id"], pretrained=False, num_classes=0)
        general = torch.load(models_dir / "general.pt", map_location="cpu", weights_only=True)
        self.general.load_state_dict({k: v.float() if v.is_floating_point() else v for k, v in general.items()})
        self.general.eval().to(device).requires_grad_(False)
        ood = np.load(models_dir / "ood.npz")
        self.ood = {k: ood[k] for k in ood.files}
        self.lock = threading.Lock()  # one prediction at a time keeps memory use flat
        with torch.no_grad():  # warm-up so the first real request is not slow
            self.model(torch.zeros(1, 3, IMG, IMG, device=device))

    def predict(self, image_bytes):
        img = load_image(image_bytes)
        x = to_input(img).to(self.device)
        with self.lock:
            t = time.perf_counter()
            # Grad-CAM: run the convolutional part once, then get the gradient of the top class
            # score with respect to its final feature map (only the small classifier head needs
            # a backward pass). Channels whose activation raises the score get more weight.
            with torch.no_grad():
                feats = self.model.forward_features(x)
            feats.requires_grad_(True)
            logits = self.model.forward_head(feats)
            probs = logits.softmax(1)[0].detach().tolist()
            with torch.no_grad():
                fit = self.score_photo(self.general(x)[0].cpu().numpy())
            top = max(range(len(CLASSES)), key=lambda i: probs[i])
            logits[0, top].backward()
            cam = F.relu((feats.grad.mean((2, 3), keepdim=True) * feats).sum(1))[0].detach()
            cam = (cam / cam.max()).cpu().numpy() if cam.max() > 0 else np.ones(cam.shape, np.float32)
            ms = (time.perf_counter() - t) * 1000
        del x, feats
        if fit > self.ood["threshold"]:
            # Too unlike the training photos (e.g. not a close-up skin photo): give no diagnosis
            return {"rejected": True, "ms": round(ms, 1)}
        order = sorted(range(len(CLASSES)), key=lambda i: -probs[i])
        return {
            "rejected": False,
            "top": CLASSES[order[0]],
            "ms": round(ms, 1),
            # Screening flag: melanoma probability above the threshold chosen on validation data
            "melanoma_warning": probs[CLASSES.index("melanoma")] >= self.meta["melanoma_threshold"],
            "probs": [{"code": CLASSES[i], "p": round(probs[i], 4)} for i in order],
            "attention": attention_image(img, cam),
        }

    def score_photo(self, feature):
        """How unlike a photo of skin this is: minus the logit of a small skin-vs-everyday-photo
        classifier on the general model's features. Higher = less like skin. The threshold turns
        away ~0.5% of real validation photos."""
        return float(-(feature @ self.ood["weight"] + self.ood["bias"]))
