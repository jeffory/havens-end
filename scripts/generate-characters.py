#!/usr/bin/env python3
"""
Generates the duel captains as textured 3D models with Tripo (through the ComfyUI
partner nodes), saving them to art-source/characters/*.glb (gitignored: they're big,
and regenerating costs credits). Turn them into game voxels with
scripts/voxelize-character.py.

Needs COMFY_API_KEY in .env. Usage: .venv/bin/python scripts/generate-characters.py [id ...]
"""
import json
import pathlib
import sys
import time
import uuid

import requests

COMFY = "http://127.0.0.1:8188"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "art-source" / "characters"

# Every prompt asks for the same things the voxelizer relies on: one figure, T-pose,
# empty hands, chunky readable shapes.
STYLE = (
    ", full body, standing straight in a T-pose with both arms held straight out horizontally, "
    "empty open hands, legs slightly apart, facing the viewer, stylized low-poly game character, "
    "chunky proportions, large head, bold simple colors"
)
NEGATIVE = "weapon, sword, pistol, holding anything, cape, base, platform, ground, multiple characters, animal"

CHARACTERS = {
    "player": "young pirate captain, long black coat with brass buttons, red sash around the waist, white shirt, dark brown trousers, tall brown boots, black tricorn hat, dark hair",
    "imperial": "imperial navy officer, crimson red long coat with gold trim and gold epaulettes, white waistcoat, white breeches, black boots, black bicorne hat with gold edging",
    "merchant": "stout merchant ship captain, navy blue coat, cream waistcoat, white shirt, grey trousers, brown shoes, grey beard, blue flat cap",
    "pirate": "fierce pirate captain, dark red bandana, bushy black beard, torn dark red long coat, black leather vest, grey trousers, black boots",
}


def api_key() -> str:
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("COMFY_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("COMFY_API_KEY missing from .env")


def workflow(prompt: str, seed: int) -> dict:
    return {
        "1": {
            "class_type": "TripoTextToModelNode",
            "inputs": {
                "prompt": prompt + STYLE,
                "negative_prompt": NEGATIVE,
                "model_version": "v3.1-20260211",
                "style": "None",
                "texture": True,
                "pbr": False,
                "image_seed": seed,
                "model_seed": seed,
                "texture_seed": seed,
                "texture_quality": "standard",
                "face_limit": 30000,
                "quad": False,
                "geometry_quality": "standard",
            },
        },
        "2": {"class_type": "SaveGLB", "inputs": {"mesh": ["1", 2], "filename_prefix": f"havens-end/character-{seed}"}},
    }


def submit(name: str, key: str) -> str:
    seed = 1000 + list(CHARACTERS).index(name)
    body = {"prompt": workflow(CHARACTERS[name], seed), "client_id": str(uuid.uuid4()), "extra_data": {"api_key_comfy_org": key}}
    response = requests.post(f"{COMFY}/prompt", json=body, timeout=60)
    if response.status_code != 200:
        sys.exit(f"{name}: ComfyUI rejected the workflow: {response.status_code} {response.text[:500]}")
    return response.json()["prompt_id"]


def saved_files(history: dict) -> list[dict]:
    files = []
    for output in history.get("outputs", {}).values():
        for value in output.values():
            if isinstance(value, list):
                files += [f for f in value if isinstance(f, dict) and str(f.get("filename", "")).endswith(".glb")]
    return files


def main() -> None:
    names = sys.argv[1:] or list(CHARACTERS)
    key = api_key()
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = {name: submit(name, key) for name in names}
    print("submitted:", ", ".join(f"{n} ({pid[:8]})" for n, pid in jobs.items()), flush=True)

    deadline = time.time() + 20 * 60
    while jobs and time.time() < deadline:
        time.sleep(10)
        for name, pid in list(jobs.items()):
            entry = requests.get(f"{COMFY}/history/{pid}", timeout=30).json().get(pid)
            if not entry:
                continue
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                messages = [m for m in status.get("messages", []) if m[0] == "execution_error"]
                print(f"{name}: FAILED {json.dumps(messages)[:600]}", flush=True)
                del jobs[name]
                continue
            files = saved_files(entry)
            if not files:
                continue
            f = files[0]
            params = {"filename": f["filename"], "subfolder": f.get("subfolder", ""), "type": f.get("type", "output")}
            data = requests.get(f"{COMFY}/view", params=params, timeout=120).content
            target = OUT / f"{name}.glb"
            target.write_bytes(data)
            print(f"{name}: saved {target.relative_to(ROOT)} ({len(data) // 1024} KB)", flush=True)
            del jobs[name]
    if jobs:
        sys.exit(f"timed out waiting for: {', '.join(jobs)}")


if __name__ == "__main__":
    main()
