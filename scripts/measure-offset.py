"""Measure cached, centred crop alignment; no warping, search restriction or exclusions.

Requires the analysis machine's existing OpenCV and NumPy. Run from any directory:
python scripts/measure-offset.py
"""
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def correlate(pre, post):
    window = cv2.createHanningWindow((pre.shape[1], pre.shape[0]), cv2.CV_32F)
    return cv2.phaseCorrelate(pre.astype(np.float32), post.astype(np.float32), window)


def self_check():
    # Seeded, known translation checks sign and subpixel accuracy of this exact method.
    image = np.random.default_rng(7).random((384, 384)).astype(np.float32)
    shifted = cv2.warpAffine(image, np.float32([[1, 0, 7], [0, 1, -4]]), (384, 384))
    (dx, dy), response = correlate(image, shifted)
    assert abs(dx - 7) < 0.3 and abs(dy + 4) < 0.3 and response > 0.8


def main():
    self_check()
    mission = json.loads((ROOT / "data/missions/nepal-flood-2026.json").read_text())
    buildings = {building["id"]: building for building in mission["buildings"]}
    rows = []
    for gold in mission["gold"]:
        if gold["truth"] != "intact":
            continue
        building = buildings[gold["building_id"]]
        directory = ROOT / "data/cache/crops" / mission["id"] / building["id"]
        pre_path, post_path = directory / "pre.jpg", directory / "post.jpg"
        pre = cv2.imread(str(pre_path), cv2.IMREAD_GRAYSCALE)
        post = cv2.imread(str(post_path), cv2.IMREAD_GRAYSCALE)
        if pre is None or post is None or pre.shape != (384, 384) or post.shape != pre.shape:
            raise ValueError(f"Missing or invalid crops: {building['id']}")
        (dx, dy), response = correlate(pre, post)
        mpp = 156543.03392 * math.cos(math.radians(building["lat"])) / 2**19
        rows.append(dict(building_id=building["id"], dx_px=dx, dy_px=dy,
                         dx_m=dx*mpp, dy_m=dy*mpp, shift_m=math.hypot(dx, dy)*mpp,
                         response=response, metres_per_pixel=mpp,
                         pre_sha256=hashlib.sha256(pre_path.read_bytes()).hexdigest(),
                         post_sha256=hashlib.sha256(post_path.read_bytes()).hexdigest()))
    assert len(rows) == 40, "Expected all 40 intact gold pairs"
    shifts = np.array([row["shift_m"] for row in rows])
    summary = {name: float(np.percentile(shifts, percentile)) for name, percentile in
               [("min_m", 0), ("p10_m", 10), ("q1_m", 25), ("median_m", 50),
                ("q3_m", 75), ("p90_m", 90), ("max_m", 100)]}
    summary.update(n=len(rows), median_dx_m=float(np.median([r["dx_m"] for r in rows])),
                   median_dy_m=float(np.median([r["dy_m"] for r in rows])),
                   median_response=float(np.median([r["response"] for r in rows])),
                   responses_below_0_1=sum(r["response"] < 0.1 for r in rows),
                   caption_rounded_m=math.ceil(summary["median_m"] / 5) * 5)
    report = dict(mission=mission["id"], method="OpenCV phaseCorrelate: grayscale float32, "
                  "384x384 createHanningWindow, normalized cross-power spectrum, "
                  "5x5 peak centroid; no mean subtraction, warping, filtering or exclusions. "
                  "Positive dx/dy moves pre features right/down in post. Magnitude per pair "
                  "converted with its latitude at z19; NumPy linear percentiles.",
                  opencv_version=cv2.__version__, numpy_version=np.__version__,
                  summary=summary, pairs=rows)
    output = ROOT / "reports/overlay/offset-measurement.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
