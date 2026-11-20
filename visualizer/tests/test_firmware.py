"""Run with python -m unittest discover -s visualizer/tests."""

from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from firmware import Export, Invalid, PANEL, ROLE, Sources


class FirmwareExportTest(unittest.TestCase):
    def setUp(self):
        self.src = Sources()
        base = self.src.baseline()
        self.data = deepcopy(dict(circuits=base["circuits"], pattern=base["patterns"][0], slot="fast"))

    def circuit(self, cid):
        return next(c for c in self.data["circuits"] if c["id"] == cid)

    def export(self):
        return Export(self.data, self.src)

    def test_baseline_round_trip(self):
        for p in self.src.patterns.values():
            with self.subTest(slot=p["id"]):
                self.data.update(pattern=p, slot=p["slot"])
                plan = self.export()
                self.assertEqual(plan.changes, [])
                self.assertEqual(plan.render(), {ROLE: self.src.role, PANEL: self.src.panel})

    def test_split_lamps_across_boards_retains_switch_safety_commands(self):
        self.circuit("engine.GRILL_OUTER_HIGH")["channel"] = 26
        self.data["circuits"].append(dict(id="split", name="Outer pod", node="cargo", channel=25))
        self.data["routes"] = {"engine.GRILL_OUTER_HIGH": ["split", "engine.GRILL_OUTER_HIGH"]}
        self.data["pattern"]["steps"][0] = dict(duration=123, circuits=["engine.GRILL_OUTER_HIGH"])
        plan = self.export()
        self.assertIn("{0x01, 25, CMD_ON, CMD_OFF}", plan.panel)
        self.assertIn("{0x02, 24, CMD_ON, CMD_OFF}", plan.panel)
        self.assertIn("{0x02, 24, CMD_OFF, CMD_OFF}", plan.panel)
        self.assertIn("{0x02, 33, CMD_ON, CMD_OFF}", plan.panel)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for path, content in plan.render().items():
                (root / path.parent).mkdir(exist_ok=True, parents=True)
                (root / path).write_text(content, encoding="utf8")
            reloaded = Sources(root)
            self.assertEqual(reloaded.circuits["split"]["channel"], 25)
            self.assertEqual(reloaded.patterns["engine.fast"]["steps"], self.data["pattern"]["steps"])
            self.assertEqual(reloaded.patterns["cargo.slow"], self.src.patterns["cargo.slow"])

    def test_competing_commands_on_grouped_output(self):
        self.data["routes"] = {"engine.GRILL_OUTER_LOW": ["engine.GRILL_OUTER_HIGH"]}
        with self.assertRaisesRegex(Invalid, "conflicting commands"):
            self.export()

    def test_wrong_board_in_preserved_pattern(self):
        self.circuit("engine.DRIVER_AMBER").update(node="cargo", channel=26)
        self.data["pattern"]["steps"] = [dict(duration=100, circuits=[])]
        with self.assertRaisesRegex(Invalid, "engine.slow"):
            self.export()

    def test_multiple_slot_replacements_resolve_a_board_move(self):
        self.circuit("engine.DRIVER_AMBER").update(node="cargo", channel=26)
        self.data["pattern"]["steps"] = [dict(duration=83, circuits=[])]
        self.data["slotPatterns"] = {
            "engine.slow": dict(node="engine", steps=[dict(duration=300, circuits=["engine.PASS_AMBER"])]),
            "cargo.fast": dict(node="cargo", steps=[dict(duration=101, circuits=["engine.DRIVER_AMBER"])]),
        }
        plan = self.export()
        self.assertEqual(plan.patterns["cargo.fast"], self.data["slotPatterns"]["cargo.fast"]["steps"])
        self.assertEqual(plan.patterns["engine.fast"], self.data["pattern"]["steps"])
        self.assertEqual(plan.patterns["cargo.slow"], self.src.patterns["cargo.slow"]["steps"])
        self.assertEqual(plan.environments(), ["engine_bay_pcm", "cargo_bay_pcm", "switch_panel"])

    def test_timing_edits_on_both_nodes_build_both_roles(self):
        self.data["slotPatterns"] = {"cargo.fast": deepcopy(self.src.patterns["cargo.slow"])}
        plan = self.export()
        self.assertEqual(plan.environments(), ["engine_bay_pcm", "cargo_bay_pcm"])
        self.assertEqual(plan.patterns["cargo.fast"], self.src.patterns["cargo.slow"]["steps"])
        self.data["slotPatterns"]["cargo.fast"]["node"] = "engine"
        with self.assertRaisesRegex(Invalid, "cargo PCM pattern"):
            self.export()

    def test_reject_unassigned_colliding_and_accessory_outputs(self):
        for channel in [None, 2, 27]:
            with self.subTest(channel=channel):
                self.circuit("engine.DRIVER_AMBER")["channel"] = channel
                with self.assertRaises(Invalid):
                    self.export()
        self.circuit("engine.DRIVER_AMBER")["channel"] = 1
        self.data["pattern"]["steps"][0]["circuits"] = ["engine.COMPRESSOR"]
        with self.assertRaisesRegex(Invalid, "lighting output"):
            self.export()

    def test_inactive_proposal_does_not_block_a_timing_only_export(self):
        self.data["circuits"].append(dict(id="future", name="Future light", node="cargo", channel=None))
        self.data["pattern"]["steps"][0]["duration"] = 75
        plan = self.export()
        self.assertEqual(plan.changes, [])
        files = plan.render()
        self.assertEqual(files[PANEL], self.src.panel)
        self.assertEqual(files[ROLE].count("PASS_DITCH_LOW, 75}"), 1)
        self.assertEqual(files[ROLE].replace("PASS_DITCH_LOW, 75}", "PASS_DITCH_LOW, 50}"), self.src.role)

    def test_step_capacity_and_duration(self):
        for count, duration in [(0, 100), (17, 100), (1, 0), (1, 65536)]:
            with self.subTest(count=count, duration=duration):
                self.data["pattern"]["steps"] = [dict(duration=duration, circuits=[])] * count
                with self.assertRaises(Invalid):
                    self.export()

    def test_high_and_low_are_exclusive_on_each_individual_head(self):
        high, low = "engine.GRILL_OUTER_HIGH", "engine.GRILL_OUTER_LOW"
        split = "driver.outer.high"
        self.data["circuits"].append(dict(id=split, name="Driver pod high", node="engine", channel=25))
        self.data["routes"] = {high: [high, split]}
        self.data["layout"] = {"fixtures": [
            dict(id="pod.driver.outer", lamps=[dict(circuit=split), dict(circuit=low)]),
            dict(id="pod.passenger.outer", lamps=[dict(circuit=high), dict(circuit="engine.PASS_DITCH_LOW")]),
        ]}
        self.data["pattern"]["steps"] = [dict(duration=80, circuits=[high, low])]
        self.export()  # Passenger high and driver low.
        self.data["pattern"]["steps"][0]["circuits"] = [split, low]
        with self.assertRaisesRegex(Invalid, "step 1.*driver outer grille pod"):
            self.export()
        self.data["pattern"]["steps"][0]["circuits"] = ["engine.PASS_DITCH_LOW", "engine.PASS_DITCH_HIGH"]
        with self.assertRaisesRegex(Invalid, "step 1.*passenger ditch light"):
            self.export()


if __name__ == "__main__":
    unittest.main()
