import argparse
import json
import math
import os
import re
import struct
import sys

REQUIRED_LOCATOR_NAMES = [
    "Locator_Front_Left",
    "Locator_Front_Right",
    "Locator_Rear_Left",
    "Locator_Rear_Right",
    "Locator_Steering",
    "Locator_Door_Hinge",
    "Locator_Seat",
    "Locator_Door_Spot",
]

WINDOW_PATTERN = re.compile(r"windshield|window(_driver|_passenger|_top)?|glass", re.I)
DOOR_PATTERN = re.compile(r"(driver.*door|door.*driver|^door$)", re.I)
STEERING_WHEEL_PATTERN = re.compile(r"steering[_ ]wheel|wheel.*steering", re.I)
INTERIOR_PATTERN = re.compile(r"interior", re.I)
SEAT_PATTERN = re.compile(r"seat", re.I)
TIRE_PATTERN = re.compile(r"(tire|wheel|rim)", re.I)
EXCLUDE_STEERING_PATTERN = re.compile(r"steering", re.I)


def parse_args(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(argv)


def read_glb(file_path):
    with open(file_path, "rb") as handle:
        payload = handle.read()

    magic, version, total_length = struct.unpack_from("<III", payload, 0)
    if magic != 0x46546C67:
        raise ValueError(f"Invalid GLB magic in {file_path}")
    if version != 2:
        raise ValueError(f"Unsupported GLB version {version} in {file_path}")

    offset = 12
    json_chunk = None
    bin_chunk = b""

    while offset < total_length:
      chunk_length, chunk_type = struct.unpack_from("<II", payload, offset)
      offset += 8
      chunk_data = payload[offset:offset + chunk_length]
      offset += chunk_length
      if chunk_type == 0x4E4F534A:
          json_chunk = json.loads(chunk_data.decode("utf8"))
      elif chunk_type == 0x004E4942:
          bin_chunk = chunk_data

    if json_chunk is None:
        raise ValueError(f"Missing JSON chunk in {file_path}")

    return json_chunk, bin_chunk


def write_glb(file_path, gltf, bin_chunk):
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf8")
    json_padding = (4 - (len(json_bytes) % 4)) % 4
    json_bytes += b" " * json_padding

    bin_padding = (4 - (len(bin_chunk) % 4)) % 4
    bin_bytes = bin_chunk + (b"\x00" * bin_padding)

    total_length = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)

    with open(file_path, "wb") as handle:
        handle.write(struct.pack("<III", 0x46546C67, 2, total_length))
        handle.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        handle.write(json_bytes)
        handle.write(struct.pack("<II", len(bin_bytes), 0x004E4942))
        handle.write(bin_bytes)


def node_name(node):
    return str(node.get("name", ""))


def translation_of(node):
    value = node.get("translation")
    if isinstance(value, list) and len(value) == 3:
        return [float(value[0]), float(value[1]), float(value[2])]
    return [0.0, 0.0, 0.0]


def collect_named_nodes(gltf, pattern, exclude=None):
    matches = []
    for index, node in enumerate(gltf.get("nodes", [])):
        name = node_name(node)
        if not name:
            continue
        if exclude and exclude.search(name):
            continue
        if pattern.search(name):
            matches.append({
                "index": index,
                "name": name,
                "translation": translation_of(node),
            })
    return matches


def create_reference_template(gltf):
    locators = {}
    for node in gltf.get("nodes", []):
        name = node_name(node)
        if name in REQUIRED_LOCATOR_NAMES:
            locators[name] = translation_of(node)
    return {
        "locators": locators
    }


def average_positions(positions):
    if not positions:
        return [0.0, 0.0, 0.0]
    count = float(len(positions))
    return [
        sum(position[0] for position in positions) / count,
        sum(position[1] for position in positions) / count,
        sum(position[2] for position in positions) / count,
    ]


def infer_positions(gltf, reference_template):
    tires = collect_named_nodes(gltf, TIRE_PATTERN, exclude=EXCLUDE_STEERING_PATTERN)
    tires.sort(key=lambda entry: (-entry["translation"][2], entry["translation"][0]))

    steering = collect_named_nodes(gltf, STEERING_WHEEL_PATTERN)
    seats = collect_named_nodes(gltf, SEAT_PATTERN)
    interiors = collect_named_nodes(gltf, INTERIOR_PATTERN)
    doors = collect_named_nodes(gltf, DOOR_PATTERN)

    inferred = {}

    if len(tires) >= 4:
        front_pair = sorted(tires[:2], key=lambda entry: entry["translation"][0])
        rear_pair = sorted(tires[2:4], key=lambda entry: entry["translation"][0])
        inferred["Locator_Front_Left"] = front_pair[0]["translation"][:]
        inferred["Locator_Front_Right"] = front_pair[1]["translation"][:]
        inferred["Locator_Rear_Left"] = rear_pair[0]["translation"][:]
        inferred["Locator_Rear_Right"] = rear_pair[1]["translation"][:]

    if steering:
        inferred["Locator_Steering"] = steering[0]["translation"][:]

    if seats:
        inferred["Locator_Seat"] = seats[0]["translation"][:]
    elif interiors:
        inferred["Locator_Seat"] = interiors[0]["translation"][:]

    if doors:
        door_pos = doors[0]["translation"][:]
        side_sign = -1.0 if door_pos[0] < 0 else 1.0
        inferred["Locator_Door_Hinge"] = [
            door_pos[0] + side_sign * 0.18,
            door_pos[1] + 0.12,
            door_pos[2] + 0.12,
        ]
        inferred["Locator_Door_Spot"] = [
            door_pos[0] + side_sign * 0.36,
            door_pos[1],
            door_pos[2] - 0.1,
        ]

    center = average_positions([
        inferred[name]
        for name in ["Locator_Front_Left", "Locator_Front_Right", "Locator_Rear_Left", "Locator_Rear_Right"]
        if name in inferred
    ])

    if "Locator_Seat" not in inferred and "Locator_Seat" in reference_template["locators"]:
        seat_ref = reference_template["locators"]["Locator_Seat"]
        inferred["Locator_Seat"] = [
            center[0] + seat_ref[0],
            center[1] + seat_ref[1],
            center[2] + seat_ref[2],
        ]

    if "Locator_Steering" not in inferred and "Locator_Steering" in reference_template["locators"]:
        steer_ref = reference_template["locators"]["Locator_Steering"]
        inferred["Locator_Steering"] = [
            center[0] + steer_ref[0],
            center[1] + steer_ref[1],
            center[2] + steer_ref[2],
        ]

    if "Locator_Door_Hinge" not in inferred and "Locator_Door_Hinge" in reference_template["locators"]:
        ref = reference_template["locators"]["Locator_Door_Hinge"]
        inferred["Locator_Door_Hinge"] = [
            center[0] + ref[0],
            center[1] + ref[1],
            center[2] + ref[2],
        ]

    if "Locator_Door_Spot" not in inferred and "Locator_Door_Spot" in reference_template["locators"]:
        ref = reference_template["locators"]["Locator_Door_Spot"]
        inferred["Locator_Door_Spot"] = [
            center[0] + ref[0],
            center[1] + ref[1],
            center[2] + ref[2],
        ]

    return inferred, tires


def ensure_scene_node(gltf):
    if "scenes" not in gltf or not gltf["scenes"]:
        gltf["scenes"] = [{"nodes": []}]
        gltf["scene"] = 0
    if "scene" not in gltf:
        gltf["scene"] = 0
    scene_index = gltf["scene"]
    while len(gltf["scenes"]) <= scene_index:
        gltf["scenes"].append({"nodes": []})
    gltf["scenes"][scene_index].setdefault("nodes", [])
    return scene_index


def add_missing_locators(gltf, reference_template):
    existing_names = {node_name(node) for node in gltf.get("nodes", [])}
    inferred_positions, tires = infer_positions(gltf, reference_template)
    scene_index = ensure_scene_node(gltf)
    added = []

    for locator_name in REQUIRED_LOCATOR_NAMES:
        if locator_name in existing_names:
            continue
        position = inferred_positions.get(locator_name) or reference_template["locators"].get(locator_name)
        if not position:
            continue
        node = {
            "name": locator_name,
            "translation": [round(position[0], 6), round(position[1], 6), round(position[2], 6)],
        }
        gltf.setdefault("nodes", []).append(node)
        node_index = len(gltf["nodes"]) - 1
        gltf["scenes"][scene_index]["nodes"].append(node_index)
        existing_names.add(locator_name)
        added.append({
            "name": locator_name,
            "translation": node["translation"],
        })

    return added, len(tires)


def analyze_candidate(gltf):
    nodes = gltf.get("nodes", [])
    names = [node_name(node) for node in nodes]
    tire_nodes = collect_named_nodes(gltf, TIRE_PATTERN, exclude=EXCLUDE_STEERING_PATTERN)
    window_nodes = collect_named_nodes(gltf, WINDOW_PATTERN)
    interior_nodes = collect_named_nodes(gltf, INTERIOR_PATTERN)
    door_nodes = collect_named_nodes(gltf, DOOR_PATTERN)
    steering_nodes = collect_named_nodes(gltf, STEERING_WHEEL_PATTERN)

    locator_presence = {locator_name: locator_name in names for locator_name in REQUIRED_LOCATOR_NAMES}
    missing = [name for name, present in locator_presence.items() if not present]
    has_wheel_locator_set = all(
        locator_presence.get(locator_name, False)
        for locator_name in [
            "Locator_Front_Left",
            "Locator_Front_Right",
            "Locator_Rear_Left",
            "Locator_Rear_Right",
        ]
    )

    return {
        "approved": len(missing) == 0 and (len(tire_nodes) >= 4 or has_wheel_locator_set),
        "locators": locator_presence,
        "missingLocators": missing,
        "minimumRequirements": {
            "separateTires": len(tire_nodes) >= 4,
            "tireCount": len(tire_nodes),
            "hasWheelLocatorSet": has_wheel_locator_set,
        },
        "optionalParts": {
            "windows": {"present": len(window_nodes) >= 4, "count": len(window_nodes), "expected": 4},
            "interior": {"present": len(interior_nodes) > 0, "count": len(interior_nodes)},
            "door": {"present": len(door_nodes) > 0, "count": len(door_nodes)},
            "steeringWheel": {"present": len(steering_nodes) > 0, "count": len(steering_nodes)},
        },
    }


def main():
    args = parse_args(sys.argv[1:])
    reference_gltf, _ = read_glb(args.reference)
    candidate_gltf, candidate_bin = read_glb(args.input)

    reference_template = create_reference_template(reference_gltf)
    added_locators, _ = add_missing_locators(candidate_gltf, reference_template)
    analysis = analyze_candidate(candidate_gltf)
    analysis["addedLocators"] = added_locators

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    write_glb(args.output, candidate_gltf, candidate_bin)
    with open(args.report, "w", encoding="utf8") as handle:
        json.dump(analysis, handle, indent=2)


if __name__ == "__main__":
    main()
