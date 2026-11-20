"""Import the project's two PCM roles and generate buildable firmware snapshots."""

import re
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROLE = Path("src/pcm/role.h")
PANEL = Path("src/switch_panel/main.cpp")
NODES = {"engine": 1, "cargo": 2}
SLOTS = ("fast", "slow")
SECTION = "#if defined(PCM_ENGINE_BAY)\n"
MASK = re.compile(r"constexpr uint32_t (\w+) = 1UL << (\d+);[^\n]*")
PATTERN = re.compile(r"constexpr FlashingPattern (FAST|SLOW)_FLASH = \{(.*?)\};", re.S)
STEP = re.compile(r"\{\s*([\w| ]+),\s*(\d+)\s*\}")
SWITCH = re.compile(r"(const SwitchAction switch(\d+)Actions\[\] = \{)(.*?)(\};)", re.S)
ACTION = re.compile(r"\{(0x0[12]),\s*(\d+),\s*(CMD_\w+),\s*(CMD_\w+)\}")
METADATA = Path("src/pcm/visualizer-circuits.json")


class Invalid(ValueError):
    """A design that cannot be represented by the PCM or the switch panel."""


def label(symbol):
    words = {
        "drive": "Driver", "pass": "Passenger", "grill": "Grille",
        "highbeam": "high beam", "rev": "reverse", "lightbar": "Light bar",
        "fogs": "Fog lights",
    }
    return " ".join(words.get(w, w) for w in symbol.lower().split("_")).capitalize()


class Sources:
    def __init__(self, root=ROOT):
        self.root = root
        self.role = (root / ROLE).read_text(encoding="utf8")
        self.panel = (root / PANEL).read_text(encoding="utf8")
        self.header, body = self.role.split(SECTION)
        engine, cargo = body.split("#else  // PCM_CARGO_BAY")
        self.sections = {"engine": engine, "cargo": cargo}
        metadata = root / METADATA
        info = json.loads(metadata.read_text(encoding="utf8")) if metadata.exists() else {}
        self.circuits = {}
        self.patterns = {}
        self.symbols = {}
        self.by_output = {}
        self.macro_ids = {}
        for node, body in self.sections.items():
            for match in MASK.finditer(body):
                symbol, bit = match.groups()
                key = f"{node}.{symbol}"
                item = info.get(key, {})
                cid = item.get("id", key)
                self.add_circuit(cid, node, int(bit) + 1, item.get("name", label(symbol)),
                                 item.get("accessory", symbol == "COMPRESSOR"))
                self.symbols[cid] = symbol
            by_symbol = {self.symbols[cid]: cid for cid, c in self.circuits.items()
                         if c["node"] == node}
            for match in PATTERN.finditer(body):
                slot, content = match.groups()
                slot = slot.lower()
                steps = []
                for expression, duration in STEP.findall(content):
                    ids = [by_symbol[s.strip()] for s in expression.split("|") if s.strip() != "EMPTY"]
                    steps.append({"duration": int(duration), "circuits": ids})
                key = f"{node}.{slot}"
                if not 1 <= len(steps) <= 16:
                    raise Invalid(f"Unable to read the steps of {key} from {ROLE}.")
                self.patterns[key] = dict(id=key, name=f"{node.title()} {slot} flash",
                                          node=node, slot=slot, steps=steps)
                macro = re.search(rf"{slot.upper()}_FLASH_ID = (\d+);", body)
                self.macro_ids[(node, int(macro[1]))] = key
        if len(self.patterns) != 4:
            raise Invalid(f"Expected four flash slots in {ROLE}.")
        for node_hex, index, _, _ in ACTION.findall(self.panel):
            node = self.node_name(node_hex)
            channel = int(index) + 1
            if channel > 26:
                if (node, channel - 1) not in self.macro_ids:
                    raise Invalid(f"Unrecognized macro on {node} at {index}.")
                continue
            if (node, channel) not in self.by_output:
                compressor = (node, channel) == ("engine", 21)
                symbol = "COMPRESSOR" if compressor else f"PANEL_CH_{channel}"
                cid = f"{node}.{symbol}"
                self.add_circuit(cid, node, channel, "Air compressor" if compressor else label(symbol), True)
                self.symbols[cid] = symbol

    @staticmethod
    def node_name(node_hex):
        return next(n for n, number in NODES.items() if number == int(node_hex, 16))

    def add_circuit(self, cid, node, channel, name, accessory):
        if (node, channel) in self.by_output or cid in self.circuits:
            raise Invalid(f"Duplicate circuit in firmware at {node} output {channel}.")
        self.circuits[cid] = dict(id=cid, node=node, channel=channel, name=name, accessory=accessory)
        self.by_output[node, channel] = cid

    def baseline(self):
        return {"circuits": list(self.circuits.values()), "patterns": list(self.patterns.values())}


def mapping(c):
    return f"{c['node'].title()} {c['channel']:02d}" if c["channel"] is not None else "Unassigned"


class Export:
    def __init__(self, data, src):
        self.src = src
        self.circuits = {}
        taken = {}
        if not isinstance(data, dict) or not isinstance(data.get("circuits"), list):
            raise Invalid("Choose a wiring layout to export.")
        for item in data["circuits"]:
            if not isinstance(item, dict):
                raise Invalid("Invalid circuit.")
            cid, node, channel = item.get("id"), item.get("node"), item.get("channel")
            if not isinstance(cid, str) or not cid or cid in self.circuits:
                raise Invalid("Circuit IDs must be unique.")
            if node not in NODES or (channel is not None and
                                     (type(channel) is not int or not 1 <= channel <= 26)):
                raise Invalid(f"{cid} needs an engine or cargo output from 1 to 26.")
            if channel is not None:
                if (node, channel) in taken:
                    raise Invalid(f"{node.title()} {channel} is assigned to {taken[node,channel]} and {cid}. Give shared lamps one circuit.")
                taken[node, channel] = cid
            original = src.circuits.get(cid, {})
            self.circuits[cid] = dict(id=cid, node=node, channel=channel,
                                      name=str(item.get("name") or cid),
                                      accessory=original.get("accessory", bool(item.get("accessory"))))
        missing = src.circuits.keys() - self.circuits.keys()
        if missing:
            raise Invalid(f"Layout is missing the existing circuit {sorted(missing)[0]}.")
        self.routes = data.get("routes", {})
        if not isinstance(self.routes, dict):
            raise Invalid("Invalid wiring groups.")
        for origin, group in self.routes.items():
            if origin not in src.circuits or not isinstance(group, list) or any(
                not isinstance(cid, str) or cid not in self.circuits for cid in group
            ):
                raise Invalid(f"Invalid wiring group for {origin}.")
            if src.circuits[origin]["accessory"] and group != [origin]:
                raise Invalid(f"{origin} must retain its dedicated accessory circuit.")
            if not src.circuits[origin]["accessory"] and any(self.circuits[c]["accessory"] for c in group):
                raise Invalid("A lighting group cannot drive an accessory output.")
        self.changes = []
        for cid, c in self.circuits.items():
            old = src.circuits.get(cid)
            before = mapping(old) if old else "Unassigned"
            group = self.routes.get(cid, [cid])
            after = ", ".join(mapping(self.circuits[target]) for target in dict.fromkeys(group)) or "Disconnected"
            if before != after or group != [cid]:
                self.changes.append(dict(id=cid, name=c["name"], before=before, after=after))
        active = data.get("pattern")
        if not isinstance(active, dict):
            raise Invalid("Select a pattern to export.")
        self.node = active.get("node")
        self.slot = data.get("slot", active.get("slot"))
        if self.node not in NODES or self.slot not in SLOTS:
            raise Invalid("Choose an engine or cargo fast/slow slot.")
        self.selected = f"{self.node}.{self.slot}"
        companions = data.get("slotPatterns", {})
        if not isinstance(companions, dict) or companions.keys() - src.patterns.keys():
            raise Invalid("Choose a valid firmware slot for every additional pattern.")
        self.replacements = {**companions, self.selected: active}
        interlocks = self.mode_pairs(data.get("layout") or {})
        self.patterns = {}
        for key, base in src.patterns.items():
            candidate = self.replacements.get(key, base)
            if not isinstance(candidate, dict) or candidate.get("node") != base["node"]:
                raise Invalid(f"{key} requires a {base['node']} PCM pattern.")
            steps = candidate.get("steps")
            if not isinstance(steps, list) or not 1 <= len(steps) <= 16:
                raise Invalid(f"{key} must have 1–16 steps.")
            resolved = []
            for i, step in enumerate(steps, 1):
                if not isinstance(step, dict) or type(step.get("duration")) is not int or not 1 <= step["duration"] <= 65535:
                    raise Invalid(f"{key} step {i} requires a duration of 1–65535 milliseconds.")
                if not isinstance(step.get("circuits"), list):
                    raise Invalid(f"{key} step {i} has no circuit list.")
                ids = []
                for cid in step["circuits"]:
                    if not isinstance(cid, str) or cid not in self.circuits:
                        raise Invalid(f"Unknown circuit on {key} step {i}.")
                    ids.extend([cid] if key in self.replacements else self.routes.get(cid, [cid]))
                ids = list(dict.fromkeys(ids))
                for cid in ids:
                    c = self.circuits[cid]
                    if c["accessory"] or c["channel"] is None or c["node"] != base["node"]:
                        raise Invalid(f"{key} step {i} needs {c['name']} on a lighting output of the {base['node']} PCM. Check the slot and wiring assignments.")
                for name, high, low in interlocks:
                    if any(cid in ids for cid in high) and any(cid in ids for cid in low):
                        raise Invalid(f"{key} step {i} activates both high and low on {name}. Choose one mode for this head.")
                resolved.append(dict(duration=step["duration"], circuits=ids))
            self.patterns[key] = resolved
        self.panel = SWITCH.sub(self.remap_switch, src.panel)

    def mode_pairs(self, layout):
        """Use each head's wiring so different pods can run in different modes."""
        if not isinstance(layout, dict) or not isinstance(layout.get("fixtures", []), list):
            raise Invalid("Invalid fixture layout.")
        fixtures = {f["id"]: f for f in layout.get("fixtures", []) if isinstance(f, dict) and "id" in f}
        pairs = []
        for side, prefix in (("driver", "DRIVER"), ("passenger", "PASS")):
            base = "engine." + prefix + "_DITCH_"
            pairs.append((f"the {side} ditch light", self.routes.get(base + "HIGH", [base + "HIGH"]),
                          self.routes.get(base + "LOW", [base + "LOW"])))
            for group in ("inner", "outer"):
                fixture = fixtures.get(f"pod.{side}.{group}")
                if fixture is None:
                    base = "engine.GRILL_" + group.upper() + "_"
                    high = self.routes.get(base + "HIGH", [base + "HIGH"])
                    low = self.routes.get(base + "LOW", [base + "LOW"])
                else:
                    lamps = fixture.get("lamps", [])
                    if len(lamps) < 2 or not all(isinstance(lamp, dict) for lamp in lamps[:2]):
                        raise Invalid(f"Missing high/low inputs for the {side} {group} grille pod.")
                    high, low = [lamps[0].get("circuit")], [lamps[1].get("circuit")]
                pairs.append((f"the {side} {group} grille pod", high, low))
        return pairs

    def remap_switch(self, switch):
        # Leave unchanged arrays byte-for-byte intact, including macro switch commands.
        changed = False
        actions = {}
        for hx, index, on, off in ACTION.findall(switch[3]):
            node, ch = self.src.node_name(hx), int(index) + 1
            targets = [(node, ch)]
            if ch <= 26:
                origin = self.src.by_output[node, ch]
                ids = self.routes.get(origin, [origin])
                targets = []
                for cid in ids:
                    c = self.circuits[cid]
                    if c["channel"] is None:
                        raise Invalid(f"Switch {switch[2]} needs an assigned output for {c['name']}.")
                    targets.append((c["node"], c["channel"]))
                changed |= targets != [(node, ch)]
            for target in targets:
                if target in actions and actions[target] != (on, off):
                    raise Invalid(f"Switch {switch[2]} sends conflicting commands to {target[0]} {target[1]}. Split those circuits.")
                actions[target] = (on, off)
        if not changed:
            return switch[0]
        lines = [f"    {{0x{NODES[n]:02X}, {ch - 1}, {on}, {off}}}" for (n, ch), (on, off) in actions.items()]
        return switch[1] + ("\n" + ",\n".join(lines) + "\n" if lines else "") + switch[4]

    def review(self):
        slots = {key: str(p.get("name", key)) for key, p in self.replacements.items()}
        return dict(changes=self.changes, node=self.node, slot=self.slot, slots=slots)

    def environments(self):
        if self.changes:
            return ["engine_bay_pcm", "cargo_bay_pcm", "switch_panel"]
        return [f"{node}_bay_pcm" for node in NODES
                if any(p["node"] == node for p in self.replacements.values())]

    def render(self):
        """Render only changed blocks. Re-importable identifiers survive circuit moves."""
        sections, metadata = {}, {}
        for node, original in self.src.sections.items():
            circuits = [c for c in self.circuits.values() if c["node"] == node and c["channel"] is not None]
            symbols = {}
            used = set()
            for c in circuits:
                cid = c["id"]
                symbol = self.src.symbols.get(cid, "LIGHT_CH_" + str(c["channel"]))
                while symbol in used or symbol == "EMPTY":
                    symbol += "_CH_" + str(c["channel"])
                symbols[cid] = symbol
                used.add(symbol)
                metadata[node + "." + symbol] = {k: c[k] for k in ("id", "name", "accessory")}
            section = original
            if self.changes:
                constants = [f"constexpr uint32_t {symbols[c['id']]} = 1UL << {c['channel'] - 1}; // Channel {c['channel']}" for c in circuits]
                masks = list(MASK.finditer(section))
                if masks:
                    section = section[:masks[0].start()] + "\n".join(constants) + section[masks[-1].end():]
                else:
                    section = section.replace("constexpr FlashingPattern", "\n".join(constants) + "\n\nconstexpr FlashingPattern", 1)
            def render_slot(match):
                slot = match[1]
                key = f"{node}.{slot.lower()}"
                steps = self.patterns[key]
                if steps == self.src.patterns[key]["steps"] and not self.changes:
                    return match[0]
                rows = []
                for s in steps:
                    mask = " | ".join(symbols[cid] for cid in s["circuits"]) or "EMPTY"
                    rows.append(f"{{{mask}, {s['duration']}}}")
                body = ",\n     ".join(rows)
                return f"constexpr FlashingPattern {slot}_FLASH = {{\n    {{{body}}},\n    {len(rows)},\n    0,\n    false,\n    false,\n    0}};"
            sections[node] = PATTERN.sub(render_slot, section)
        role = self.src.header + SECTION + sections["engine"] + "#else  // PCM_CARGO_BAY" + sections["cargo"]
        files = {ROLE: role, PANEL: self.panel}
        if self.changes:
            files[METADATA] = json.dumps(metadata, indent=2) + "\n"
        return files
