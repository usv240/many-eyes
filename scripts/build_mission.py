"""Build data/missions/nepal-flood-2026.json from Copernicus EMSR927 AOI01 grading + OSM buildings.

Usage: python -I build_mission.py <cems_builtUpP.json> <cems_aoi.json> <osm_buildings.json> <out_dir>
"""
import json
import math
import random
import sys
from pathlib import Path

cems_path, aoi_path, osm_path, out_dir = sys.argv[1:5]
out_dir = Path(out_dir)

cems = json.loads(Path(cems_path).read_text(encoding="utf-8"))
aoi = json.loads(Path(aoi_path).read_text(encoding="utf-8"))
osm = json.loads(Path(osm_path).read_text(encoding="utf-8"))


def haversine_m(lon1, lat1, lon2, lat2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def point_in_ring(lon, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def aoi_rings(geojson):
    rings = []
    for f in geojson["features"]:
        g = f["geometry"]
        if g["type"] == "Polygon":
            rings.append(g["coordinates"][0])
        elif g["type"] == "MultiPolygon":
            rings.extend(p[0] for p in g["coordinates"])
    return rings


rings = aoi_rings(aoi)


def in_aoi(lon, lat):
    return any(point_in_ring(lon, lat, r) for r in rings)


affected = []
for i, f in enumerate(cems["features"]):
    lon, lat = f["geometry"]["coordinates"][:2]
    affected.append(
        {
            "id": f"cems-{i:04d}",
            "lon": round(lon, 7),
            "lat": round(lat, 7),
            "expert_grade": f["properties"]["damage_gra"],
            "building_type": f["properties"].get("simplified"),
            "source": "Copernicus EMS EMSR927 AOI01 grading v1 (photo-interpretation, WorldView-3 2026-08-27)",
        }
    )

intact = []
for el in osm["elements"]:
    c = el.get("center")
    if not c:
        continue
    lon, lat = c["lon"], c["lat"]
    if not in_aoi(lon, lat):
        continue
    nearest = min(haversine_m(lon, lat, a["lon"], a["lat"]) for a in affected)
    if nearest > 40:
        intact.append(
            {
                "id": f"osm-w{el['id']}",
                "lon": round(lon, 7),
                "lat": round(lat, 7),
                "expert_grade": "Not affected (inferred)",
                "building_type": el.get("tags", {}).get("building"),
                "nearest_affected_m": round(nearest, 1),
                "source": "OpenStreetMap building inside EMSR927 AOI01, >40 m from any Copernicus-affected point",
            }
        )

rng = random.Random(42)
destroyed = [a for a in affected if a["expert_grade"] == "Destroyed"]
uncertain = [a for a in affected if a["expert_grade"] in ("Damaged", "Possibly damaged")]

gold_destroyed = rng.sample(destroyed, min(40, len(destroyed)))
gold_intact = rng.sample(intact, min(40, len(intact)))
gold = [{"building_id": b["id"], "truth": "destroyed", "source": b["source"]} for b in gold_destroyed] + [
    {"building_id": b["id"], "truth": "intact", "source": b["source"]} for b in gold_intact
]
rng.shuffle(gold)

buildings = sorted(gold_destroyed + gold_intact + uncertain, key=lambda b: b["id"])

lons = [b["lon"] for b in buildings]
lats = [b["lat"] for b in buildings]

mission = {
    "id": "nepal-flood-2026",
    "name": "Nepal flash flood, Syaphru Besi (Rasuwa), 26 Aug 2026",
    "event_date": "2026-08-26",
    "bbox": [min(lons), min(lats), max(lons), max(lats)],
    "aoi": rings,
    "pre_scene": {
        "title": "[PRE] Vantor GE01 Image 10500100364E8400",
        "acquired": "2023-09-17",
        "gsd_m": 0.47,
        "tms": "https://tiles.openaerialmap.org/6a908044d8f7b27f667344de/0/6a908044d8f7b27f667344df/{z}/{x}/{y}",
        "license": "CC BY-NC 4.0",
    },
    "post_scene": {
        "title": "[POST] Vantor WV03 Image B040001100882F10",
        "acquired": "2026-08-27",
        "gsd_m": 0.35,
        "tms": "https://tiles.openaerialmap.org/6a908a9bd8f7b27f66735576/0/6a908a9bd8f7b27f66735577/{z}/{x}/{y}",
        "license": "CC BY-NC 4.0",
    },
    "fallback_pre_scene": {
        "title": "[PRE] Vantor WV02 Image 10300100C86CED00",
        "acquired": "2021-10-16",
        "gsd_m": 0.59,
        "tms": "https://tiles.openaerialmap.org/6a90bc90d8f7b27f66738feb/0/6a90bc90d8f7b27f66738fec/{z}/{x}/{y}",
        "license": "CC BY-NC 4.0",
    },
    "fallback_post_scene": {
        "title": "[POST] Vantor WV03 Image B040001100881610",
        "acquired": "2026-08-27",
        "gsd_m": 0.35,
        "tms": "https://tiles.openaerialmap.org/6a90bbb4d8f7b27f66738e51/0/6a90bbb4d8f7b27f66738e52/{z}/{x}/{y}",
        "license": "CC BY-NC 4.0",
    },
    "attribution": "Imagery: Vantor via OpenAerialMap, CC BY-NC 4.0. Damage grading: © European Union, Copernicus Emergency Management Service (EMSR927). Buildings: © OpenStreetMap contributors, ODbL.",
    "counts": {
        "copernicus_affected_total": len(affected),
        "copernicus_destroyed": len(destroyed),
        "copernicus_damaged": sum(1 for a in affected if a["expert_grade"] == "Damaged"),
        "copernicus_possibly_damaged": sum(1 for a in affected if a["expert_grade"] == "Possibly damaged"),
        "osm_intact_candidates": len(intact),
        "gold_destroyed": len(gold_destroyed),
        "gold_intact": len(gold_intact),
        "work_queue_uncertain": len(uncertain),
    },
    "notes": [
        "Gold 'destroyed' = Copernicus expert grade Destroyed.",
        "Gold 'intact' is inferred: OSM building inside the graded AOI with no Copernicus affected point within 40 m. Copernicus graded the whole AOI, so absence of a grade implies no visible damage; disclose this as a measured limit.",
        "Work queue = buildings Copernicus graded Damaged or Possibly damaged: the cases where experts were least certain.",
        "Imagery tiles redirect (HTTP 302) to titiler.hotosm.org; follow redirects. z=18 tiles verified to render on 2026-10-30.",
    ],
    "buildings": buildings,
    "gold": gold,
}

(out_dir / "missions").mkdir(parents=True, exist_ok=True)
(out_dir / "missions" / "nepal-flood-2026.json").write_text(json.dumps(mission, indent=2), encoding="utf-8")
print(json.dumps(mission["counts"], indent=2))
print("buildings:", len(buildings), "gold:", len(gold))
